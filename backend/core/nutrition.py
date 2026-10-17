"""
Nutrition service — loads nutritional data from JSON, computes health scores,
and provides fallback lookup via Open Food Facts API.
"""

from collections import OrderedDict
import difflib
import json
import math
import re
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

try:
    from rapidfuzz import process, fuzz
except ImportError:
    process = None  # type: ignore
    fuzz = None  # type: ignore


# ---------------------------------------------------------------------------
# Daily target calculation (Mifflin-St Jeor BMR × activity × goal adjustment)
# Shared by the profile and summary endpoints so both report identical targets.
# ---------------------------------------------------------------------------
_DEFAULT_TARGETS = {
    "calories": 2000,
    "protein": 50,
    "fat": 65,
    "carbs": 300,
    "fiber": 25,
    "sugar": 50,
    "sodium_mg": 2300,
}

_ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

# Macro calorie splits (protein_ratio, fat_ratio, carbs_ratio) by dietary_mode
_DIETARY_MACRO_SPLITS = {
    "standard":     (0.25, 0.25, 0.50),
    "balanced":     (0.25, 0.25, 0.50),
    "high_protein": (0.35, 0.25, 0.40),
    "keto":         (0.25, 0.70, 0.05),
    "low_carb":     (0.30, 0.50, 0.20),
    "vegetarian":   (0.20, 0.25, 0.55),
    "vegan":        (0.20, 0.20, 0.60),
}


def _normalize_name(name: str) -> str:
    """Normalize a food name for fuzzy matching: lowercase, strip punctuation,
    collapse whitespace. e.g. 'Pad Thai' → 'pad thai', 'Pad-thai!' → 'padthai'."""
    if not name:
        return ""
    lowered = name.lower()
    # Remove punctuation, then collapse runs of whitespace to a single space
    cleaned = re.sub(r"[^\w\s]", "", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def calculate_daily_targets(user) -> Dict[str, float]:
    """
    Compute TDEE-based daily nutritional targets for a user.
    Uses the Mifflin-St Jeor equation with a gender-aware offset
    (+5 male, -161 female, midpoint for other) and adjusts macro ratios
    based on `user.dietary_mode`.

    Returns generic defaults when weight/height/age are missing, so partially
    onboarded users still get sensible goals until their profile is complete.
    """
    mode_key = (getattr(user, "dietary_mode", None) or "standard").lower().strip()
    p_ratio, f_ratio, c_ratio = _DIETARY_MACRO_SPLITS.get(mode_key, (0.25, 0.25, 0.50))

    if not all([user.weight_kg, user.height_cm, user.age]):
        base_cal = _DEFAULT_TARGETS["calories"]
        return {
            "calories": base_cal,
            "protein": round(base_cal * p_ratio / 4),
            "fat": round(base_cal * f_ratio / 9),
            "carbs": round(base_cal * c_ratio / 4),
            "fiber": 25,
            "sugar": 25 if mode_key in ("keto", "low_carb") else 50,
            "sodium_mg": 2300,
        }

    # Mifflin-St Jeor BMR offset by gender
    offset = {
        "male": 5,
        "female": -161,
    }.get((user.gender or "").lower(), -78)  # average of +5 / -161 for other/unknown

    bmr = 10 * user.weight_kg + 6.25 * user.height_cm - 5 * user.age + offset

    multiplier = _ACTIVITY_MULTIPLIERS.get(user.activity_level, 1.55)
    tdee = bmr * multiplier

    # Adjust for goal
    if user.goal == "lose":
        tdee *= 0.8    # 20% deficit
    elif user.goal == "gain":
        tdee *= 1.15   # 15% surplus

    return {
        "calories": round(tdee),
        "protein": round(tdee * p_ratio / 4),
        "fat": round(tdee * f_ratio / 9),
        "carbs": round(tdee * c_ratio / 4),
        "fiber": 25 if tdee < 2500 else 30,
        "sugar": 25 if mode_key in ("keto", "low_carb") else round(tdee * 0.10 / 4),
        "sodium_mg": 2300,
    }


class NutritionService:
    """
    Manages nutritional data for all food classes.
    - Primary source: local nutrition_db.json
    - Fallback: Open Food Facts API (with bounded LRU cache)
    - Computes health scores per the spec formula
    """

    def __init__(self, db_path: Path, cache_size: int = 50):
        from collections import OrderedDict
        self.db_path = db_path
        self.cache_size = max(1, cache_size)
        self.nutrition_data: Dict[str, Dict[str, Any]] = {}
        self._lower_map: Dict[str, str] = {}
        self._normalized_choices: Dict[str, str] = {}
        self._fallback_cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._load()

    def _load(self) -> None:
        """Load nutrition database from JSON file and precompute lookup indices."""
        if self.db_path.exists():
            with open(self.db_path, "r", encoding="utf-8") as f:
                self.nutrition_data = json.load(f)
        else:
            self.nutrition_data = {}

        self._lower_map = {k.lower(): k for k in self.nutrition_data.keys()}
        self._normalized_choices = {k: _normalize_name(k) for k in self.nutrition_data.keys()}

    def canonicalize_name(self, food_name: str) -> str:
        """Return canonical key from nutrition_db.json if matched, else original name."""
        if food_name in self.nutrition_data:
            return food_name
        canon = self._lower_map.get(food_name.lower())
        return canon if canon is not None else food_name

    def get_nutrition(self, food_name: str) -> Optional[Dict[str, Any]]:
        """
        Look up nutritional data by food name in O(1).
        Tries exact match first, then case-insensitive.
        """
        if food_name in self.nutrition_data:
            return self.nutrition_data[food_name]

        canon = self._lower_map.get(food_name.lower())
        if canon is not None:
            return self.nutrition_data[canon]

        return None

    def fuzzy_match(
        self, food_name: str, threshold: float = 0.75
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        if not self.nutrition_data:
            return None

        query_norm = _normalize_name(food_name)
        if process is not None and fuzz is not None:
            match = process.extractOne(
                query_norm,
                self._normalized_choices,
                scorer=fuzz.WRatio,
                score_cutoff=threshold * 100
            )
            if match:
                db_key = match[2]
                return db_key, self.nutrition_data[db_key]
            return None

        # Stdlib fallback using difflib when rapidfuzz is not installed
        best_key = None
        best_ratio = 0.0
        for db_key, norm_val in self._normalized_choices.items():
            ratio = difflib.SequenceMatcher(None, query_norm, norm_val).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_key = db_key
        if best_key and best_ratio >= threshold:
            return best_key, self.nutrition_data[best_key]
        return None

    def compute_health_score(self, per_100g: Dict[str, float], food_name: str = "") -> Dict[str, Any]:
        fiber = per_100g.get("fiber", 0)
        protein = per_100g.get("protein", 0)
        saturated_fat = per_100g.get("saturated_fat_g", 0)
        sugar = per_100g.get("sugar", 0)
        sodium = per_100g.get("sodium_mg", 0)

        # Vitamins & Minerals DRV normalization
        # Vitamin C is always tracked in nutrition_db.json and Gemini estimates;
        # scale Vitamin C up to 10 pts, plus optional bonus if extra micronutrients are present.
        vit_c = min(per_100g.get("vitamin_c_mg", 0) / 90 * 10, 10)  # 90mg DRV
        vit_a = min(per_100g.get("vitamin_a_mcg", 0) / 900 * 5, 5)
        iron = min(per_100g.get("iron_mg", 0) / 18 * 5, 5)
        calcium = min(per_100g.get("calcium_mg", 0) / 1300 * 5, 5)
        potassium = min(per_100g.get("potassium_mg", 0) / 4700 * 5, 5)

        micronutrients = vit_c + vit_a + iron + calcium + potassium

        score = 50
        score += fiber * 3
        score += protein * 2
        score += micronutrients * 1.5
        score -= saturated_fat * 3
        score -= sugar * 2
        score -= (sodium / 2300) * 15  # Normalized penalty for sodium (2300mg DRV)

        # Category bonus
        name_lower = food_name.lower()
        if any(kw in name_lower for kw in ["salad", "veg", "spinach", "kale", "broccoli", "morning glory", "cabbage"]):
            score += 10
        elif any(kw in name_lower for kw in ["fruit", "apple", "berry", "orange", "papaya", "mango", "banana"]):
            score += 5

        score = max(0, min(100, round(score)))

        if score <= 40:
            label = "Limit"
        elif score <= 70:
            label = "Moderate"
        else:
            label = "Excellent"

        return {"health_score": score, "health_label": label}

    def estimate_serving_grams(self, food_name: str, nutrition_dict: Optional[Dict] = None) -> int:
        """Estimate a typical serving size. U2: Uses per-dish DB serving_g if available."""
        if nutrition_dict and "serving_g" in nutrition_dict:
            return nutrition_dict["serving_g"]
        
        name_lower = food_name.lower()

        # Soups and curries tend to be larger servings
        if any(kw in name_lower for kw in ["soup", "curry", "broth", "porridge"]):
            return 350
        # Fried rice and noodle dishes
        elif any(kw in name_lower for kw in ["rice", "noodle", "fried rice", "padthai"]):
            return 300
        # Salads
        elif "salad" in name_lower:
            return 200
        # Small items and snacks
        elif any(kw in name_lower for kw in ["roll", "ball", "fritter", "cake", "skewer", "satay"]):
            return 120
        # Desserts
        elif any(kw in name_lower for kw in ["custard", "sticky rice", "ice cream", "jelly",
                                              "wafer", "floss", "thread", "lod chong", "bua loy"]):
            return 150
        # Grilled meats
        elif any(kw in name_lower for kw in ["grilled", "bbq", "stew"]):
            return 250
        # Stir-fried dishes
        elif "stir" in name_lower:
            return 250
        # Default
        else:
            return 250

    def get_tags(self, per_100g: Dict[str, float]) -> List[str]:
        """Generate dietary tags based on nutritional content."""
        tags = []
        carbs = per_100g.get("carbs", 0)
        protein = per_100g.get("protein", 0)
        fat = per_100g.get("fat", 0)
        fiber = per_100g.get("fiber", 0)
        sugar = per_100g.get("sugar", 0)
        calories = per_100g.get("calories", 0)

        if carbs > 30:
            tags.append("high-carb")
        if protein > 15:
            tags.append("high-protein")
        if fat > 15:
            tags.append("high-fat")
        if fiber > 5:
            tags.append("high-fiber")
        if sugar > 10:
            tags.append("high-sugar")
        if calories < 100:
            tags.append("low-calorie")
        if calories > 300:
            tags.append("calorie-dense")

        return tags

    def get_glycemic_index(self, per_100g: Dict[str, float], food_name: str) -> str:
        """U4: Use a curated GI DB dictionary, fallback to heuristics."""
        gi_db = {
            "white rice": "high", "jasmine rice": "high", "sticky rice": "high",
            "brown rice": "medium", "rice noodle": "high", "glass noodle": "low",
            "egg noodle": "medium", "whole wheat": "low", "sugar": "high",
            "potato": "high", "sweet potato": "medium", "taro": "medium",
            "watermelon": "high", "pineapple": "medium", "apple": "low",
            "chicken": "low", "pork": "low", "beef": "low", "fish": "low",
            "egg": "low", "tofu": "low", "broccoli": "low", "spinach": "low"
        }
        name_lower = food_name.lower()
        for kw, gi in gi_db.items():
            if kw in name_lower:
                return gi

        carbs = per_100g.get("carbs", 0)
        fiber = per_100g.get("fiber", 0)
        sugar = per_100g.get("sugar", 0)
        
        if sugar > 15 or (carbs > 30 and fiber < 2):
            return "high"
        if carbs < 10:
            return "low"
        return "medium"

    async def fallback_lookup(self, food_name: str) -> Optional[Dict[str, Any]]:
        """
        Query Open Food Facts API as fallback for unknown foods.
        Returns per_100g nutrition data if found, with bounded LRU caching.
        """
        cache_key = _normalize_name(food_name)
        if not cache_key:
            return None

        if cache_key in self._fallback_cache:
            self._fallback_cache.move_to_end(cache_key)
            return dict(self._fallback_cache[cache_key])

        try:
            search_url = "https://world.openfoodfacts.org/cgi/search.pl"
            params = {
                "search_terms": food_name,
                "json": 1,
                "page_size": 1,
                "fields": "product_name,nutriments",
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(search_url, params=params)
                if resp.status_code != 200:
                    return None

                data = resp.json()
                products = data.get("products", [])
                if not products:
                    return None

                nutriments = products[0].get("nutriments", {})
                calories = float(nutriments.get("energy-kcal_100g") or 0)
                if calories <= 0:
                    return None

                result = {
                    "calories": calories,
                    "protein": float(nutriments.get("proteins_100g") or 0),
                    "fat": float(nutriments.get("fat_100g") or 0),
                    "carbs": float(nutriments.get("carbohydrates_100g") or 0),
                    "fiber": float(nutriments.get("fiber_100g") or 0),
                    "sugar": float(nutriments.get("sugars_100g") or 0),
                    "sodium_mg": float(nutriments.get("sodium_100g") or 0) * 1000,
                    "saturated_fat_g": float(nutriments.get("saturated-fat_100g") or 0),
                    "vitamin_c_mg": float(nutriments.get("vitamin-c_100g") or 0),
                }
                self._fallback_cache[cache_key] = result
                while len(self._fallback_cache) > self.cache_size:
                    self._fallback_cache.popitem(last=False)
                return dict(result)
        except Exception:
            return None
