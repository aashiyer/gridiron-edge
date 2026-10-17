from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.database import db_session
from backend.ttl_cache import ttl_memo

router = APIRouter(prefix="/api/records", tags=["records"])

WIN_UNITS = 100 / 110
MIN_RANK_DECIDED = 30
MIN_WEEK_DECIDED = 8
ROLLING_WINDOW = 25
DECIDED = ("win", "loss", "push")
EASTERN = ZoneInfo("America/New_York")


def _rec(rows: list) -> dict:
    wins = sum(1 for r in rows if r["result"] == "win")
    losses = sum(1 for r in rows if r["result"] == "loss")
    pushes = sum(1 for r in rows if r["result"] == "push")
    decided = wins + losses
    return {"wins": wins, "losses": losses, "pushes": pushes, "win_pct": round(wins / decided * 100, 1) if decided else None}


def _units(rows: list) -> float:
    return round(sum(WIN_UNITS if r["result"] == "win" else -1.0 if r["result"] == "loss" else 0.0 for r in rows), 2)


@ttl_memo("records", 300)
def _load_picks(conn, user_id: int, season) -> list:
    query = """
        SELECT p.pick_type, p.selection, p.result, COALESCE(p.graded_line, p.line_at_pick_time) AS line,
               g.season, g.week, g.kickoff_time, g.home_team, g.away_team, g.div_game, g.home_spread_close
        FROM picks p JOIN games g ON g.game_id = p.game_id
        WHERE p.user_id = ? AND p.pick_type IN ('straight_up', 'ats')
    """
    params: list = [user_id]
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    query += " ORDER BY g.kickoff_time, p.pick_id"
    return [dict(r) for r in conn.execute(query, params).fetchall()]


@ttl_memo("records_group", 300)
def _group_counts(conn) -> dict:
    rows = conn.execute(
        """
        SELECT p.pick_type, p.user_id, g.season,
               SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END) AS wins,
               SUM(CASE WHEN p.result = 'loss' THEN 1 ELSE 0 END) AS losses
        FROM picks p JOIN games g ON g.game_id = p.game_id
        WHERE p.pick_type IN ('ats', 'straight_up') AND p.result IN ('win', 'loss')
        GROUP BY p.pick_type, p.user_id, g.season
        """
    ).fetchall()
    return {(r["pick_type"], r["user_id"], r["season"]): (r["wins"], r["losses"]) for r in rows}


def _rank(group: dict, pick_type: str, user_id: int, season) -> Optional[dict]:
    totals: dict = {}
    for (kind, uid, s), (w, l) in group.items():
        if kind != pick_type or (season is not None and s != season):
            continue
        cw, cl = totals.get(uid, (0, 0))
        totals[uid] = (cw + w, cl + l)
    eligible = {u: w / (w + l) for u, (w, l) in totals.items() if w + l >= MIN_RANK_DECIDED}
    if user_id not in eligible:
        return None
    ordered = sorted(eligible.values(), reverse=True)
    return {"rank": ordered.index(eligible[user_id]) + 1, "of": len(eligible)}


def _week_label(season: int, week: int) -> str:
    names = {19: "WC", 20: "DIV", 21: "CONF", 22: "SB"}
    return f"{season} {names.get(week, f'W{week}')}"


def _team_line(pick: dict) -> Optional[float]:
    if pick["pick_type"] == "ats":
        return pick["line"]
    close = pick["home_spread_close"]
    if close is None:
        return None
    return close if pick["selection"] == pick["home_team"] else -close


def _eastern(kickoff: Optional[str]) -> Optional[datetime]:
    if not kickoff:
        return None
    try:
        if kickoff.endswith("Z"):
            return datetime.strptime(kickoff, "%Y-%m-%dT%H:%MZ").replace(tzinfo=ZoneInfo("UTC")).astimezone(EASTERN)
        return datetime.strptime(kickoff[:16], "%Y-%m-%dT%H:%M")
    except ValueError:
        return None


def _slot(kickoff: Optional[str]) -> Optional[str]:
    d = _eastern(kickoff)
    if d is None:
        return None
    return "Primetime" if d.hour >= 19 else "Day games"


def _splits(picks: list) -> list:
    def bucket(p):
        out = []
        line = _team_line(p)
        if line:
            out.append(("Favorite or underdog", "Favorites" if line < 0 else "Underdogs"))
        if p["selection"] in (p["home_team"], p["away_team"]):
            out.append(("Home or road", "Picked the home team" if p["selection"] == p["home_team"] else "Picked the road team"))
        if p["div_game"] is not None:
            out.append(("Division games", "Division games" if p["div_game"] else "Non-division games"))
        slot = _slot(p["kickoff_time"])
        if slot:
            out.append(("Time slot", slot))
        w = p["week"]
        out.append(("Part of the season", "Early (wk 1-6)" if w <= 6 else "Middle (wk 7-12)" if w <= 12 else "Late (wk 13-18)" if w <= 18 else "Playoffs"))
        close = p["home_spread_close"]
        if close is not None:
            size = abs(close)
            out.append(("Spread size", "Up to 3" if size <= 3 else "3.5 to 6.5" if size <= 6.5 else "7 to 9.5" if size <= 9.5 else "10 or more"))
        return out

    order = {
        "Favorite or underdog": ["Favorites", "Underdogs"],
        "Home or road": ["Picked the home team", "Picked the road team"],
        "Division games": ["Division games", "Non-division games"],
        "Time slot": ["Day games", "Primetime"],
        "Part of the season": ["Early (wk 1-6)", "Middle (wk 7-12)", "Late (wk 13-18)", "Playoffs"],
        "Spread size": ["Up to 3", "3.5 to 6.5", "7 to 9.5", "10 or more"],
    }
    grouped: dict = {title: {label: [] for label in labels} for title, labels in order.items()}
    for p in picks:
        for title, label in bucket(p):
            grouped[title][label].append(p)
    return [
        {"title": title, "items": [{"label": label, "record": _rec(rows)} for label, rows in labels.items() if rows]}
        for title, labels in grouped.items()
    ]


def _build(picks: list, user_id: int, season, group: dict) -> dict:
    decided = [p for p in picks if p["result"] in DECIDED]
    ats = [p for p in decided if p["pick_type"] == "ats"]
    su = [p for p in decided if p["pick_type"] == "straight_up"]

    by_week: dict = {}
    pending_weeks = {(p["season"], p["week"]) for p in picks if p["result"] not in DECIDED}
    for p in decided:
        by_week.setdefault((p["season"], p["week"]), []).append(p)

    def week_marks(pick_type: str):
        per_week: dict = {}
        for p in decided:
            if p["pick_type"] == pick_type:
                per_week.setdefault((p["season"], p["week"]), []).append(p)
        marks = []
        for key, rows in per_week.items():
            if key in pending_weeks:
                continue
            rec = _rec(rows)
            n = rec["wins"] + rec["losses"]
            if n >= MIN_WEEK_DECIDED:
                marks.append({"season": key[0], "week": key[1], "label": _week_label(*key), "win_pct": round(rec["wins"] / n * 100, 1), "wins": rec["wins"], "losses": rec["losses"], "pushes": rec["pushes"]})
        best = max(marks, key=lambda m: (m["win_pct"], m["wins"]), default=None)
        worst = min(marks, key=lambda m: (m["win_pct"], -m["losses"]), default=None)
        return best, worst

    best_ats, worst_ats = week_marks("ats")
    best_su, worst_su = week_marks("straight_up")

    trend, cum_units, cum_su_diff, ats_window, su_window = [], 0.0, 0, [], []
    for key in sorted(by_week):
        rows = by_week[key]
        week_ats = [p for p in rows if p["pick_type"] == "ats"]
        week_su = [p for p in rows if p["pick_type"] == "straight_up"]
        cum_units += _units(week_ats)
        cum_su_diff += sum(1 for p in week_su if p["result"] == "win") - sum(1 for p in week_su if p["result"] == "loss")
        ats_window = (ats_window + [p for p in week_ats if p["result"] in ("win", "loss")])[-ROLLING_WINDOW:]
        su_window = (su_window + [p for p in week_su if p["result"] in ("win", "loss")])[-ROLLING_WINDOW:]

        def rolling(window):
            return round(sum(1 for p in window if p["result"] == "win") / len(window) * 100, 1) if len(window) >= 10 else None

        trend.append(
            {
                "season": key[0],
                "week": key[1],
                "label": _week_label(*key),
                "cumulative_units": round(cum_units, 2),
                "rolling_ats_pct": rolling(ats_window),
                "su_wins_over_500": cum_su_diff,
                "rolling_su_pct": rolling(su_window),
                "ats": _rec(week_ats),
                "straight_up": _rec(week_su),
            }
        )

    season_rows = []
    for s in sorted({p["season"] for p in decided}, reverse=True):
        s_ats = [p for p in ats if p["season"] == s]
        s_su = [p for p in su if p["season"] == s]
        season_rows.append(
            {
                "season": s,
                "ats": _rec(s_ats),
                "ats_units": _units(s_ats),
                "straight_up": _rec(s_su),
                "rank_ats": _rank(group, "ats", user_id, s),
                "rank_su": _rank(group, "straight_up", user_id, s),
            }
        )

    def team_records(rows):
        teams = {}
        for p in rows:
            teams.setdefault(p["selection"], []).append(p)
        return {team: _rec(rs) for team, rs in teams.items()}

    return {
        "scorecard": {
            "ats": _rec(ats),
            "ats_units": _units(ats),
            "straight_up": _rec(su),
            "decided_picks": len(decided),
            "rank_ats": _rank(group, "ats", user_id, season),
            "rank_su": _rank(group, "straight_up", user_id, season),
            "best_week_ats": best_ats,
            "worst_week_ats": worst_ats,
            "best_week_su": best_su,
            "worst_week_su": worst_su,
        },
        "trend": trend,
        "season_rows": season_rows,
        "splits": {"ats": _splits(ats), "straight_up": _splits(su)},
        "teams": {"ats": team_records(ats), "straight_up": team_records(su)},
    }


@router.get("")
def records(user_id: Optional[int] = None, season: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    target = user_id if user_id is not None else current_user["user_id"]
    with db_session() as conn:
        user = conn.execute("SELECT user_id, display_name, avatar_version FROM users WHERE user_id = ?", (target,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        picks = _load_picks(conn, target, season)
        group = _group_counts(conn)
        seasons = [
            r["season"]
            for r in conn.execute(
                "SELECT DISTINCT g.season FROM picks p JOIN games g ON g.game_id = p.game_id WHERE p.user_id = ? ORDER BY g.season DESC", (target,)
            ).fetchall()
        ]
        people = [
            dict(r)
            for r in conn.execute(
                "SELECT u.user_id, u.display_name, u.avatar_version FROM users u WHERE EXISTS (SELECT 1 FROM picks p WHERE p.user_id = u.user_id) ORDER BY u.display_name"
            ).fetchall()
        ]
    return {
        "user": dict(user),
        "is_you": target == current_user["user_id"],
        "season": season,
        "available_seasons": seasons,
        "people": people,
        **_build(picks, target, season, group),
    }
