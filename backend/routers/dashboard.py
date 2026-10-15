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
def dashboard_summary(season: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    query = (
        "SELECT p.*, g.home_team, g.away_team, g.season, g.week, g.home_spread_close FROM picks p JOIN games g ON g.game_id = p.game_id"
        " WHERE p.user_id = ?"
    )
    params: list = [current_user["user_id"]]
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    with db_session() as conn:
        all_picks = conn.execute(query, params).fetchall()

    decided = [p for p in all_picks if p["result"] in ("win", "loss", "push")]
    su = [p for p in decided if p["pick_type"] == "straight_up"]
    ats = [p for p in decided if p["pick_type"] == "ats"]
    total_bets = [p for p in decided if p["pick_type"] == "total"]

    by_team: dict = {}
    for p in ats:
        team = p["selection"]
        by_team.setdefault(team, []).append(p)

    su_by_team: dict = {}
    su_favorite, su_underdog, ats_laying, ats_taking = [], [], [], []
    for p in su:
        su_by_team.setdefault(p["selection"], []).append(p)
        line = p["home_spread_close"]
        if line is None or line == 0:
            continue
        team_line = line if p["selection"] == p["home_team"] else -line
        (su_favorite if team_line < 0 else su_underdog).append(p)
    for p in ats:
        line = p["line_at_pick_time"]
        if line is None or line == 0:
            continue
        (ats_laying if line < 0 else ats_taking).append(p)

    by_week: dict = {}
    for p in decided:
        if p["pick_type"] not in ("straight_up", "ats"):
            continue
        key = f"{p['season']}-W{p['week']}"
        by_week.setdefault(key, {"straight_up": [], "ats": []})[p["pick_type"]].append(p)

    return {
        "straight_up": _record(su),
        "ats": _record(ats),
        "total": _record(total_bets),
        "pending_count": sum(1 for p in all_picks if p["result"] == "pending"),
        "by_team": {team: _record(rows) for team, rows in by_team.items()},
        "su_by_team": {team: _record(rows) for team, rows in su_by_team.items()},
        "tendencies": {
            "su_favorite": _record(su_favorite),
            "su_underdog": _record(su_underdog),
            "ats_laying": _record(ats_laying),
            "ats_taking": _record(ats_taking),
        },
        "by_week": {
            week: {"straight_up": _record(rows["straight_up"]), "ats": _record(rows["ats"])}
            for week, rows in sorted(by_week.items())
        },
        "break_even_pct": 52.4,
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
            WHERE p.model_lean IS NOT NULL AND p.user_id = ?
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
