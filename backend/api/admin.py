"""
Admin endpoints for model management + dish-nutrition review.

Model management:
  POST /api/admin/update-model  — Upload new best.pt (admin JWT required).
  GET  /api/admin/model-info    — Current model version + class count.

Dish review (promote Gemini estimates into verified nutrition):
  GET  /api/admin/review-queue         — Paginated list of pending dishes.
  GET  /api/admin/review-queue/stats   — Counts by status (pending/promoted/rejected).
  POST /api/admin/review/{review_id}   — Promote or reject a captured estimate.
"""

import tempfile, shutil
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, File, UploadFile, Request, HTTPException, Form, Query
from core.auth import get_admin_user
from core.models import User, ModelVersion, NutritionReview
from core.schemas import ReviewActionRequest
from core.config import save_config
from core.database import get_db
from sqlalchemy.orm import Session

router = APIRouter()


@router.get("/model-info")
async def model_info(request: Request, admin: User = Depends(get_admin_user)):
    config = request.app.state.config
    mm = request.app.state.model_manager
    return {
        "version": config["model"]["version"],
        "class_count": mm.class_count,
        "model_path": config["model"]["path"],
        "device": config["model"]["device"],
        "confidence_threshold": config["model"]["confidence_threshold"],
    }


@router.post("/update-model")
async def update_model(
    request: Request,
    file: UploadFile = File(...),
    version: str = Form(...),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Hot-swap the active YOLO model. Admin only."""
    if not file.filename.endswith((".pt", ".onnx")):
        raise HTTPException(400, "Model must be .pt or .onnx")

    base_dir = request.app.state.base_dir
    config = request.app.state.config
    mm = request.app.state.model_manager
    config_path = base_dir / "config.yaml"

    # Save upload to temp file
    tmp = base_dir / "models" / f"_upload_{file.filename}"
    try:
        contents = await file.read()
        with open(tmp, "wb") as f:
            f.write(contents)

        result = mm.hot_swap(tmp, version)

        # Update config version
        config["model"]["version"] = version
        save_config(config_path, config)

        # Log to database
        mv = ModelVersion(version_tag=version, pt_path=config["model"]["path"], class_count=result["class_count"], is_active=True)
        db.query(ModelVersion).update({"is_active": False})
        db.add(mv)
        db.commit()

        return {"status": "ok", "class_count": result["class_count"], "version": version}
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        if tmp.exists():
            tmp.unlink()


# ---------------------------------------------------------------------------
# Dish-nutrition review (promote Gemini estimates → verified)
# ---------------------------------------------------------------------------
@router.get("/review-queue")
async def review_queue(
    status: str = Query("pending"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """List dishes awaiting admin review (default: pending)."""
    if status not in ("pending", "promoted", "rejected", "all"):
        raise HTTPException(400, "status must be pending|promoted|rejected|all")

    q = db.query(NutritionReview)
    if status != "all":
        q = q.filter(NutritionReview.status == status)
    total = q.count()
    rows = (
        q.order_by(NutritionReview.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "items": [_serialize_review(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@router.get("/review-queue/stats")
async def review_queue_stats(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Counts of review items by status — for a header badge."""
    return {
        "pending": db.query(NutritionReview).filter(NutritionReview.status == "pending").count(),
        "promoted": db.query(NutritionReview).filter(NutritionReview.status == "promoted").count(),
        "rejected": db.query(NutritionReview).filter(NutritionReview.status == "rejected").count(),
    }


@router.post("/review/{review_id}")
async def submit_review(
    review_id: int,
    body: ReviewActionRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Promote or reject a captured Gemini nutrition estimate.

    On 'promote', the optional per_100g/allergens override the captured
    estimate — letting the admin correct values first. Once promoted, the
    analyze pipeline returns this row's nutrition as verified (Tier 0),
    so future scans never call Gemini for this dish again.
    """
    row = db.query(NutritionReview).filter(NutritionReview.id == review_id).first()
    if row is None:
        raise HTTPException(404, "Review item not found")
    if row.status != "pending":
        raise HTTPException(400, f"Item already {row.status}")

    # Map action → status. The action vocabulary ("promote"/"reject") differs
    # from the status vocabulary ("promoted"/"rejected") that Tier 0 lookup
    # and the stats endpoint filter on.
    row.status = "promoted" if body.action == "promote" else "rejected"
    row.reviewed_at = datetime.now(timezone.utc)
    row.promoted_by = admin.id

    # On promote, optionally accept corrected nutrition from the admin
    if body.action == "promote":
        if body.per_100g is not None:
            row.per_100g = body.per_100g.model_dump()
        if body.allergens is not None:
            row.allergens = body.allergens

    db.commit()
    db.refresh(row)
    return _serialize_review(row)


def _serialize_review(r: NutritionReview) -> dict:
    return {
        "id": r.id,
        "dish_name": r.dish_name,
        "per_100g": r.per_100g,
        "allergens": r.allergens or [],
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "promoted_by": r.promoted_by,
    }
