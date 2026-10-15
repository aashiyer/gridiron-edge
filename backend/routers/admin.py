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
            SELECT u.user_id, u.email, u.display_name, u.created_at,
                   (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.user_id) AS pick_count
            FROM users u
            ORDER BY u.created_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


class PasswordResetRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, payload: PasswordResetRequest, _admin: dict = RequireAdmin):
    """Set another user's password — admin-only."""
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="new password must be at least 8 characters")
    with db_session() as conn:
        row = conn.execute("SELECT email FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE user_id = ?",
            (hash_password(payload.new_password), user_id),
        )
    return {"status": "ok", "email": row["email"]}
