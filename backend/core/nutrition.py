"""
Nutrition service — loads nutritional data from JSON, computes health scores,
and provides fallback lookup via Open Food Facts API.
"""

import json
import math
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

import httpx


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
    "sodium_mg": 2300,
}

_ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
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
    (+5 male, -161 female, midpoint for other).

    Returns generic defaults when weight/height/age are missing, so partially
    onboarded users still get sensible goals until their profile is complete.
    """
    if not all([user.weight_kg, user.height_cm, user.age]):
        return dict(_DEFAULT_TARGETS)

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
        "protein": round(tdee * 0.25 / 4),   # 25% from protein, 4 cal/g
        "fat": round(tdee * 0.25 / 9),       # 25% from fat, 9 cal/g
        "carbs": round(tdee * 0.50 / 4),     # 50% from carbs, 4 cal/g
        "fiber": 25 if tdee < 2500 else 30,
        "sodium_mg": 2300,
    }


class NutritionService:
    """
    Manages nutritional data for all food classes.
    - Primary source: local nutrition_db.json
    - Fallback: Open Food Facts API
    - Computes health scores per the spec formula
    """

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.nutrition_data: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        """Load nutrition database from JSON file."""
        if self.db_path.exists():
            with open(self.db_path, "r", encoding="utf-8") as f:
                self.nutrition_data = json.load(f)
        else:
            self.nutrition_data = {}

    def get_nutrition(self, food_name: str) -> Optional[Dict[str, Any]]:
        """
        Look up nutritional data by food name.
        Tries exact match first, then case-insensitive.
        """
        # Exact match
        if food_name in self.nutrition_data:
            return self.nutrition_data[food_name]

        # Case-insensitive search
        food_lower = food_name.lower()
        for key, value in self.nutrition_data.items():
            if key.lower() == food_lower:
                return value

        return None

    def fuzzy_match(
        self, food_name: str, threshold: float = 0.75
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        """
        Fuzzy-match a food name against nutrition_db keys via string similarity.

        Used as a second-tier lookup after exact/case-insensitive matching,
        primarily to reconcile free-form Gemini dish names (e.g. "Pad Thai")
        with the curated DB keys (e.g. "Padthai").

        Returns (matched_db_key, nutrition_dict) for the best match whose
        similarity ratio is >= `threshold`, or None if nothing clears the bar.
        """
        if not self.nutrition_data:
            return None

        needle = _normalize_name(food_name)
        best_key: Optional[str] = None
        best_ratio: float = 0.0

        for key in self.nutrition_data:
            ratio = SequenceMatcher(None, needle, _normalize_name(key)).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_key = key

        if best_key is not None and best_ratio >= threshold:
            return best_key, self.nutrition_data[best_key]
        return None

    def compute_health_score(self, per_100g: Dict[str, float]) -> Dict[str, Any]:
        """
        Compute health score using the spec formula:
        score = 50
          + (fiber_g × 3)
          + (protein_g × 2)
          + (vitamin_score × 2)       ← sum of key vitamins normalized 0–5
          - (saturated_fat_g × 3)
          - (sugar_g × 2)
          - (sodium_mg / 100 × 1.5)
        Clamp to 0–100.
        Labels: 0–40 = "Limit" · 41–70 = "Moderate" · 71–100 = "Excellent"
        """
        fiber = per_100g.get("fiber", 0)
        protein = per_100g.get("protein", 0)
        saturated_fat = per_100g.get("saturated_fat_g", 0)
        sugar = per_100g.get("sugar", 0)
        sodium = per_100g.get("sodium_mg", 0)

        # Vitamin score: normalize each vitamin 0-5, sum and cap at 5
        vitamin_c = min(per_100g.get("vitamin_c_mg", 0) / 18, 5)  # 90mg DV / 5 portions
        vitamin_a = min(per_100g.get("vitamin_a_mcg", 0) / 180, 5)
        vitamin_score = min((vitamin_c + vitamin_a), 5)

        score = 50
        score += fiber * 3
        score += protein * 2
        score += vitamin_score * 2
        score -= saturated_fat * 3
        score -= sugar * 2
        score -= (sodium / 100) * 1.5

        score = max(0, min(100, round(score)))

        if score <= 40:
            label = "Limit"
        elif score <= 70:
            label = "Moderate"
        else:
            label = "Excellent"

        return {"health_score": score, "health_label": label}

    def estimate_serving_grams(self, food_name: str) -> int:
        """Estimate a typical serving size in grams based on food category."""
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
        """Estimate glycemic index category based on food composition."""
        carbs = per_100g.get("carbs", 0)
        fiber = per_100g.get("fiber", 0)
        sugar = per_100g.get("sugar", 0)
        name_lower = food_name.lower()

        # High-GI indicators
        if any(kw in name_lower for kw in ["rice", "noodle", "bread", "wafer"]):
            if fiber > 3:
                return "medium"
            return "high"
        # Sugary desserts
        elif sugar > 15:
            return "high"
        # Low carb foods
        elif carbs < 10:
            return "low"
        elif carbs < 25:
            return "medium"
        else:
            return "medium"

    async def fallback_lookup(self, food_name: str) -> Optional[Dict[str, Any]]:
        """
        Query Open Food Facts API as fallback for unknown foods.
        Returns per_100g nutrition data if found.
        """
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
                return {
                    "calories": nutriments.get("energy-kcal_100g", 0),
                    "protein": nutriments.get("proteins_100g", 0),
                    "fat": nutriments.get("fat_100g", 0),
                    "carbs": nutriments.get("carbohydrates_100g", 0),
                    "fiber": nutriments.get("fiber_100g", 0),
                    "sugar": nutriments.get("sugars_100g", 0),
                    "sodium_mg": nutriments.get("sodium_100g", 0) * 1000,
                    "saturated_fat_g": nutriments.get("saturated-fat_100g", 0),
                    "vitamin_c_mg": nutriments.get("vitamin-c_100g", 0),
                }
        except Exception:
            return None
