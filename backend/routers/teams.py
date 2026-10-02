from fastapi import APIRouter
from backend.teams import TEAMS, team_meta

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("")
def list_teams():
    return [team_meta(abbr) for abbr in TEAMS]
