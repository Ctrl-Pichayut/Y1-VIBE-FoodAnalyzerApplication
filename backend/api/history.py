"""
Meal history endpoints.
GET    /api/v1/history           — User meal history (paginated).
POST   /api/v1/history           — Log a meal manually.
PUT    /api/v1/history/{meal_id} — Edit a logged meal (portions, dishes, meal_type).
DELETE /api/v1/history/{meal_id} — Delete a logged meal.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.database import get_db
from core.models import User, MealLog
from core.schemas import MealLogCreate, MealLogResponse, MealLogUpdate

router = APIRouter()

VALID_MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}


def _infer_meal_type(dt: Optional[datetime] = None) -> str:
    """Infer meal category from timestamp hour when not explicitly provided."""
    target = dt or datetime.now(timezone.utc)
    hour = target.hour
    if 5 <= hour < 11:
        return "breakfast"
    if 11 <= hour < 15:
        return "lunch"
    if 17 <= hour < 22:
        return "dinner"
    return "snack"


def _normalize_meal_type(meal_type: Optional[str], dt: Optional[datetime] = None) -> str:
    if meal_type:
        cleaned = meal_type.strip().lower()
        if cleaned in VALID_MEAL_TYPES:
            return cleaned
    return _infer_meal_type(dt)


@router.get("/history")
def get_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get paginated meal history for the current user."""
    offset = (page - 1) * per_page

    total = db.query(MealLog).filter(MealLog.user_id == current_user.id).count()
    meals = (
        db.query(MealLog)
        .filter(MealLog.user_id == current_user.id)
        .order_by(MealLog.timestamp.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )

    return {
        "meals": [
            {
                "id": m.id,
                "timestamp": m.timestamp.isoformat(),
                "scan_id": m.scan_id,
                "meal_type": m.meal_type or _infer_meal_type(m.timestamp),
                "foods_json": m.foods_json,
                "totals_json": m.totals_json,
            }
            for m in meals
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@router.post("/history")
def log_meal(
    meal: MealLogCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Log a meal.

    P2 fix: If the client omits totals_json, compute it server-side from
    foods_json so every meal log always has valid totals (required by
    daily-summary and weekly-report).
    """
    totals = meal.totals_json
    if totals is None:
        from api.analyze import compute_totals
        totals = compute_totals(meal.foods_json)

    meal_type = _normalize_meal_type(meal.meal_type)

    meal_log = MealLog(
        user_id=current_user.id,
        meal_type=meal_type,
        foods_json=meal.foods_json,
        totals_json=totals,
    )
    db.add(meal_log)
    db.commit()
    db.refresh(meal_log)

    return {
        "id": meal_log.id,
        "timestamp": meal_log.timestamp.isoformat(),
        "scan_id": meal_log.scan_id,
        "meal_type": meal_log.meal_type,
        "foods_json": meal_log.foods_json,
        "totals_json": meal_log.totals_json,
    }


@router.put("/history/{meal_id}")
def update_meal(
    meal_id: int,
    updates: MealLogUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit an existing meal log (update portion sizes, dishes, or meal_type)."""
    meal = (
        db.query(MealLog)
        .filter(MealLog.id == meal_id, MealLog.user_id == current_user.id)
        .first()
    )
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")

    meal.foods_json = updates.foods_json
    if updates.totals_json is not None:
        meal.totals_json = updates.totals_json
    else:
        from api.analyze import compute_totals
        meal.totals_json = compute_totals(updates.foods_json)

    if updates.meal_type is not None:
        meal.meal_type = _normalize_meal_type(updates.meal_type, meal.timestamp)

    db.commit()
    db.refresh(meal)

    return {
        "id": meal.id,
        "timestamp": meal.timestamp.isoformat(),
        "scan_id": meal.scan_id,
        "meal_type": meal.meal_type or _infer_meal_type(meal.timestamp),
        "foods_json": meal.foods_json,
        "totals_json": meal.totals_json,
    }


@router.delete("/history/{meal_id}")
def delete_meal(
    meal_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a meal log entry."""
    meal = (
        db.query(MealLog)
        .filter(MealLog.id == meal_id, MealLog.user_id == current_user.id)
        .first()
    )
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")

    db.delete(meal)
    db.commit()
    return {"status": "deleted", "id": meal_id}
