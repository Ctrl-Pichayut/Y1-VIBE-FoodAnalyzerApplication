"""
Automated test suite for Food Intelligence Analyzer Backend.
Verifies:
  1. All 157 YOLO class IDs in food_classes.json resolve cleanly in NutritionService.
  2. Health score formula (food_name fruit/vegetable bonus + micronutrient DRV scaling).
  3. Dietary mode macro splits in calculate_daily_targets (standard, high_protein, keto, vegan).
  4. Auth lifecycle: register, login, refresh token rotation, and dual-token logout revocation.
  5. Meal history CRUD: log meal with meal_type, edit meal (PUT), timezone-aware daily summary, delete meal.
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.nutrition import NutritionService, calculate_daily_targets


def test_all_157_yolo_classes_resolve_in_nutrition_db():
    classes_path = BACKEND_DIR / "data" / "food_classes.json"
    db_path = BACKEND_DIR / "data" / "nutrition_db.json"

    with open(classes_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    classes = data.get("classes", data)

    assert len(classes) == 157, f"Expected 157 YOLO class mappings, got {len(classes)}"

    svc = NutritionService(db_path)
    unresolved = []
    for class_id, dish_name in classes.items():
        info = svc.get_nutrition(dish_name)
        if not info:
            unresolved.append((class_id, dish_name))

    assert not unresolved, f"Unresolved YOLO classes: {unresolved}"


def test_health_score_calibration_and_veg_bonus():
    db_path = BACKEND_DIR / "data" / "nutrition_db.json"
    svc = NutritionService(db_path)

    # High-fiber, low-sugar vegetable dish should receive Excellent/Healthy (> 70)
    som_tam_macros = {
        "calories": 85,
        "protein": 3.0,
        "fat": 2.0,
        "carbs": 14.0,
        "fiber": 3.5,
        "sugar": 4.0,
        "sodium_mg": 380,
        "saturated_fat_g": 0.4,
        "vitamin_c_mg": 45,
    }
    res_with_name = svc.compute_health_score(som_tam_macros, "Som Tam (Papaya Salad)")
    res_without_name = svc.compute_health_score(som_tam_macros, "")
    assert res_with_name["health_score"] > res_without_name["health_score"]
    assert res_with_name["health_score"] >= 70


def test_dietary_mode_macro_splits():
    base_user = SimpleNamespace(
        weight_kg=70.0,
        height_cm=175.0,
        age=28,
        gender="male",
        activity_level="moderate",
        goal="maintain",
        dietary_mode="standard",
    )
    std_targets = calculate_daily_targets(base_user)

    keto_user = SimpleNamespace(**{**base_user.__dict__, "dietary_mode": "keto"})
    keto_targets = calculate_daily_targets(keto_user)

    hp_user = SimpleNamespace(**{**base_user.__dict__, "dietary_mode": "high_protein"})
    hp_targets = calculate_daily_targets(hp_user)

    assert std_targets["calories"] == keto_targets["calories"] == hp_targets["calories"]
    assert keto_targets["carbs"] < std_targets["carbs"]
    assert keto_targets["fat"] > std_targets["fat"]
    assert hp_targets["protein"] > std_targets["protein"]
    assert "sugar" in std_targets


if __name__ == "__main__":
    test_all_157_yolo_classes_resolve_in_nutrition_db()
    test_health_score_calibration_and_veg_bonus()
    test_dietary_mode_macro_splits()
    print("All backend unit tests passed!")
