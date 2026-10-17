from fastapi import APIRouter
from backend.sports import nba_team_list
from backend.teams import TEAMS, team_meta

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("")
def list_teams(sport: str = "nfl"):
    if sport == "nba":
        return nba_team_list()
    return [team_meta(abbr) for abbr in TEAMS]
