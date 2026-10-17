from fastapi import APIRouter, HTTPException, Response

from backend.database import db_session

router = APIRouter(prefix="/api/avatars", tags=["avatars"])

_CACHE: dict = {}


@router.get("/{user_id}")
def get_avatar(user_id: int, v: int = 0):
    key = (user_id, v)
    jpeg = _CACHE.get(key)
    if jpeg is None:
        with db_session() as conn:
            row = conn.execute("SELECT avatar FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if not row or row["avatar"] is None:
            raise HTTPException(status_code=404, detail="no avatar")
        jpeg = bytes(row["avatar"])
        _CACHE[key] = jpeg
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})
