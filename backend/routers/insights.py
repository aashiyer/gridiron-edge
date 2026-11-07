from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.database import db_session
from backend.insights import league_cached, recap
from backend.sports import normalize_sport
from backend.ttl_cache import ttl_memo

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/league")
def league_stats(sport: str = "nfl", season: Optional[int] = None, _user: dict = Depends(get_current_user)):
    with db_session() as conn:
        return league_cached(conn, normalize_sport(sport), season)


@ttl_memo("recap", 300)
def _recap(conn, sport: str, season: int, week: int):
    return recap(conn, sport, season, week)


@router.get("/recap")
def week_recap(season: int, week: int, sport: str = "nfl", _user: dict = Depends(get_current_user)):
    with db_session() as conn:
        result = _recap(conn, normalize_sport(sport), season, week)
    if result is None:
        raise HTTPException(status_code=404, detail="no picks that week")
    return result
