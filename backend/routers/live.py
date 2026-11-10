from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
import requests

from backend.auth import get_current_user
from backend.live import game, scoreboard
from backend.sports import normalize_sport

router = APIRouter(prefix="/api/live", tags=["live"])


@router.get("/scoreboard")
def live_scoreboard(sport: str = "nfl", date: Optional[str] = None, week: Optional[int] = None, _user: dict = Depends(get_current_user)):
    if date and not (len(date) == 8 and date.isdigit()):
        raise HTTPException(status_code=400, detail="date must be YYYYMMDD")
    try:
        return scoreboard(normalize_sport(sport), date, week)
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Live scores are unavailable right now.")


@router.get("/game/{game_id}")
def live_game(game_id: str, since: Optional[int] = None, _user: dict = Depends(get_current_user)):
    try:
        return game(game_id, since)
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Live data is unavailable right now.")
