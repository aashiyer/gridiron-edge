from typing import Optional

from fastapi import APIRouter, Depends
from backend.auth import get_current_user
from backend.database import db_session
from backend.teams import team_meta

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _record(rows, field: str = "result") -> dict:
    wins = sum(1 for r in rows if r[field] == "win")
    losses = sum(1 for r in rows if r[field] == "loss")
    pushes = sum(1 for r in rows if r[field] == "push")
    decided = wins + losses
    win_pct = round(wins / decided * 100, 1) if decided else None
    return {"wins": wins, "losses": losses, "pushes": pushes, "win_pct": win_pct}


@router.get("")
def dashboard_summary(season: Optional[int] = None, current_user: dict = Depends(get_current_user), sport: str = "nfl"):
    query = (
        "SELECT p.pick_type, p.result FROM picks p JOIN games g ON g.game_id = p.game_id"
        " WHERE p.user_id = ? AND g.sport = ? AND p.result IN ('win', 'loss', 'push')"
    )
    params: list = [current_user["user_id"], "nba" if sport == "nba" else "nfl"]
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    with db_session() as conn:
        decided = conn.execute(query, params).fetchall()

    return {
        "straight_up": _record([p for p in decided if p["pick_type"] == "straight_up"]),
        "ats": _record([p for p in decided if p["pick_type"] == "ats"]),
        "total": _record([p for p in decided if p["pick_type"] == "total"]),
    }


@router.get("/vs-model")
def vs_model(current_user: dict = Depends(get_current_user)):
    """Compare your picks to the model's own snapshotted call on the same
    games — where you agreed, where you didn't, and who was right when you
    split. Covers straight_up/ats/total picks — the model snapshots a lean
    on totals too (backend/analysis.py's lean_total), so those are just as
    comparable as SU/ATS."""
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT p.*, g.season, g.week, g.home_team, g.away_team, g.final_home_score, g.final_away_score
            FROM picks p JOIN games g ON g.game_id = p.game_id
            WHERE p.model_lean IS NOT NULL AND g.sport = 'nfl' AND p.user_id = ?
            """,
            (current_user["user_id"],),
        ).fetchall()

    comparable = [r for r in rows if r["result"] in ("win", "loss", "push") and r["model_result"] in ("win", "loss", "push")]
    comparable_su = [r for r in comparable if r["pick_type"] == "straight_up"]
    comparable_ats = [r for r in comparable if r["pick_type"] == "ats"]
    comparable_total = [r for r in comparable if r["pick_type"] == "total"]
    agree = [r for r in comparable if r["selection"] == r["model_lean"]]
    disagree = [r for r in comparable if r["selection"] != r["model_lean"]]

    agree_and_won = sum(1 for r in agree if r["result"] == "win")
    agree_and_lost = sum(1 for r in agree if r["result"] == "loss")
    you_right_on_disagree = sum(1 for r in disagree if r["result"] == "win")
    model_right_on_disagree = sum(1 for r in disagree if r["model_result"] == "win")
    both_wrong_on_disagree = sum(1 for r in disagree if r["result"] != "win" and r["model_result"] != "win")

    disagreements = [
        {
            "pick_id": r["pick_id"],
            "game_id": r["game_id"],
            "season": r["season"],
            "week": r["week"],
            "matchup": f"{r['away_team']} @ {r['home_team']}",
            "pick_type": r["pick_type"],
            "your_pick": r["selection"],
            "your_pick_meta": team_meta(r["selection"]) if r["selection"] not in ("over", "under") else None,
            "model_pick": r["model_lean"],
            "model_pick_meta": team_meta(r["model_lean"]) if r["model_lean"] not in ("over", "under") else None,
            "your_result": r["result"],
            "model_result": r["model_result"],
            "final_score": f"{r['away_team']} {r['final_away_score']} - {r['final_home_score']} {r['home_team']}",
        }
        for r in sorted(disagree, key=lambda r: r["created_at"], reverse=True)
    ]

    return {
        "comparable_picks": len(comparable),
        "pending_comparable": sum(1 for r in rows if r["result"] == "pending" or r["model_result"] == "pending"),
        "your_record_su": _record(comparable_su, "result"),
        "your_record_ats": _record(comparable_ats, "result"),
        "your_record_total": _record(comparable_total, "result"),
        "model_record_su": _record(comparable_su, "model_result"),
        "model_record_ats": _record(comparable_ats, "model_result"),
        "model_record_total": _record(comparable_total, "model_result"),
        "agreement_pct": round(len(agree) / len(comparable) * 100, 1) if comparable else None,
        "agree_count": len(agree),
        "agree_and_won": agree_and_won,
        "agree_and_lost": agree_and_lost,
        "disagree_count": len(disagree),
        "you_right_on_disagree": you_right_on_disagree,
        "model_right_on_disagree": model_right_on_disagree,
        "both_wrong_on_disagree": both_wrong_on_disagree,
        "disagreements": disagreements,
    }
