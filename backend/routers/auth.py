from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from backend.auth import create_token, get_current_user, hash_password, verify_password
from backend.database import db_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class FavoriteTeamsRequest(BaseModel):
    teams: List[str]


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class DisplayNameRequest(BaseModel):
    display_name: str


def _user_out(row) -> dict:
    return {"user_id": row["user_id"], "email": row["email"], "display_name": row["display_name"]}


@router.post("/signup")
def signup(payload: SignupRequest):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    now = datetime.now(timezone.utc).isoformat()
    with db_session() as conn:
        existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (payload.email.lower(),)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="an account with that email already exists")

        is_first_user = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] == 0

        cur = conn.execute(
            "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?) RETURNING user_id",
            (payload.email.lower(), hash_password(payload.password), payload.display_name.strip(), now),
        )
        user_id = cur.fetchone()["user_id"]

        if is_first_user:
            conn.execute("UPDATE picks SET user_id = ? WHERE user_id IS NULL", (user_id,))

        row = conn.execute("SELECT user_id, email, display_name FROM users WHERE user_id = ?", (user_id,)).fetchone()

    return {"token": create_token(user_id), "user": _user_out(row)}


@router.post("/login")
def login(payload: LoginRequest):
    with db_session() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (payload.email.lower(),)).fetchone()
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    return {"token": create_token(row["user_id"]), "user": _user_out(row)}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        teams = [r["team"] for r in conn.execute(
            "SELECT team FROM user_favorite_teams WHERE user_id = ?", (current_user["user_id"],)
        ).fetchall()]
    return {**current_user, "favorite_teams": teams}


@router.post("/password")
def change_password(payload: PasswordChangeRequest, current_user: dict = Depends(get_current_user)):
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="new password must be at least 8 characters")
    with db_session() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE user_id = ?", (current_user["user_id"],)).fetchone()
        if not row or not verify_password(payload.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE user_id = ?",
            (hash_password(payload.new_password), current_user["user_id"]),
        )
    return {"status": "ok"}


@router.post("/display-name")
def change_display_name(payload: DisplayNameRequest, current_user: dict = Depends(get_current_user)):
    name = payload.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display name can't be empty")
    with db_session() as conn:
        conn.execute("UPDATE users SET display_name = ? WHERE user_id = ?", (name, current_user["user_id"]))
    return {"display_name": name}


@router.put("/favorite-teams")
def set_favorite_teams(payload: FavoriteTeamsRequest, current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        conn.execute("DELETE FROM user_favorite_teams WHERE user_id = ?", (current_user["user_id"],))
        for team in payload.teams:
            conn.execute(
                "INSERT INTO user_favorite_teams (user_id, team) VALUES (?, ?) ON CONFLICT (user_id, team) DO NOTHING",
                (current_user["user_id"], team),
            )
    return {"teams": payload.teams}
