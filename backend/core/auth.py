"""
JWT authentication utilities — token creation, verification, and
password hashing. Supports access + refresh token pattern.
"""

from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from core.config import get_config
from core.database import get_db
from core.models import User

# ---------------------------------------------------------------------------
# Password hashing — using bcrypt directly (passlib has issues on Python 3.14)
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))

# ---------------------------------------------------------------------------
# JWT tokens — sourced from config.yaml (auth section) so the secret is not
# hardcoded. Defaults keep the app running if a key is missing.
# ---------------------------------------------------------------------------
_auth_cfg = get_config().get("auth", {})

SECRET_KEY = _auth_cfg.get("secret_key") or "CHANGE-ME-IN-PRODUCTION-use-openssl-rand-hex-32"
ALGORITHM = _auth_cfg.get("algorithm", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(_auth_cfg.get("access_token_expire_minutes", 30))
REFRESH_TOKEN_EXPIRE_DAYS = int(_auth_cfg.get("refresh_token_expire_days", 7))

if SECRET_KEY.startswith("CHANGE-ME"):
    print("[WARN] auth.secret_key in config.yaml is still a placeholder. "
          "Set it (e.g. `openssl rand -hex 32`) before running in production.")

security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the current user from the JWT bearer token."""
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Require the current user to have admin privileges."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
