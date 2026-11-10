from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException

from backend import stats
from backend.auth import get_current_user
from backend.sports import normalize_sport

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Stats are unavailable right now.")


@router.get("/players")
def player_stats(sport: str = "nfl", view: str = "", season: Optional[int] = None, qualified: bool = True, _user: dict = Depends(get_current_user)):
    return _guard(stats.players, normalize_sport(sport), view, season, qualified)


@router.get("/teams")
def team_stats(sport: str = "nfl", season: Optional[int] = None, _user: dict = Depends(get_current_user)):
    return _guard(stats.teams, normalize_sport(sport), season)


@router.get("/player/{athlete_id}")
def player_detail(athlete_id: str, sport: str = "nfl", _user: dict = Depends(get_current_user)):
    if not athlete_id.isdigit():
        raise HTTPException(status_code=400, detail="bad id")
    return _guard(stats.player, normalize_sport(sport), athlete_id)
