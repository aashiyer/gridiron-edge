from typing import Optional

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.database import db_session
from backend.model_stats import model_report
from backend.teams import team_meta

router = APIRouter(prefix="/api/model-stats", tags=["model"])


@router.get("")
def model_stats(season: Optional[int] = None, user_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    """The model's record on every game it called, how each person compares,
    and the selected person's disagreements with it."""
    uid = user_id or current_user["user_id"]
    with db_session() as conn:
        report = model_report(conn, uid, season)
    return {**report, "you": current_user["user_id"], "user_id": uid,
            "team_meta": {t: team_meta(t) for t in report["teams_seen"]}}
