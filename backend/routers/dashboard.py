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
def dashboard_summary(current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        all_picks = conn.execute(
            "SELECT p.*, g.home_team, g.away_team, g.season, g.week FROM picks p JOIN games g ON g.game_id = p.game_id"
            " WHERE p.user_id = ?",
            (current_user["user_id"],),
        ).fetchall()

    decided = [p for p in all_picks if p["result"] in ("win", "loss", "push")]
    su = [p for p in decided if p["pick_type"] == "straight_up"]
    ats = [p for p in decided if p["pick_type"] == "ats"]
    total_bets = [p for p in decided if p["pick_type"] == "total"]

    by_team: dict = {}
    for p in ats:
        team = p["selection"]
        by_team.setdefault(team, []).append(p)

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
        "by_week": {
            week: {"straight_up": _record(rows["straight_up"]), "ats": _record(rows["ats"])}
            for week, rows in sorted(by_week.items())
        },
        "break_even_pct": 52.4,
    }


@router.get("/leaderboard")
def leaderboard(season: Optional[int] = None, week: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    """Every user's record side by side, ranked by ATS win% specifically —
    straight-up stays its own column, never fused into one blended number
    (totals excluded from ranking entirely, same as the rest of the app's
    convention). Ties broken by who's actually decided more picks so a 1-0
    account doesn't outrank a 40-12 one. Auth-gated like everything else —
    not for public consumption — but deliberately not scoped to the caller,
    since the whole point is comparing across users.

    season/week scope this to one week's picks instead of the all-time
    total — standings are meant to reset week to week, not just accumulate
    forever, same as how the Picker page itself is organized by week."""
    query = """
        SELECT p.user_id, u.display_name, p.pick_type, p.result
        FROM picks p
        JOIN users u ON u.user_id = p.user_id
        JOIN games g ON g.game_id = p.game_id
        WHERE p.result IN ('win', 'loss', 'push') AND p.pick_type IN ('straight_up', 'ats')
    """
    params: list = []
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    if week is not None:
        query += " AND g.week = ?"
        params.append(week)

    with db_session() as conn:
        rows = conn.execute(query, params).fetchall()

    by_user: dict = {}
    for r in rows:
        by_user.setdefault(r["user_id"], {"display_name": r["display_name"], "rows": []})["rows"].append(r)

    entries = []
    for user_id, data in by_user.items():
        decided = data["rows"]
        su = [r for r in decided if r["pick_type"] == "straight_up"]
        ats = [r for r in decided if r["pick_type"] == "ats"]
        entries.append(
            {
                "user_id": user_id,
                "display_name": data["display_name"],
                "is_you": user_id == current_user["user_id"],
                "straight_up": _record(su),
                "ats": _record(ats),
                "decided_count": len(decided),
            }
        )

    entries.sort(key=lambda e: (e["ats"]["win_pct"] if e["ats"]["win_pct"] is not None else -1, e["decided_count"]), reverse=True)
    for i, e in enumerate(entries):
        e["rank"] = i + 1

    return {"entries": entries}


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
