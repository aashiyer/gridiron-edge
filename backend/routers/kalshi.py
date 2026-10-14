from fastapi import APIRouter

from backend.database import db_session
from backend.kalshi import odds_for_games

router = APIRouter(prefix="/api/kalshi", tags=["kalshi"])


@router.get("")
def kalshi_odds(season: int, week: int):
    with db_session() as conn:
        games = [
            dict(r)
            for r in conn.execute(
                "SELECT game_id, home_team, away_team, kickoff_time FROM games WHERE season = ? AND week = ? AND status != 'final'",
                (season, week),
            ).fetchall()
        ]
    return odds_for_games(games)
