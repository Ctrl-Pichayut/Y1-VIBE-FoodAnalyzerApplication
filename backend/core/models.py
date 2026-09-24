"""
SQLAlchemy ORM models for users, food items, meal logs, and model versions.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, Text, JSON
)
from core.database import Base


def _utcnow():
    """Timezone-aware UTC now — replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    weight_kg = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String(20), default=None)  # male, female, other (drives Mifflin-St Jeor offset)
    activity_level = Column(String(50), default="moderate")  # sedentary, light, moderate, active, very_active
    goal = Column(String(50), default="maintain")  # lose, maintain, gain
    dietary_mode = Column(String(50), default="standard")  # standard, vegetarian, vegan, keto, etc.
    allergens = Column(JSON, default=list)  # ["shellfish", "eggs", ...]
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class FoodItem(Base):
    __tablename__ = "food_items"

    id = Column(Integer, primary_key=True, index=True)
    yolo_class_id = Column(Integer, unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    nutrition_json = Column(JSON, nullable=False)  # per_100g data
    health_score = Column(Integer, default=50)
    tags = Column(JSON, default=list)
    allergens = Column(JSON, default=list)


class MealLog(Base):
    __tablename__ = "meal_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    timestamp = Column(DateTime, default=_utcnow)
    scan_id = Column(String(36), index=True, nullable=True)
    foods_json = Column(JSON, nullable=False)  # list of detected foods + nutrition
    totals_json = Column(JSON, nullable=True)  # aggregated totals


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, index=True)
    version_tag = Column(String(50), nullable=False)
    pt_path = Column(String(500), nullable=False)
    class_count = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=_utcnow)
    is_active = Column(Boolean, default=False)


class NutritionReview(Base):
    """Admin-curated dish nutrition, sourced from Gemini estimates.

    When the analyze pipeline encounters a dish that's neither in
    nutrition_db.json nor a fuzzy match, and Gemini estimates its nutrition,
    a row is inserted here with status='pending'. An admin reviews the
    estimate in the mobile app and either promotes it (status='promoted') or
    rejects it.

    Promoted rows are queried by the analyze pipeline as a Tier 0 nutrition
    source -- once promoted, that dish never calls Gemini again. Storing these
    in Postgres (Supabase) means promotions persist across redeploys.
    """
    __tablename__ = "nutrition_reviews"

    id = Column(Integer, primary_key=True, index=True)
    dish_name = Column(String(255), unique=True, index=True, nullable=False)
    per_100g = Column(JSON, nullable=False)         # same shape as nutrition_db.json values
    allergens = Column(JSON, default=list)
    status = Column(String(20), default="pending")  # "pending" | "promoted" | "rejected"
    created_at = Column(DateTime, default=_utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    promoted_by = Column(Integer, nullable=True)    # User.id of the admin


class RevokedToken(Base):
    """P8 fix: Server-side token revocation — stores JTIs of logged-out tokens.

    The decode_token function checks this table before accepting a token.
    Rows can be cleaned up periodically by deleting entries whose
    expires_at is in the past.
    """
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(36), unique=True, index=True, nullable=False)
    revoked_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=True)  # for cleanup of expired entries
