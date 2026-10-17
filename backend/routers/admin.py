from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.auth import RequireAdmin, hash_password
from backend.database import db_session

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
def list_users(_admin: dict = RequireAdmin):
    """Every registered user, most recent signup first — admin-only (see
    backend/auth.py's ADMIN_EMAILS), not exposed to regular users at all."""
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT u.user_id, u.email, u.display_name, u.created_at, u.avatar_version,
                   (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.user_id) AS pick_count
            FROM users u
            ORDER BY u.created_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


class PasswordReset(BaseModel):
    new_password: str


@router.post("/users/{user_id}/password")
def reset_user_password(user_id: int, body: PasswordReset, _admin: dict = RequireAdmin):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    with db_session() as conn:
        user = conn.execute("SELECT user_id, display_name FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        conn.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", (hash_password(body.new_password), user_id))
    return {"user_id": user_id, "display_name": user["display_name"], "status": "password reset"}
