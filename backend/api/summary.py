"""
Daily summary and weekly report endpoints.
GET /api/v1/daily-summary — Today's totals vs. targets.
GET /api/v1/weekly-report — 7-day nutrition trend data.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from core.auth import get_current_user
from core.database import get_db
from core.models import User, MealLog
from core.nutrition import calculate_daily_targets

router = APIRouter()


@router.get("/daily-summary")
def daily_summary(
    tz_offset_minutes: int = Query(
        0,
        ge=-840,
        le=840,
        description="Client timezone offset in minutes east of UTC (e.g. 420 for UTC+7)",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client_tz = timezone(timedelta(minutes=tz_offset_minutes))
    now_local = datetime.now(client_tz)
    today_start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end_local = today_start_local + timedelta(days=1)

    today_start_utc = today_start_local.astimezone(timezone.utc)
    today_end_utc = today_end_local.astimezone(timezone.utc)

    # Fetch candidate rows with a 1-day buffer to avoid naive/aware SQLite comparison quirks,
    # then filter accurately in UTC.
    candidates = (
        db.query(MealLog)
        .filter(
            MealLog.user_id == current_user.id,
            MealLog.timestamp >= (today_start_utc - timedelta(days=1)).replace(tzinfo=None),
        )
        .all()
    )
    meals = [
        m for m in candidates
        if today_start_utc <= _ensure_utc(m.timestamp) < today_end_utc
    ]

    totals = _aggregate(meals)
    targets = calculate_daily_targets(current_user)
    progress = {
        k: round(totals.get(k, 0) / targets[k] * 100, 1) if targets.get(k, 0) > 0 else 0
        for k in targets
    }
    return {
        "date": today_start_local.strftime("%Y-%m-%d"),
        "totals": totals,
        "targets": targets,
        "meals_count": len(meals),
        "progress": progress,
    }


@router.get("/weekly-report")
def weekly_report(
    tz_offset_minutes: int = Query(
        0,
        ge=-840,
        le=840,
        description="Client timezone offset in minutes east of UTC (e.g. 420 for UTC+7)",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client_tz = timezone(timedelta(minutes=tz_offset_minutes))
    now_local = datetime.now(client_tz)
    week_start_local = (now_local - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_utc = week_start_local.astimezone(timezone.utc)

    meals = (
        db.query(MealLog)
        .filter(
            MealLog.user_id == current_user.id,
            MealLog.timestamp >= (week_start_utc - timedelta(days=1)).replace(tzinfo=None),
        )
        .order_by(MealLog.timestamp)
        .all()
    )

    daily_data = []
    totals_sum = {"calories": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0, "sugar": 0, "sodium_mg": 0}
    days_with_data = 0

    for i in range(7):
        day_local = week_start_local + timedelta(days=i)
        day_start_utc = day_local.astimezone(timezone.utc)
        day_end_utc = (day_local + timedelta(days=1)).astimezone(timezone.utc)
        day_meals = [
            m for m in meals
            if day_start_utc <= _ensure_utc(m.timestamp) < day_end_utc
        ]
        dt = _aggregate(day_meals)
        daily_data.append({
            "date": day_local.strftime("%Y-%m-%d"),
            "totals": dt,
            "meals_count": len(day_meals),
        })
        if day_meals:
            days_with_data += 1
            for k in totals_sum:
                totals_sum[k] += dt.get(k, 0)

    avg = {k: round(v / days_with_data, 1) for k, v in totals_sum.items()} if days_with_data else {}
    return {
        "start_date": week_start_local.strftime("%Y-%m-%d"),
        "end_date": now_local.strftime("%Y-%m-%d"),
        "daily_data": daily_data,
        "averages": avg,
        "daily_targets": calculate_daily_targets(current_user),
    }


def _ensure_utc(dt: datetime) -> datetime:
    """Normalize a datetime to UTC-aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _aggregate(meals):
    """Aggregate nutritional totals from meal logs.

    P2 fix: Falls back to computing totals from foods_json when totals_json
    is null, preventing meals from silently contributing zero.
    """
    t = {"calories": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0, "sugar": 0, "sodium_mg": 0}
    for m in meals:
        meal_totals = m.totals_json
        if not meal_totals and m.foods_json:
            from api.analyze import compute_totals
            meal_totals = compute_totals(m.foods_json)
        if meal_totals:
            for k in t:
                t[k] += meal_totals.get(k, 0)
    return {k: round(v, 1) for k, v in t.items()}
