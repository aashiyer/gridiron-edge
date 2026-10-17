from typing import Optional

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.current_lines import current_lines, display_line
from backend.database import db_session
from backend.sports import normalize_sport
from backend.ttl_cache import ttl_memo
from backend.routers.games import list_games

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

MIN_DECIDED_FOR_WEEK_AWARDS = 8
MARKETS = ("straight_up", "ats", "total")
REQUIRED_MARKETS = ("straight_up", "ats")


def _record(picks: list) -> dict:
    wins = sum(1 for p in picks if p["result"] == "win")
    losses = sum(1 for p in picks if p["result"] == "loss")
    pushes = sum(1 for p in picks if p["result"] == "push")
    decided = wins + losses
    return {"wins": wins, "losses": losses, "pushes": pushes, "win_pct": round(wins / decided * 100, 1) if decided else None}


def _nba_season_counts(conn, season: int) -> list:
    """The NBA has too many games to load every pick, so the season is read as
    one summary row per person, week, market and result, then expanded into
    lightweight rows the shared standings code can count."""
    rows = conn.execute(
        """
        SELECT p.user_id, u.display_name, u.avatar_version, g.week, p.pick_type, p.result, COUNT(*) AS n
        FROM picks p
        JOIN users u ON u.user_id = p.user_id
        JOIN games g ON g.game_id = p.game_id
        WHERE g.season = ? AND g.sport = 'nba'
        GROUP BY p.user_id, u.display_name, u.avatar_version, g.week, p.pick_type, p.result
        """,
        (season,),
    ).fetchall()
    out = []
    for r in rows:
        base = {
            "user_id": r["user_id"], "display_name": r["display_name"], "avatar_version": r["avatar_version"],
            "week": r["week"], "pick_type": r["pick_type"], "result": r["result"],
            "game_id": None, "selection": None, "line_at_pick_time": None, "kickoff_time": None, "home_team": None, "missed": False,
        }
        out.extend(dict(base) for _ in range(r["n"]))
    return out


@ttl_memo("season_picks", 120)
def _season_picks(conn, season: int, sport: str = "nfl") -> list:
    if sport == "nba":
        return _nba_season_counts(conn, season)
    rows = conn.execute(
        """
        SELECT p.user_id, u.display_name, u.avatar_version, p.game_id, p.pick_type, p.selection, p.line_at_pick_time, p.graded_line, p.result, g.week, g.kickoff_time, g.home_team
        FROM picks p
        JOIN users u ON u.user_id = p.user_id
        JOIN games g ON g.game_id = p.game_id
        WHERE g.season = ? AND g.sport = 'nfl'
        """,
        (season,),
    ).fetchall()
    picks = [{**dict(r), "missed": False} for r in rows]

    pending_games = list({p["game_id"] for p in picks if p["result"] not in ("win", "loss", "push") and p["pick_type"] != "straight_up"})
    lines = current_lines(conn, pending_games)
    for p in picks:
        p["line_at_pick_time"] = display_line(p, p["home_team"], lines) if p["pick_type"] != "straight_up" else None

    latest_season = conn.execute("SELECT MAX(season) AS s FROM games WHERE sport = 'nfl'").fetchone()["s"]
    if season != latest_season:
        return picks

    finals = conn.execute(
        "SELECT game_id, week, kickoff_time FROM games WHERE season = ? AND status = 'final' AND sport = 'nfl'", (season,)
    ).fetchall()
    have = {(p["user_id"], p["game_id"], p["pick_type"]) for p in picks}
    names = {p["user_id"]: p["display_name"] for p in picks}
    versions = {p["user_id"]: p["avatar_version"] for p in picks}
    first_kickoff: dict = {}
    for p in picks:
        if p["pick_type"] in REQUIRED_MARKETS and p["kickoff_time"]:
            key = (p["user_id"], p["pick_type"])
            first_kickoff[key] = min(first_kickoff.get(key, p["kickoff_time"]), p["kickoff_time"])

    for (user_id, pick_type), start in first_kickoff.items():
        for g in finals:
            if g["kickoff_time"] and g["kickoff_time"] < start:
                continue
            if (user_id, g["game_id"], pick_type) in have:
                continue
            picks.append(
                {
                    "user_id": user_id,
                    "display_name": names[user_id],
                    "avatar_version": versions[user_id],
                    "game_id": g["game_id"],
                    "pick_type": pick_type,
                    "selection": None,
                    "line_at_pick_time": None,
                    "result": "loss",
                    "week": g["week"],
                    "kickoff_time": g["kickoff_time"],
                    "missed": True,
                }
            )
    return picks


def _week_status(conn, season: int, sport: str = "nfl") -> list:
    rows = conn.execute(
        "SELECT week, COUNT(*) AS n, SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS final_n FROM games WHERE season = ? AND sport = ? GROUP BY week ORDER BY week",
        (season, sport),
    ).fetchall()
    return [{"week": r["week"], "games": r["n"], "complete": r["final_n"] == r["n"]} for r in rows]


def _standings_entries(picks: list, weeks: list, you: int, sport: str = "nfl") -> list:
    complete_weeks = {w["week"] for w in weeks if w["complete"]}
    final_games = sum(w["games"] for w in weeks if w["complete"])

    by_user: dict = {}
    for p in picks:
        by_user.setdefault(p["user_id"], {"display_name": p["display_name"], "avatar_version": p["avatar_version"], "picks": []})["picks"].append(p)

    weekly: dict = {}
    for user_id, data in by_user.items():
        per_week: dict = {}
        for p in data["picks"]:
            if p["week"] in complete_weeks and p["pick_type"] == "ats":
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
        return {"week": week, "win_pct": round(pct * 100, 1), "ats": _record(rows)}

    entries = []
    for user_id, data in by_user.items():
        mine = data["picks"]
        su = [p for p in mine if p["pick_type"] == "straight_up"]
        ats = [p for p in mine if p["pick_type"] == "ats"]
        total = [p for p in mine if p["pick_type"] == "total"]
        if sport == "nba":
            picked_final = sum(1 for p in mine if p["pick_type"] == "ats")
        else:
            picked_final = len(
                {p["game_id"] for p in mine if p["week"] in complete_weeks and p["pick_type"] in REQUIRED_MARKETS and not p["missed"]}
            )
        entries.append(
            {
                "user_id": user_id,
                "display_name": data["display_name"],
                "avatar_version": data["avatar_version"],
                "is_you": user_id == you,
                "straight_up": _record(su),
                "ats": _record(ats),
                "total": _record(total),
                "games_picked": picked_final,
                "games_available": None if sport == "nba" else final_games,
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
def standings(season: int, current_user: dict = Depends(get_current_user), sport: str = "nfl"):
    sport = normalize_sport(sport)
    with db_session() as conn:
        picks = _season_picks(conn, season, sport)
        weeks = _week_status(conn, season, sport)
    current_week = next((w["week"] for w in weeks if not w["complete"]), weeks[-1]["week"] if weeks else None)
    return {
        "season": season,
        "weeks": weeks,
        "current_week": current_week,
        "entries": _standings_entries(picks, weeks, current_user["user_id"], sport),
    }


@ttl_memo("week_picks_nba", 120)
def _nba_week_picks(conn, season: int, week: int) -> list:
    rows = conn.execute(
        """
        SELECT p.user_id, p.game_id, p.pick_type, p.selection, p.line_at_pick_time, p.graded_line, p.result, g.home_team
        FROM picks p JOIN games g ON g.game_id = p.game_id
        WHERE g.season = ? AND g.week = ? AND g.sport = 'nba'
        """,
        (season, week),
    ).fetchall()
    picks = [{**dict(r), "missed": False} for r in rows]
    pending = list({p["game_id"] for p in picks if p["result"] not in ("win", "loss", "push") and p["pick_type"] != "straight_up"})
    lines = current_lines(conn, pending)
    for p in picks:
        p["line_at_pick_time"] = display_line(p, p["home_team"], lines) if p["pick_type"] != "straight_up" else None
    return picks


@router.get("/week")
def week_board(season: int, week: int, current_user: dict = Depends(get_current_user), sport: str = "nfl"):
    sport = normalize_sport(sport)
    games = list_games(season=season, week=week, sport=sport)
    with db_session() as conn:
        season_picks = _season_picks(conn, season, sport)
        weeks = _week_status(conn, season, sport)
        nba_week = _nba_week_picks(conn, season, week) if sport == "nba" else None

    order = {e["user_id"]: e["rank"] for e in _standings_entries(season_picks, weeks, current_user["user_id"], sport)}
    week_picks = nba_week if nba_week is not None else [p for p in season_picks if p["week"] == week]

    picks_by_game: dict = {}
    for p in week_picks:
        picks_by_game.setdefault(p["game_id"], {}).setdefault(str(p["user_id"]), {})[p["pick_type"]] = {
            "selection": p["selection"],
            "line": p["line_at_pick_time"],
            "result": p["result"],
            "missed": p["missed"],
        }

    records: dict = {}
    for user_id in order:
        mine = [p for p in week_picks if p["user_id"] == user_id]
        records[str(user_id)] = {
            "straight_up": _record([p for p in mine if p["pick_type"] == "straight_up"]),
            "ats": _record([p for p in mine if p["pick_type"] == "ats"]),
            "total": _record([p for p in mine if p["pick_type"] == "total"]),
            "games_picked": len({p["game_id"] for p in mine if not p["missed"]}),
        }

    names = {p["user_id"]: p["display_name"] for p in season_picks}
    versions = {p["user_id"]: p["avatar_version"] for p in season_picks}
    users = [
        {"user_id": u, "display_name": names[u], "avatar_version": versions[u], "is_you": u == current_user["user_id"]}
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
