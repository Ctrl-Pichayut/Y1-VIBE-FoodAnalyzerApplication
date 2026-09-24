"""
Meal history endpoints.
GET  /api/v1/history — User meal history (paginated).
POST /api/v1/history — Log a meal manually.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.database import get_db
from core.models import User, MealLog
from core.schemas import MealLogCreate, MealLogResponse

router = APIRouter()


@router.get("/history")
async def get_history(
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
async def log_meal(
    meal: MealLogCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually log a meal.

    P2 fix: If the client omits totals_json, compute it server-side from
    foods_json so every meal log always has valid totals (required by
    daily-summary and weekly-report).
    """
    totals = meal.totals_json
    if totals is None:
        from api.analyze import compute_totals
        totals = compute_totals(meal.foods_json)

    meal_log = MealLog(
        user_id=current_user.id,
        foods_json=meal.foods_json,
        totals_json=totals,
    )
    db.add(meal_log)
    db.commit()
    db.refresh(meal_log)

    return {
        "id": meal_log.id,
        "timestamp": meal_log.timestamp.isoformat(),
        "foods_json": meal_log.foods_json,
        "totals_json": meal_log.totals_json,
    }


@router.delete("/history/{meal_id}")
async def delete_meal(
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
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Meal not found")

    db.delete(meal)
    db.commit()
    return {"status": "deleted", "id": meal_id}
