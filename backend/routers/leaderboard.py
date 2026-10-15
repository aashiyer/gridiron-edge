from typing import Optional

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.database import db_session
from backend.routers.games import list_games

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

MIN_DECIDED_FOR_WEEK_AWARDS = 6
MARKETS = ("straight_up", "ats", "total")


def _record(picks: list) -> dict:
    wins = sum(1 for p in picks if p["result"] == "win")
    losses = sum(1 for p in picks if p["result"] == "loss")
    pushes = sum(1 for p in picks if p["result"] == "push")
    decided = wins + losses
    return {"wins": wins, "losses": losses, "pushes": pushes, "win_pct": round(wins / decided * 100, 1) if decided else None}


def _season_picks(conn, season: int) -> list:
    return conn.execute(
        """
        SELECT p.user_id, u.display_name, p.game_id, p.pick_type, p.selection, p.line_at_pick_time, p.result, g.week
        FROM picks p
        JOIN users u ON u.user_id = p.user_id
        JOIN games g ON g.game_id = p.game_id
        WHERE g.season = ?
        """,
        (season,),
    ).fetchall()


def _week_status(conn, season: int) -> list:
    rows = conn.execute(
        "SELECT week, COUNT(*) AS n, SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final_n FROM games WHERE season = ? GROUP BY week ORDER BY week",
        (season,),
    ).fetchall()
    return [{"week": r["week"], "games": r["n"], "complete": r["final_n"] == r["n"]} for r in rows]


def _standings_entries(picks: list, weeks: list, you: int) -> list:
    complete_weeks = {w["week"] for w in weeks if w["complete"]}
    final_games = sum(w["games"] for w in weeks if w["complete"])

    by_user: dict = {}
    for p in picks:
        by_user.setdefault(p["user_id"], {"display_name": p["display_name"], "picks": []})["picks"].append(p)

    weekly: dict = {}
    for user_id, data in by_user.items():
        per_week: dict = {}
        for p in data["picks"]:
            if p["week"] in complete_weeks and p["pick_type"] in ("straight_up", "ats"):
                per_week.setdefault(p["week"], []).append(p)
        weekly[user_id] = per_week

    week_pct: dict = {}
    for user_id, per_week in weekly.items():
        for week, rows in per_week.items():
            rec = _record(rows)
            decided = rec["wins"] + rec["losses"]
            if decided >= MIN_DECIDED_FOR_WEEK_AWARDS:
                week_pct[(user_id, week)] = (rec["wins"] / decided, rec, rows)

    week_wins: dict = {u: 0 for u in by_user}
    for week in complete_weeks:
        scores = {u: v[0] for (u, w), v in week_pct.items() if w == week}
        if scores:
            top = max(scores.values())
            for u, s in scores.items():
                if s == top:
                    week_wins[u] += 1

    def week_summary(user_id: int, pick):
        entries = [(week, v) for (u, week), v in week_pct.items() if u == user_id]
        if not entries:
            return None
        week, (pct, _, rows) = pick(entries, key=lambda e: (e[1][0], e[1][1]["wins"]))
        su = _record([r for r in rows if r["pick_type"] == "straight_up"])
        ats = _record([r for r in rows if r["pick_type"] == "ats"])
        return {"week": week, "win_pct": round(pct * 100, 1), "su": su, "ats": ats}

    entries = []
    for user_id, data in by_user.items():
        mine = data["picks"]
        su = [p for p in mine if p["pick_type"] == "straight_up"]
        ats = [p for p in mine if p["pick_type"] == "ats"]
        total = [p for p in mine if p["pick_type"] == "total"]
        picked_final = len({p["game_id"] for p in mine if p["week"] in complete_weeks and p["pick_type"] in ("straight_up", "ats")})
        entries.append(
            {
                "user_id": user_id,
                "display_name": data["display_name"],
                "is_you": user_id == you,
                "straight_up": _record(su),
                "ats": _record(ats),
                "total": _record(total),
                "games_picked": picked_final,
                "games_available": final_games,
                "best_week": week_summary(user_id, max),
                "worst_week": week_summary(user_id, min),
                "week_wins": week_wins[user_id],
            }
        )

    entries.sort(key=lambda e: (-(e["ats"]["win_pct"] or -1), -(e["ats"]["wins"] + e["ats"]["losses"]), e["display_name"].lower()))
    for i, e in enumerate(entries, start=1):
        e["rank"] = i
    return entries


@router.get("/standings")
def standings(season: int, current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        picks = _season_picks(conn, season)
        weeks = _week_status(conn, season)
    current_week = next((w["week"] for w in weeks if not w["complete"]), weeks[-1]["week"] if weeks else None)
    return {
        "season": season,
        "weeks": weeks,
        "current_week": current_week,
        "entries": _standings_entries(picks, weeks, current_user["user_id"]),
    }


@router.get("/week")
def week_board(season: int, week: int, current_user: dict = Depends(get_current_user)):
    games = list_games(season=season, week=week)
    with db_session() as conn:
        season_picks = _season_picks(conn, season)
        weeks = _week_status(conn, season)

    order = {e["user_id"]: e["rank"] for e in _standings_entries(season_picks, weeks, current_user["user_id"])}
    week_picks = [p for p in season_picks if p["week"] == week]

    picks_by_game: dict = {}
    for p in week_picks:
        picks_by_game.setdefault(p["game_id"], {}).setdefault(str(p["user_id"]), {})[p["pick_type"]] = {
            "selection": p["selection"],
            "line": p["line_at_pick_time"],
            "result": p["result"],
        }

    records: dict = {}
    for user_id in order:
        mine = [p for p in week_picks if p["user_id"] == user_id]
        records[str(user_id)] = {
            "straight_up": _record([p for p in mine if p["pick_type"] == "straight_up"]),
            "ats": _record([p for p in mine if p["pick_type"] == "ats"]),
            "total": _record([p for p in mine if p["pick_type"] == "total"]),
            "games_picked": len({p["game_id"] for p in mine}),
        }

    names = {p["user_id"]: p["display_name"] for p in season_picks}
    users = [
        {"user_id": u, "display_name": names[u], "is_you": u == current_user["user_id"]}
        for u in sorted(order, key=lambda u: order[u])
    ]
    return {
        "season": season,
        "week": week,
        "complete": all(g["status"] == "final" for g in games) if games else False,
        "users": users,
        "games": games,
        "picks": picks_by_game,
        "records": records,
    }
