"""
Pydantic schemas for API request/response validation.
"""

from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------
class UserRegister(BaseModel):
    # P7 fix: EmailStr validates email format; password has min length.
    email: EmailStr
    password: str = Field(min_length=8, description="Password must be at least 8 characters")
    # Optional body stats — when provided, TDEE targets are computed at signup
    # instead of falling back to generic defaults.
    weight_kg: Optional[float] = Field(default=None, ge=1, le=500)
    height_cm: Optional[float] = Field(default=None, ge=50, le=300)
    age: Optional[int] = Field(default=None, ge=1, le=150)
    gender: Optional[str] = None        # male, female, other
    activity_level: Optional[str] = None  # sedentary, light, moderate, active, very_active
    goal: Optional[str] = None          # lose, maintain, gain

class UserLogin(BaseModel):
    # P7 fix: EmailStr for login too.
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    is_admin: bool = False

class RefreshRequest(BaseModel):
    refresh_token: str

class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


# ---------------------------------------------------------------------------
# Profile schemas
# ---------------------------------------------------------------------------
class ProfileUpdate(BaseModel):
    # P7 fix: range validation on body stats.
    weight_kg: Optional[float] = Field(default=None, ge=1, le=500)
    height_cm: Optional[float] = Field(default=None, ge=50, le=300)
    age: Optional[int] = Field(default=None, ge=1, le=150)
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    goal: Optional[str] = None
    dietary_mode: Optional[str] = None
    allergens: Optional[List[str]] = None

class ProfileResponse(BaseModel):
    id: int
    email: str
    weight_kg: Optional[float]
    height_cm: Optional[float]
    age: Optional[int]
    gender: Optional[str]
    activity_level: str
    goal: str
    dietary_mode: str
    allergens: List[str]
    daily_targets: Optional[Dict[str, float]] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Food / Nutrition schemas
# ---------------------------------------------------------------------------
class NutritionPer100g(BaseModel):
    calories: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0
    fiber: float = 0
    sugar: float = 0
    sodium_mg: float = 0
    vitamin_c_mg: float = 0
    saturated_fat_g: float = 0

class DetectedFood(BaseModel):
    name: str
    confidence: float
    serving_estimate_g: int
    per_100g: NutritionPer100g
    health_score: int
    health_label: str
    tags: List[str]
    allergens: List[str]
    glycemic_index: str
    bbox: Optional[List[float]] = None
    # Hybrid-recognition provenance (additive — defaults keep older clients
    # and stored history rows valid). source = where the nutrition came from;
    # verified = True means curated nutrition_db data, False = a model estimate.
    source: str = "yolo"          # "yolo" | "gemini" | "nutrition_db"
    verified: bool = True

# P2 fix: Server-side computed meal totals.
class MealTotals(BaseModel):
    """Aggregated nutritional totals for a meal, computed server-side."""
    calories: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0
    fiber: float = 0
    sugar: float = 0
    sodium_mg: float = 0

class AnalyzeResponse(BaseModel):
    foods: List[DetectedFood]
    totals: MealTotals = Field(default_factory=MealTotals)
    scan_id: str
    timestamp: str


# ---------------------------------------------------------------------------
# History schemas
# ---------------------------------------------------------------------------
class MealLogCreate(BaseModel):
    foods_json: List[Dict[str, Any]]
    totals_json: Optional[Dict[str, Any]] = None
    meal_type: Optional[str] = None
    scan_id: Optional[str] = None

class MealLogUpdate(BaseModel):
    foods_json: List[Dict[str, Any]]
    totals_json: Optional[Dict[str, Any]] = None
    meal_type: Optional[str] = None

class MealLogResponse(BaseModel):
    id: int
    user_id: int
    timestamp: datetime
    scan_id: Optional[str]
    meal_type: Optional[str] = "snack"
    foods_json: List[Dict[str, Any]]
    totals_json: Optional[Dict[str, Any]]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Summary schemas
# ---------------------------------------------------------------------------
class DailySummary(BaseModel):
    date: str
    totals: Dict[str, float]
    targets: Dict[str, float]
    meals_count: int

class WeeklyReport(BaseModel):
    start_date: str
    end_date: str
    daily_data: List[Dict[str, Any]]
    averages: Dict[str, float]


# ---------------------------------------------------------------------------
# Admin schemas
# ---------------------------------------------------------------------------
class ModelInfoResponse(BaseModel):
    version: str
    class_count: int
    model_path: str
    device: str
    confidence_threshold: float

class ModelUpdateResponse(BaseModel):
    status: str
    class_count: int
    version: str


# ---------------------------------------------------------------------------
# Admin review schemas (dish promotion pipeline)
# ---------------------------------------------------------------------------
class ReviewActionRequest(BaseModel):
    """Admin action on a pending NutritionReview row.

    On 'promote', the optional per_100g/allergens override the captured
    Gemini estimate — letting the admin correct values before they become
    canonical. On 'reject' they're ignored.
    """
    action: str = Field(pattern="^(promote|reject)$")
    per_100g: Optional[NutritionPer100g] = None
    allergens: Optional[List[str]] = None
