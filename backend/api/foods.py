"""
Food detail endpoints.
GET /api/v1/foods/{id} — Single food nutritional detail.
GET /api/v1/foods       — List all known foods.
"""

from pathlib import Path

from fastapi import APIRouter, Request, HTTPException

from core.nutrition import NutritionService

router = APIRouter()


@router.get("/foods")
async def list_foods(request: Request):
    """List all known food classes with their nutritional data."""
    model_manager = request.app.state.model_manager

    # P6 fix: Use the singleton NutritionService from app.state instead of
    # re-instantiating (and re-parsing the JSON file) on every request.
    nutrition_svc: NutritionService = request.app.state.nutrition_svc

    foods = []
    for class_id, name in sorted(model_manager.class_names.items()):
        nutrition = nutrition_svc.get_nutrition(name)
        health = nutrition_svc.compute_health_score(nutrition) if nutrition else {"health_score": 0, "health_label": "Unknown"}

        foods.append({
            "id": class_id,
            "name": name,
            "has_nutrition": nutrition is not None,
            "health_score": health["health_score"],
            "health_label": health["health_label"],
        })

    return {"foods": foods, "total": len(foods)}


@router.get("/foods/{food_id}")
async def get_food_detail(food_id: int, request: Request):
    """Get full nutritional detail for a single food by its class ID."""
    model_manager = request.app.state.model_manager

    name = model_manager.class_names.get(food_id)
    if name is None:
        raise HTTPException(status_code=404, detail=f"Food with ID {food_id} not found")

    # P6 fix: Use the singleton NutritionService from app.state.
    nutrition_svc: NutritionService = request.app.state.nutrition_svc

    nutrition = nutrition_svc.get_nutrition(name)
    if nutrition is None:
        raise HTTPException(status_code=404, detail=f"No nutritional data for '{name}'")

    health = nutrition_svc.compute_health_score(nutrition)
    tags = nutrition_svc.get_tags(nutrition)
    gi = nutrition_svc.get_glycemic_index(nutrition, name)
    serving = nutrition_svc.estimate_serving_grams(name)

    # U15: Thai names and similar dishes
    thai_name = nutrition.get("thai_name")
    related = []
    # Find up to 3 similar health score foods
    for k, v in nutrition_svc.nutrition_data.items():
        if k.lower() == name.lower(): continue
        score_k = nutrition_svc.compute_health_score(v).get("health_score", 0)
        if abs(score_k - health["health_score"]) <= 10:
            related.append(k)
        if len(related) >= 3:
            break

    return {
        "id": food_id,
        "name": name,
        "thai_name": thai_name,
        "serving_estimate_g": serving,
        "per_100g": nutrition,
        "health_score": health["health_score"],
        "health_label": health["health_label"],
        "tags": tags,
        "glycemic_index": gi,
        "allergens": nutrition.get("allergens", []),
        "related_dishes": related,
    }
