"""
User profile endpoints + auth (register/login/logout).
GET  /api/v1/profile — User profile + daily targets.
PUT  /api/v1/profile — Update profile.
POST /api/v1/auth/register — Create account.
POST /api/v1/auth/login — Get JWT tokens.
POST /api/v1/auth/logout — Invalidate current token.
POST /api/v1/auth/refresh — Refresh access token.
"""

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from core.auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
    get_current_user, _is_token_revoked,
)
from core.config import get_config
from core.database import get_db
from core.models import User, RevokedToken
from core.nutrition import calculate_daily_targets
from core.schemas import (
    UserRegister, UserLogin, TokenResponse, RefreshRequest, LogoutRequest,
    ProfileUpdate, ProfileResponse,
)

router = APIRouter()

# P8: Bearer scheme for logout (needs the raw token)
_bearer = HTTPBearer()

# P18: Rate limiter for auth endpoints — prevents brute-force and account spam.
limiter = Limiter(key_func=get_remote_address)


def _is_admin_email(email: str) -> bool:
    """True if the email is in config's auth.admin_emails list.

    Previously this config was dead — admin status was only set via a manual
    DB flip. Wiring it here lets you become admin automatically by signing up
    / logging in with a configured admin email.
    """
    admin_emails = get_config().get("auth", {}).get("admin_emails", []) or []
    return email in admin_emails


def _revoke_raw_token(raw_token: str, db: Session) -> None:
    """Decode a JWT and insert its JTI into revoked_tokens if not already present."""
    try:
        payload = decode_token(raw_token)
        jti = payload.get("jti")
        exp = payload.get("exp")
        if jti and not _is_token_revoked(jti, db):
            revoked = RevokedToken(
                jti=jti,
                expires_at=datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None,
            )
            db.add(revoked)
    except Exception:
        pass  # Token already expired or invalid


def _prune_expired_tokens(db: Session) -> None:
    """Remove expired JWT revocation rows to prevent unbounded table growth."""
    try:
        now = datetime.now(timezone.utc)
        db.query(RevokedToken).filter(
            RevokedToken.expires_at.isnot(None),
            RevokedToken.expires_at < now,
        ).delete(synchronize_session=False)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@router.post("/auth/register", response_model=TokenResponse)
@limiter.limit("3/hour")
def register(request: Request, data: UserRegister, db: Session = Depends(get_db)):
    """Create a new user account. Body stats are optional but, when provided,
    they let daily targets be computed from signup rather than the generic defaults."""
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        weight_kg=data.weight_kg,
        height_cm=data.height_cm,
        age=data.age,
        gender=data.gender,
        activity_level=data.activity_level or "moderate",
        goal=data.goal or "maintain",
        is_admin=_is_admin_email(data.email),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        refresh_token=create_refresh_token({"sub": str(user.id)}),
        is_admin=bool(user.is_admin),
    )


@router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):
    """Authenticate and receive JWT tokens."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Re-grant admin if the email is in admin_emails and the account predates
    # the auto-grant-on-register logic. Keeps existing accounts in sync without
    # a manual DB edit.
    if not user.is_admin and _is_admin_email(user.email):
        user.is_admin = True
        db.commit()

    return TokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        refresh_token=create_refresh_token({"sub": str(user.id)}),
        is_admin=bool(user.is_admin),
    )


@router.post("/auth/logout")
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    body: Optional[LogoutRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Server-side logout — revokes both the current access token and optional refresh token."""
    _revoke_raw_token(credentials.credentials, db)
    if body and body.refresh_token:
        _revoke_raw_token(body.refresh_token, db)
    _prune_expired_tokens(db)
    db.commit()

    return {"status": "logged_out"}


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh_token(data: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange a refresh token for new access + refresh tokens (with rotation)."""
    payload = decode_token(data.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    jti = payload.get("jti")
    if _is_token_revoked(jti, db):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Rotate refresh token: revoke the old refresh token JTI
    exp = payload.get("exp")
    if jti:
        db.add(
            RevokedToken(
                jti=jti,
                expires_at=datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None,
            )
        )
        db.commit()

    return TokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        refresh_token=create_refresh_token({"sub": str(user.id)}),
        is_admin=bool(user.is_admin),
    )


# ---------------------------------------------------------------------------
# Profile endpoints
# ---------------------------------------------------------------------------
@router.get("/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    """Get current user's profile with calculated daily targets."""
    targets = calculate_daily_targets(current_user)

    return {
        "id": current_user.id,
        "email": current_user.email,
        "is_admin": bool(current_user.is_admin),
        "weight_kg": current_user.weight_kg,
        "height_cm": current_user.height_cm,
        "age": current_user.age,
        "gender": current_user.gender,
        "activity_level": current_user.activity_level,
        "goal": current_user.goal,
        "dietary_mode": current_user.dietary_mode,
        "allergens": current_user.allergens or [],
        "daily_targets": targets,
    }


@router.put("/profile")
def update_profile(
    updates: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user profile fields."""
    update_data = updates.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(current_user, key, value)

    db.commit()
    db.refresh(current_user)

    targets = calculate_daily_targets(current_user)
    return {
        "id": current_user.id,
        "email": current_user.email,
        "is_admin": bool(current_user.is_admin),
        "weight_kg": current_user.weight_kg,
        "height_cm": current_user.height_cm,
        "age": current_user.age,
        "gender": current_user.gender,
        "activity_level": current_user.activity_level,
        "goal": current_user.goal,
        "dietary_mode": current_user.dietary_mode,
        "allergens": current_user.allergens or [],
        "daily_targets": targets,
    }