"""
Food detail endpoints.
GET /api/v1/foods/{id} — Single food nutritional detail.
GET /api/v1/foods       — List all known foods.
"""

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.orm import Session

from core.nutrition import NutritionService, _normalize_name
from core.database import get_db
from core.models import NutritionReview

router = APIRouter()

PROMOTED_ID_OFFSET = 10000


@router.get("/foods")
def list_foods(request: Request, db: Session = Depends(get_db)):
    """List all known food classes (deduplicated by canonical name) plus
    admin-promoted dishes with their nutritional metadata."""
    model_manager = request.app.state.model_manager
    nutrition_svc: NutritionService = request.app.state.nutrition_svc

    seen_norms = set()
    foods = []

    for class_id, raw_name in sorted(model_manager.class_names.items()):
        name = nutrition_svc.canonicalize_name(raw_name)
        norm = _normalize_name(name)
        if norm in seen_norms:
            continue
        seen_norms.add(norm)

        nutrition = nutrition_svc.get_nutrition(name)
        health = (
            nutrition_svc.compute_health_score(nutrition, name)
            if nutrition
            else {"health_score": 50, "health_label": "Moderate"}
        )
        serving = nutrition_svc.estimate_serving_grams(name, nutrition) if nutrition else 250

        foods.append({
            "id": class_id,
            "name": name,
            "has_nutrition": nutrition is not None,
            "health_score": health["health_score"],
            "health_label": health["health_label"],
            "serving_estimate_g": serving,
            "per_100g": nutrition or {},
            "allergens": (nutrition or {}).get("allergens", []),
            "tags": nutrition_svc.get_tags(nutrition) if nutrition else [],
            "glycemic_index": nutrition_svc.get_glycemic_index(nutrition, name) if nutrition else "medium",
        })

    # Also include admin-promoted dishes from NutritionReview
    try:
        promoted_rows = (
            db.query(NutritionReview)
            .filter(NutritionReview.status == "promoted")
            .order_by(NutritionReview.dish_name)
            .all()
        )
        for row in promoted_rows:
            norm = _normalize_name(row.dish_name)
            if norm in seen_norms:
                continue
            seen_norms.add(norm)
            nutrition = dict(row.per_100g or {})
            health = nutrition_svc.compute_health_score(nutrition, row.dish_name)
            serving = nutrition_svc.estimate_serving_grams(row.dish_name, nutrition)
            foods.append({
                "id": PROMOTED_ID_OFFSET + row.id,
                "name": row.dish_name,
                "has_nutrition": True,
                "health_score": health["health_score"],
                "health_label": health["health_label"],
                "serving_estimate_g": serving,
                "per_100g": nutrition,
                "allergens": row.allergens or [],
                "tags": nutrition_svc.get_tags(nutrition),
                "glycemic_index": nutrition_svc.get_glycemic_index(nutrition, row.dish_name),
            })
    except Exception:
        pass

    return {"foods": foods, "total": len(foods)}


@router.get("/foods/{food_id}")
def get_food_detail(food_id: int, request: Request, db: Session = Depends(get_db)):
    """Get full nutritional detail for a single food by its class ID or promoted ID."""
    model_manager = request.app.state.model_manager
    nutrition_svc: NutritionService = request.app.state.nutrition_svc

    if food_id >= PROMOTED_ID_OFFSET:
        review_id = food_id - PROMOTED_ID_OFFSET
        row = (
            db.query(NutritionReview)
            .filter(NutritionReview.id == review_id, NutritionReview.status == "promoted")
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail=f"Food with ID {food_id} not found")
        name = row.dish_name
        nutrition = dict(row.per_100g or {})
        allergens = row.allergens or []
    else:
        raw_name = model_manager.class_names.get(food_id)
        if raw_name is None:
            raise HTTPException(status_code=404, detail=f"Food with ID {food_id} not found")
        name = nutrition_svc.canonicalize_name(raw_name)
        nutrition = nutrition_svc.get_nutrition(name)
        if nutrition is None:
            raise HTTPException(status_code=404, detail=f"No nutritional data for '{name}'")
        allergens = nutrition.get("allergens", [])

    health = nutrition_svc.compute_health_score(nutrition, name)
    tags = nutrition_svc.get_tags(nutrition)
    gi = nutrition_svc.get_glycemic_index(nutrition, name)
    serving = nutrition_svc.estimate_serving_grams(name, nutrition)

    thai_name = nutrition.get("thai_name")
    related = []
    for k, v in nutrition_svc.nutrition_data.items():
        if k.lower() == name.lower():
            continue
        score_k = nutrition_svc.compute_health_score(v, k).get("health_score", 0)
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
        "allergens": allergens,
        "related_dishes": related,
    }
