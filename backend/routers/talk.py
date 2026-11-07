import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.database import db_session
from backend.sports import normalize_sport
from backend.ttl_cache import clear_cache, ttl_memo

router = APIRouter(prefix="/api/talk", tags=["talk"])

EMOJIS = ["🔥", "😂", "💀", "👏", "🤡"]
MAX_LEN = 280
_last_post: dict = {}


class PostRequest(BaseModel):
    body: str
    sport: str = "nfl"
    season: Optional[int] = None
    week: Optional[int] = None


class ReactRequest(BaseModel):
    emoji: str


@ttl_memo("talk", 45)
def _feed(conn, sport: str, limit: int):
    posts = conn.execute(
        """SELECT t.id, t.user_id, t.body, t.season, t.week, t.created_at, u.display_name, u.avatar_version
           FROM trash_talk t JOIN users u ON u.user_id = t.user_id WHERE t.sport = ? ORDER BY t.id DESC LIMIT ?""",
        (sport, limit),
    ).fetchall()
    posts = [dict(p) for p in posts]
    if posts:
        ids = [p["id"] for p in posts]
        ph = ",".join("?" for _ in ids)
        reacts = conn.execute(f"SELECT post_id, user_id, emoji FROM trash_reactions WHERE post_id IN ({ph})", tuple(ids)).fetchall()
        by_post: dict = {}
        for r in reacts:
            by_post.setdefault(r["post_id"], {}).setdefault(r["emoji"], []).append(r["user_id"])
        for p in posts:
            p["reactions"] = by_post.get(p["id"], {})
    return posts


@router.get("")
def list_posts(sport: str = "nfl", limit: int = 30, _user: dict = Depends(get_current_user)):
    with db_session() as conn:
        return _feed(conn, normalize_sport(sport), min(limit, 60))


@router.post("")
def create_post(payload: PostRequest, current_user: dict = Depends(get_current_user)):
    body = payload.body.strip()
    if not body or len(body) > MAX_LEN:
        raise HTTPException(status_code=400, detail=f"Say something, up to {MAX_LEN} characters.")
    now = time.time()
    if now - _last_post.get(current_user["user_id"], 0) < 5:
        raise HTTPException(status_code=429, detail="Slow down a few seconds.")
    _last_post[current_user["user_id"]] = now
    with db_session() as conn:
        conn.execute(
            "INSERT INTO trash_talk (user_id, sport, season, week, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (current_user["user_id"], normalize_sport(payload.sport), payload.season, payload.week, body, datetime.now(timezone.utc).isoformat()),
        )
    clear_cache("talk")
    return {"ok": True}


@router.delete("/{post_id}")
def delete_post(post_id: int, current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        row = conn.execute("SELECT user_id FROM trash_talk WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not found")
        if row["user_id"] != current_user["user_id"] and not current_user.get("is_admin"):
            raise HTTPException(status_code=403, detail="not yours")
        conn.execute("DELETE FROM trash_reactions WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM trash_talk WHERE id = ?", (post_id,))
    clear_cache("talk")
    return {"ok": True}


@router.post("/{post_id}/react")
def react(post_id: int, payload: ReactRequest, current_user: dict = Depends(get_current_user)):
    if payload.emoji not in EMOJIS:
        raise HTTPException(status_code=400, detail="unknown reaction")
    with db_session() as conn:
        if not conn.execute("SELECT 1 FROM trash_talk WHERE id = ?", (post_id,)).fetchone():
            raise HTTPException(status_code=404, detail="not found")
        have = conn.execute(
            "SELECT 1 FROM trash_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?", (post_id, current_user["user_id"], payload.emoji)
        ).fetchone()
        if have:
            conn.execute("DELETE FROM trash_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?", (post_id, current_user["user_id"], payload.emoji))
        else:
            conn.execute("INSERT INTO trash_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)", (post_id, current_user["user_id"], payload.emoji))
    clear_cache("talk")
    return {"ok": True}
