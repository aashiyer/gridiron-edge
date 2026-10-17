from typing import Optional

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.week_export import render_week_slides

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/week")
def export_week(season: int, week: int, user_ids: Optional[str] = None, _user: dict = Depends(get_current_user)):
    wanted = [int(x) for x in user_ids.split(",") if x.strip().isdigit()] if user_ids else None
    return {"slides": render_week_slides(season, week, wanted)}

