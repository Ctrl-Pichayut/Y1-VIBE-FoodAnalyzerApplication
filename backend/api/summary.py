"""
Daily summary and weekly report endpoints.
GET /api/v1/daily-summary — Today's totals vs. targets.
GET /api/v1/weekly-report — 7-day nutrition trend data.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from core.auth import get_current_user
from core.database import get_db
from core.models import User, MealLog
from core.nutrition import calculate_daily_targets

router = APIRouter()


@router.get("/daily-summary")
async def daily_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    meals = db.query(MealLog).filter(MealLog.user_id == current_user.id, MealLog.timestamp >= today_start).all()
    totals = _aggregate(meals)
    targets = calculate_daily_targets(current_user)
    progress = {k: round(totals.get(k,0)/targets[k]*100,1) if targets.get(k,0)>0 else 0 for k in targets}
    return {"date": today_start.strftime("%Y-%m-%d"), "totals": totals, "targets": targets, "meals_count": len(meals), "progress": progress}


@router.get("/weekly-report")
async def weekly_report(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    week_start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    meals = db.query(MealLog).filter(MealLog.user_id == current_user.id, MealLog.timestamp >= week_start).order_by(MealLog.timestamp).all()

    daily_data, totals_sum, days_with_data = [], {"calories":0,"protein":0,"fat":0,"carbs":0,"fiber":0}, 0
    for i in range(7):
        day = week_start + timedelta(days=i)
        day_end = day + timedelta(days=1)
        day_meals = [m for m in meals if day <= m.timestamp.replace(tzinfo=timezone.utc) < day_end]
        dt = _aggregate(day_meals)
        daily_data.append({"date": day.strftime("%Y-%m-%d"), "totals": dt, "meals_count": len(day_meals)})
        if day_meals:
            days_with_data += 1
            for k in totals_sum: totals_sum[k] += dt.get(k,0)

    avg = {k: round(v/days_with_data,1) for k,v in totals_sum.items()} if days_with_data else {}
    return {"start_date": week_start.strftime("%Y-%m-%d"), "end_date": now.strftime("%Y-%m-%d"), "daily_data": daily_data, "averages": avg}


def _aggregate(meals):
    t = {"calories":0,"protein":0,"fat":0,"carbs":0,"fiber":0,"sugar":0,"sodium_mg":0}
    for m in meals:
        if m.totals_json:
            for k in t: t[k] += m.totals_json.get(k,0)
    return {k: round(v,1) for k,v in t.items()}
