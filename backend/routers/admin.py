from fastapi import APIRouter

from backend.auth import RequireAdmin
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
