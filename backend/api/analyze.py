"""
POST /api/v1/analyze — Upload image → food detection + nutrition JSON.

Hybrid recognition pipeline (config: recognition.mode):
  • "yolo"    → local YOLO only (offline, deterministic classes)
  • "gemini"  → Gemini vision API only
  • "hybrid"  → YOLO first; if its best confidence is below
                recognition.confidence_threshold, retry with Gemini

Nutrition is resolved in tiers for every recognized dish:
  1. exact / case-insensitive match against nutrition_db.json
  2. fuzzy match (difflib) against the same DB
  3. if both miss AND the dish came from Gemini → ask Gemini to estimate

Each returned food carries a `source` provenance field:
  • "yolo"          → YOLO-detected (nutrition from its curated DB class)
  • "nutrition_db"  → Gemini-detected but matched to curated DB data
  • "gemini"        → Gemini-detected with Gemini-estimated nutrition
and `verified` (True = curated nutrition_db, False = estimate).

The image is never written to disk — processed in memory only.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, File, UploadFile, Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from PIL import Image
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.nutrition import NutritionService, _normalize_name
from core.gemini_recognizer import GeminiRecognizer, GeminiDish, GeminiNutrition
from core.schemas import AnalyzeResponse, DetectedFood, NutritionPer100g, MealTotals
from core.auth import decode_token, _is_token_revoked
from core.models import User, MealLog, NutritionReview
from core.database import get_db
from api.profile import limiter

router = APIRouter()

# Optional auth — allows unauthenticated access for scanning
_optional_bearer = HTTPBearer(auto_error=False)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(_optional_bearer),
    db: Session = Depends(get_db),
):
    """Return the current user if a valid, non-revoked token is provided, otherwise None."""
    if credentials is None:
        return None
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            return None
        if _is_token_revoked(payload.get("jti"), db):
            return None
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return db.query(User).filter(User.id == int(user_id)).first()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Empty-nutrition placeholder for foods with no data source
# ---------------------------------------------------------------------------
_EMPTY_NUTRITION: Dict[str, Any] = {
    "calories": 0, "protein": 0, "fat": 0, "carbs": 0,
    "fiber": 0, "sugar": 0, "sodium_mg": 0,
    "vitamin_c_mg": 0, "saturated_fat_g": 0,
}


@router.post("/analyze", response_model=AnalyzeResponse)
@limiter.limit("15/minute")
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Upload a food image for AI analysis. Returns detected foods with
    nutritional data, health scores, per-food provenance (`source`),
    and computed meal totals."""
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Shared state from app lifespan
    config = request.app.state.config
    max_mb = config.get("server", {}).get("max_upload_size_mb", 10)
    max_bytes = int(max_mb * 1024 * 1024)

    # Read and open image (kept in memory — never persisted)
    contents = await file.read()
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds maximum upload size of {max_mb} MB",
        )

    try:
        image = Image.open(BytesIO(contents))
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    model_manager = request.app.state.model_manager
    gemini: GeminiRecognizer = getattr(
        request.app.state, "gemini_recognizer", None
    )

    # P6 fix: Use the singleton NutritionService from app.state
    nutrition_svc: NutritionService = request.app.state.nutrition_svc

    # --- Detect dishes per the configured mode ----------------------------
    candidates: List[_Candidate] = await _detect(
        config, model_manager, gemini, image, contents, file.content_type
    )

    if not candidates:
        return AnalyzeResponse(
            foods=[],
            totals=MealTotals(),
            scan_id=str(uuid.uuid4()),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    # --- Enrich each candidate with nutrition + health metadata -----------
    foods: List[DetectedFood] = []
    for cand in candidates:
        nutrition, source, verified = await _resolve_nutrition(
            nutrition_svc, gemini, config, cand, db
        )

        canon_name = nutrition_svc.canonicalize_name(cand.name)
        health = nutrition_svc.compute_health_score(nutrition, canon_name)
        serving_g = cand.serving_g or nutrition_svc.estimate_serving_grams(canon_name, nutrition)
        tags = nutrition_svc.get_tags(nutrition)
        gi = nutrition_svc.get_glycemic_index(nutrition, canon_name)
        allergens = nutrition.get("allergens", [])

        foods.append(DetectedFood(
            name=canon_name,
            confidence=cand.confidence,
            serving_estimate_g=serving_g,
            per_100g=NutritionPer100g(
                calories=nutrition.get("calories", 0),
                protein=nutrition.get("protein", 0),
                fat=nutrition.get("fat", 0),
                carbs=nutrition.get("carbs", 0),
                fiber=nutrition.get("fiber", 0),
                sugar=nutrition.get("sugar", 0),
                sodium_mg=nutrition.get("sodium_mg", 0),
                vitamin_c_mg=nutrition.get("vitamin_c_mg", 0),
                saturated_fat_g=nutrition.get("saturated_fat_g", 0),
            ),
            health_score=health["health_score"],
            health_label=health["health_label"],
            tags=tags,
            allergens=allergens,
            glycemic_index=gi,
            bbox=cand.bbox,
            source=source,
            verified=verified,
        ))

    scan_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    # P2 fix: Compute totals server-side so every response includes them.
    totals = compute_totals([f.model_dump() for f in foods])

    return AnalyzeResponse(
        foods=foods,
        totals=MealTotals(**totals),
        scan_id=scan_id,
        timestamp=timestamp,
    )


# ---------------------------------------------------------------------------
# Internal: detection candidates (mode-agnostic shape)
# ---------------------------------------------------------------------------
class _Candidate:
    """A detected dish awaiting nutrition enrichment."""
    __slots__ = ("name", "confidence", "serving_g", "origin", "bbox")

    def __init__(self, name: str, confidence: float, serving_g: int, origin: str, bbox: Optional[List[float]] = None):
        self.name = name
        self.confidence = confidence
        self.serving_g = serving_g
        self.origin = origin  # "yolo" | "gemini"
        self.bbox = bbox


async def _predict_yolo_async(model_manager, image: Image.Image) -> List[_Candidate]:
    """Run CPU-bound YOLO inference in a background worker thread so the
    FastAPI asyncio event loop is never blocked."""
    detections = await asyncio.to_thread(model_manager.predict, image)
    return _from_yolo(detections)


async def _detect(
    config: dict,
    model_manager,
    gemini: Optional[GeminiRecognizer],
    image: Image.Image,
    image_bytes: bytes,
    mime_type: str,
) -> List[_Candidate]:
    """Run detection according to recognition.mode, returning candidates."""
    mode = config["recognition"]["mode"]
    conf_threshold = config["recognition"].get("confidence_threshold", 0.65)

    # --- YOLO-only ------------------------------------------------------
    if mode == "yolo":
        return await _predict_yolo_async(model_manager, image)

    # --- Gemini-only ----------------------------------------------------
    if mode == "gemini":
        return await _from_gemini(gemini, image_bytes, mime_type, model_manager, image)

    # --- Hybrid: YOLO first, fuse or fall back to Gemini ----------------
    if mode == "hybrid":
        yolo_cands = await _predict_yolo_async(model_manager, image)
        best_conf = max((c.confidence for c in yolo_cands), default=0.0)
        if yolo_cands and best_conf >= conf_threshold:
            return yolo_cands
        # Low/none → try Gemini, and merge any high-confidence YOLO boxes with non-duplicate Gemini dishes
        gem_cands = await _from_gemini(gemini, image_bytes, mime_type, model_manager, image)
        if not gem_cands:
            return yolo_cands
        if not yolo_cands:
            return gem_cands
        # Hybrid fusion: if Gemini returned dishes, prefer Gemini's dish list but attach YOLO bbox if matching name lacks a bbox
        yolo_by_norm = {_normalize_name(c.name): c for c in yolo_cands}
        for gc in gem_cands:
            norm = _normalize_name(gc.name)
            if gc.bbox is None and norm in yolo_by_norm:
                gc.bbox = yolo_by_norm[norm].bbox
        return gem_cands

    # Unknown mode → safe default to YOLO
    print(f"[analyze] unknown recognition.mode '{mode}' — defaulting to yolo")
    return await _predict_yolo_async(model_manager, image)


def _from_yolo(detections: List[Dict[str, Any]]) -> List[_Candidate]:
    """Convert raw YOLO detections into candidates tagged origin='yolo'."""
    return [
        _Candidate(name=d["name"], confidence=d["confidence"], serving_g=0, origin="yolo", bbox=d.get("bbox"))
        for d in detections
    ]


def _convert_box_2d(box_2d: Optional[List[int]], orig_w: int, orig_h: int) -> Optional[List[float]]:
    """Convert Gemini [ymin, xmin, ymax, xmax] (0..1000) to pixel [x1, y1, x2, y2]."""
    if not box_2d or len(box_2d) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = [float(v) for v in box_2d]
        if xmax <= xmin or ymax <= ymin:
            return None
        x1 = round(max(0.0, min(1000.0, xmin)) / 1000.0 * orig_w, 1)
        y1 = round(max(0.0, min(1000.0, ymin)) / 1000.0 * orig_h, 1)
        x2 = round(max(0.0, min(1000.0, xmax)) / 1000.0 * orig_w, 1)
        y2 = round(max(0.0, min(1000.0, ymax)) / 1000.0 * orig_h, 1)
        return [x1, y1, x2, y2]
    except Exception:
        return None


async def _from_gemini(
    gemini: Optional[GeminiRecognizer],
    image_bytes: bytes,
    mime_type: str,
    model_manager,
    image: Image.Image,
) -> List[_Candidate]:
    """Run Gemini recognition; if disabled/erroring, fall back to YOLO."""
    if gemini is None or not gemini.enabled:
        return await _predict_yolo_async(model_manager, image)

    dishes: List[GeminiDish] = await gemini.recognize(image_bytes, mime_type)
    if not dishes:
        # Gemini returned nothing (error or genuinely empty) → use YOLO
        return await _predict_yolo_async(model_manager, image)

    orig_w, orig_h = image.size
    return [
        _Candidate(
            name=d.dish_name,
            confidence=d.confidence,
            serving_g=d.estimated_serving_g,
            origin="gemini",
            bbox=_convert_box_2d(d.box_2d, orig_w, orig_h),
        )
        for d in dishes
    ]


# ---------------------------------------------------------------------------
# Internal: nutrition resolution
#   Tier 0: admin-promoted NutritionReview row (verified, no Gemini call)
#   Tier 1: exact / case-insensitive nutrition_db.json match
#   Tier 2: fuzzy nutrition_db.json match
#   Tier 2.5: Open Food Facts fallback (with bounded LRU cache)
#   Tier 3: Gemini estimate (gemini-origin only) — auto-captures a pending review row
# ---------------------------------------------------------------------------
async def _resolve_nutrition(
    nutrition_svc: NutritionService,
    gemini: Optional[GeminiRecognizer],
    config: dict,
    cand: _Candidate,
    db,
) -> Tuple[Dict[str, Any], str, bool]:
    """Resolve nutrition for one candidate.

    Returns (nutrition_dict, source, verified).
    """
    fuzzy_threshold = config["recognition"].get("fuzzy_match_threshold", 0.75)

    # Tier 0 — admin-promoted review row. Once a dish has been promoted, it
    # behaves like a curated DB entry (verified) and never calls Gemini again.
    promoted = _lookup_promoted(db, cand.name)
    if promoted is not None:
        return promoted, "nutrition_db", True

    # Tier 1 — exact / case-insensitive
    nutrition = nutrition_svc.get_nutrition(cand.name)
    if nutrition is not None:
        source = "yolo" if cand.origin == "yolo" else "nutrition_db"
        return dict(nutrition), source, True

    # Tier 2 — fuzzy
    match = nutrition_svc.fuzzy_match(cand.name, threshold=fuzzy_threshold)
    if match is not None:
        _key, fuzzy_nutrition = match
        source = "yolo" if cand.origin == "yolo" else "nutrition_db"
        return dict(fuzzy_nutrition), source, True

    # Tier 2.5 — Open Food Facts fallback (if enabled in config.yaml)
    fallback_api = config.get("nutritional", {}).get("fallback_api", "")
    if fallback_api == "openfoodfacts":
        off_data = await nutrition_svc.fallback_lookup(cand.name)
        if off_data is not None:
            return off_data, "openfoodfacts", True

    # Tier 3 — Gemini estimate (gemini-origin only)
    if cand.origin == "gemini" and gemini is not None and gemini.enabled:
        estimate: Optional[GeminiNutrition] = await gemini.estimate_nutrition(cand.name)
        if estimate is not None:
            estimate_dict = estimate.model_dump()
            # Auto-capture this estimate as a pending review row so an admin
            # can later promote it. Deduped by dish_name — only the first
            # scan of a new dish creates a row.
            _capture_for_review(db, cand.name, estimate_dict)
            return estimate_dict, "gemini", False

    # No data anywhere — placeholder, keep the detector's origin as source
    return dict(_EMPTY_NUTRITION), cand.origin, False


def _lookup_promoted(db, dish_name: str) -> Optional[Dict[str, Any]]:
    """Find an admin-promoted NutritionReview row for a dish name.

    Tries exact match, then SQL-level case-insensitive. Returns the per_100g
    dict (with allergens merged in) or None.
    """
    # P5 fix: Use SQL func.lower() for case-insensitive match instead of
    # loading all promoted rows into Python memory.
    row = (
        db.query(NutritionReview)
        .filter(
            NutritionReview.status == "promoted",
            NutritionReview.dish_name == dish_name,
        )
        .first()
    )
    if row is None:
        # Case-insensitive fallback — single indexed query instead of .all()
        row = (
            db.query(NutritionReview)
            .filter(
                NutritionReview.status == "promoted",
                func.lower(NutritionReview.dish_name) == dish_name.lower(),
            )
            .first()
        )
    if row is None:
        return None

    # Merge allergens into the per_100g dict so downstream code (which reads
    # nutrition.get("allergens", [])) sees them consistently with DB entries.
    out = dict(row.per_100g)
    out["allergens"] = row.allergens or []
    return out


def _capture_for_review(db, dish_name: str, per_100g: Dict[str, Any]) -> None:
    """Insert a pending NutritionReview row for a Gemini-estimated dish,
    but only if one doesn't already exist for that name (any status).

    This is how the admin review queue fills automatically as users scan
    dishes that aren't in nutrition_db.json.
    """
    existing = (
        db.query(NutritionReview)
        .filter(NutritionReview.dish_name == dish_name)
        .first()
    )
    if existing is not None:
        return  # Already captured (pending/promoted/rejected) — don't duplicate

    try:
        db.add(NutritionReview(
            dish_name=dish_name,
            per_100g=per_100g,
            allergens=[],
            status="pending",
        ))
        db.commit()
    except Exception as e:
        # Never let review-capture break a user's scan
        db.rollback()
        print(f"[review] failed to capture '{dish_name}': {e}")


def compute_totals(foods: list) -> dict:
    """Aggregate nutritional totals across all detected foods.

    Used both by the /analyze endpoint (P2 fix) and by the /history POST
    endpoint as a server-side fallback when the client doesn't send totals.
    """
    totals = {
        "calories": 0, "protein": 0, "fat": 0, "carbs": 0,
        "fiber": 0, "sugar": 0, "sodium_mg": 0,
    }
    for food in foods:
        per_100g = food.get("per_100g", {})
        serving = food.get("serving_estimate_g", 250)
        multiplier = serving / 100.0
        for key in totals:
            totals[key] += per_100g.get(key, 0) * multiplier

    # Round all values
    return {k: round(v, 1) for k, v in totals.items()}
