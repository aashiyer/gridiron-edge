import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from backend.database import db_session

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 30

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "aashiyer29@gmail.com").split(",")
    if e.strip()
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except jwt.PyJWTError:
        return None


def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="not authenticated")
    token = auth_header[7:]
    user_id = _decode_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    with db_session() as conn:
        row = conn.execute("SELECT user_id, email, display_name FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="user not found")
    user = dict(row)
    user["is_admin"] = user["email"].lower() in ADMIN_EMAILS
    return user


CurrentUser = Depends(get_current_user)


def require_admin(current_user: dict = CurrentUser) -> dict:
    if not current_user["is_admin"]:
        raise HTTPException(status_code=403, detail="admin access required")
    return current_user


RequireAdmin = Depends(require_admin)
