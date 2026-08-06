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
    config = request.app.state.config
    base_dir = request.app.state.base_dir
    model_manager = request.app.state.model_manager

    nutrition_db_path = base_dir / config["nutritional"]["db_file"]
    nutrition_svc = NutritionService(nutrition_db_path)

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
    config = request.app.state.config
    base_dir = request.app.state.base_dir

    name = model_manager.class_names.get(food_id)
    if name is None:
        raise HTTPException(status_code=404, detail=f"Food with ID {food_id} not found")

    nutrition_db_path = base_dir / config["nutritional"]["db_file"]
    nutrition_svc = NutritionService(nutrition_db_path)

    nutrition = nutrition_svc.get_nutrition(name)
    if nutrition is None:
        raise HTTPException(status_code=404, detail=f"No nutritional data for '{name}'")

    health = nutrition_svc.compute_health_score(nutrition)
    tags = nutrition_svc.get_tags(nutrition)
    gi = nutrition_svc.get_glycemic_index(nutrition, name)
    serving = nutrition_svc.estimate_serving_grams(name)

    return {
        "id": food_id,
        "name": name,
        "serving_estimate_g": serving,
        "per_100g": nutrition,
        "health_score": health["health_score"],
        "health_label": health["health_label"],
        "tags": tags,
        "glycemic_index": gi,
        "allergens": nutrition.get("allergens", []),
    }
