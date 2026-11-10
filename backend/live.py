"""Live scores and play-by-play, straight from ESPN's public feeds.

Nothing here is stored. The scoreboard and each game's summary are fetched
from ESPN, trimmed to what the app shows, and cached in memory (short while a
game is live) so a handful of people watching costs ESPN a request every few
seconds, not one each, and the database next to nothing: the only read is the
group's picks on the visible games, cached for a minute.
"""
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from backend.current_lines import current_lines, display_line
from backend.database import db_session
from backend.sports import nba_game_id
from backend.teams import normalize_abbr

BASE = "https://site.api.espn.com/apis/site/v2/sports"
PATHS = {"nfl": "football/nfl", "nba": "basketball/nba"}
EASTERN = ZoneInfo("America/New_York")
DECIDED = ("win", "loss", "push")

_cache: dict = {}
_locks: dict = {}
_guard = threading.Lock()


def _fetch(url: str, params: dict):
    resp = requests.get(url, params=params, timeout=8)
    resp.raise_for_status()
    return resp.json()


def _cached(key, ttl: float, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    with _guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        try:
            value = fn()
        except (requests.RequestException, ValueError):
            if hit:
                return hit[1]
            raise
        _cache[key] = (time.time(), value)
        return value


def _abbr(sport: str, abbr: str) -> str:
    return normalize_abbr(abbr) if sport == "nfl" else abbr


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- scoreboard

def _parse_event(e: dict, sport: str) -> dict:
    comp = e["competitions"][0]
    st = comp["status"]
    t = st["type"]
    ids, sides = {}, {}
    for c in comp["competitors"]:
        abbr = _abbr(sport, c["team"]["abbreviation"])
        ids[str(c["team"]["id"])] = abbr
        sides[c["homeAway"]] = {
            "abbr": abbr,
            "score": _int(c.get("score")) if t["state"] != "pre" else None,
            "record": next((r.get("summary") for r in c.get("records", []) if r.get("type") == "total"), None),
            "winner": bool(c.get("winner")),
        }
    sit = comp.get("situation")
    situation = None
    if sit and t["state"] == "in":
        poss = ids.get(str((sit.get("possession") or "")))
        situation = {
            "down_distance": sit.get("shortDownDistanceText") or sit.get("downDistanceText"),
            "possession": poss, "red_zone": bool(sit.get("isRedZone")),
            "last_play": (sit.get("lastPlay") or {}).get("text"),
        }
    odds = (comp.get("odds") or [None])[0]
    names = [n for b in comp.get("broadcasts", []) for n in b.get("names", [])]
    return {
        "event_id": e["id"], "game_id": nba_game_id(e["id"]) if sport == "nba" else e["id"], "start": e["date"],
        "state": t["state"], "detail": t.get("shortDetail"), "clock": st.get("displayClock"), "period": st.get("period"),
        "home": sides["home"], "away": sides["away"], "situation": situation,
        "odds": {"details": odds.get("details"), "over_under": odds.get("overUnder"), "spread": odds.get("spread")} if odds else None,
        "tv": names[:2], "venue": (comp.get("venue") or {}).get("fullName"),
    }


def _state_order(g: dict):
    return (0 if g["state"] == "in" else 1 if g["state"] == "pre" else 2, g["start"])


def _scoreboard_raw(sport: str, date: str | None, week: int | None):
    params = {}
    if sport == "nba":
        params["dates"] = date or datetime.now(EASTERN).strftime("%Y%m%d")
    elif week:
        params.update({"week": week, "seasontype": 2})
    data = _fetch(f"{BASE}/{PATHS[sport]}/scoreboard", params)
    games = [_parse_event(e, sport) for e in data.get("events", []) if e.get("competitions")]
    games.sort(key=_state_order)
    return {"games": games, "week": (data.get("week") or {}).get("number"), "season": (data.get("season") or {}).get("year")}


def scoreboard_cached(sport: str, date: str | None, week: int | None):
    key = ("sb", sport, date, week)
    hit = _cache.get(key)
    live = bool(hit and any(g["state"] == "in" for g in hit[1]["games"]))
    return _cached(key, 12 if live else 45, lambda: _scoreboard_raw(sport, date, week))


# ------------------------------------------------------------ picks overlay

_overlay_cache: dict = {}


def _overlay_rows(game_ids: tuple):
    hit = _overlay_cache.get(game_ids)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    if not game_ids:
        return {}
    ph = ",".join("?" for _ in game_ids)
    with db_session() as conn:
        rows = conn.execute(
            f"""SELECT p.user_id, p.game_id, p.pick_type, p.selection, p.line_at_pick_time, p.graded_line, p.result,
                       g.home_team, g.away_team, g.status
                FROM picks p JOIN games g ON g.game_id = p.game_id WHERE p.game_id IN ({ph})""",
            game_ids,
        ).fetchall()
        rows = [dict(r) for r in rows]
        names: dict = {}
        if rows:
            ids = sorted({r["user_id"] for r in rows})
            uph = ",".join("?" for _ in ids)
            for u in conn.execute(f"SELECT user_id, display_name, avatar_version FROM users WHERE user_id IN ({uph})", tuple(ids)).fetchall():
                names[u["user_id"]] = (u["display_name"], u["avatar_version"])
        open_ids = [g for g in {r["game_id"] for r in rows if r["result"] not in DECIDED}]
        lines = current_lines(conn, open_ids)
    by_game: dict = {}
    for r in rows:
        line = display_line(r, r["home_team"], lines) if r["pick_type"] != "straight_up" else None
        name, ver = names.get(r["user_id"], ("?", 0))
        by_game.setdefault(r["game_id"], []).append({
            "user_id": r["user_id"], "name": name, "avatar_version": ver, "market": r["pick_type"], "selection": r["selection"],
            "line": line, "result": r["result"], "home": r["home_team"], "away": r["away_team"],
        })
    _overlay_cache[game_ids] = (time.time(), by_game)
    return by_game


def _status(p: dict, hs, as_, state: str) -> str:
    if p["result"] in DECIDED:
        return p["result"]
    if state == "pre" or hs is None or as_ is None:
        return "pending"
    if p["market"] == "total":
        if p["line"] is None:
            return "pending"
        pts = hs + as_
        edge = pts - p["line"] if p["selection"] == "over" else p["line"] - pts
    else:
        mine, theirs = (hs, as_) if p["selection"] == p["home"] else (as_, hs)
        edge = mine - theirs + (p["line"] if p["market"] == "ats" and p["line"] is not None else 0)
    return "winning" if edge > 0 else "losing" if edge < 0 else ("tied" if p["market"] == "straight_up" else "push")


def with_picks(games: list) -> list:
    ids = tuple(sorted(g["game_id"] for g in games))
    overlay = _overlay_rows(ids)
    out = []
    for g in games:
        picks = []
        for p in overlay.get(g["game_id"], []):
            picks.append({k: p[k] for k in ("user_id", "name", "avatar_version", "market", "selection", "line")}
                         | {"status": _status(p, g["home"]["score"], g["away"]["score"], g["state"]),
                            "side": "home" if p["selection"] == p["home"] else "away" if p["selection"] == p["away"] else p["selection"]})
        out.append({**g, "picks": picks})
    return out


def scoreboard(sport: str, date: str | None, week: int | None) -> dict:
    raw = scoreboard_cached(sport, date, week)
    return {"sport": sport, "date": date, "week": raw["week"], "season": raw["season"], "games": with_picks(raw["games"]),
            "live": any(g["state"] == "in" for g in raw["games"])}


# ---------------------------------------------------------------- game view

def _play(p: dict, team, drive=None) -> dict:
    return {
        "id": p.get("id"), "seq": _int(p.get("sequenceNumber")) or 0, "period": (p.get("period") or {}).get("number"),
        "clock": (p.get("clock") or {}).get("displayValue"), "text": p.get("text") or p.get("shortDescription") or "",
        "type": (p.get("type") or {}).get("text"), "team": team, "away": p.get("awayScore"), "home": p.get("homeScore"),
        "scoring": bool(p.get("scoringPlay")), "drive": drive,
        "dd": (p.get("start") or {}).get("shortDownDistanceText") if isinstance(p.get("start"), dict) else None,
    }


def _team_stats(box: dict) -> list:
    teams = (box or {}).get("teams", [])
    if len(teams) != 2:
        return []
    away = next((t for t in teams if t.get("homeAway") == "away"), teams[0])
    home = next((t for t in teams if t.get("homeAway") == "home"), teams[1])
    h = {s.get("name"): s for s in home.get("statistics", [])}
    out = []
    for s in away.get("statistics", []):
        other = h.get(s.get("name"))
        label = s.get("label") or s.get("name")
        if other and s.get("displayValue") not in (None, "") and label:
            out.append({"label": label, "away": s["displayValue"], "home": other.get("displayValue")})
    return out


def _game_raw(sport: str, event_id: str) -> dict:
    d = _fetch(f"{BASE}/{PATHS[sport]}/summary", {"event": event_id})
    comp = ((d.get("header") or {}).get("competitions") or [{}])[0]
    st = comp.get("status", {})
    t = st.get("type", {})
    ids, sides = {}, {}
    for c in comp.get("competitors", []):
        abbr = _abbr(sport, c["team"]["abbreviation"])
        ids[str(c["team"]["id"])] = abbr
        sides[c["homeAway"]] = {"abbr": abbr, "score": _int(c.get("score")) if t.get("state") != "pre" else None,
                                "record": (c.get("record") or [{}])[0].get("displayValue") if c.get("record") else None, "winner": bool(c.get("winner"))}

    plays, drives = [], []
    if sport == "nfl":
        dr = d.get("drives") or {}
        for i, drive in enumerate(dr.get("previous", []) + ([dr["current"]] if dr.get("current") else [])):
            team = _abbr(sport, (drive.get("team") or {}).get("abbreviation", "")) or None
            drives.append({"id": i, "team": team, "desc": drive.get("description"), "result": drive.get("displayResult") or drive.get("result"),
                           "plays": len(drive.get("plays", []))})
            for p in drive.get("plays", []):
                plays.append(_play(p, team, i))
    else:
        for p in d.get("plays", []):
            plays.append(_play(p, ids.get(str((p.get("team") or {}).get("id")))))
    plays.sort(key=lambda p: p["seq"])

    wp = [round(w.get("homeWinPercentage", 0) * 100, 1) for w in d.get("winprobability", [])]
    if len(wp) > 140:
        step = len(wp) / 140
        wp = [wp[int(i * step)] for i in range(140)] + [wp[-1]]

    scoring = [{"period": (s.get("period") or {}).get("number"), "clock": (s.get("clock") or {}).get("displayValue"), "text": s.get("text"),
                "away": s.get("awayScore"), "home": s.get("homeScore"),
                "team": _abbr(sport, (s.get("team") or {}).get("abbreviation", "")) or None, "type": (s.get("type") or {}).get("text")}
               for s in d.get("scoringPlays", [])] if sport == "nfl" else []

    from backend.nba_espn import _by_team, _leaders, _players

    leaders = _by_team(d.get("leaders"), _leaders)
    box = _by_team((d.get("boxscore") or {}).get("players"), _players) if sport == "nba" and t.get("state") != "pre" else {}
    sit = d.get("situation")
    return {
        "event_id": event_id, "sport": sport, "state": t.get("state"), "detail": t.get("shortDetail"), "clock": st.get("displayClock"),
        "period": st.get("period"), "home": sides.get("home"), "away": sides.get("away"), "plays": plays, "drives": drives, "winprob": wp,
        "scoring": scoring, "team_stats": _team_stats(d.get("boxscore")), "leaders": {_abbr(sport, k): v for k, v in leaders.items()},
        "box": {_abbr(sport, k): v for k, v in box.items()},
        "situation": {"down_distance": sit.get("shortDownDistanceText"), "possession": ids.get(str(sit.get("possession")))} if sit else None,
        "tv": sorted({(b.get("media") or {}).get("shortName") or b.get("station") for b in d.get("broadcasts", []) if b.get("station") or b.get("media")}),
    }


def game(game_id: str, since: int | None) -> dict:
    sport = "nba" if game_id.startswith("nba-") else "nfl"
    event_id = game_id[4:] if sport == "nba" else game_id
    hit = _cache.get(("game", sport, event_id))
    state = hit[1]["state"] if hit else None
    ttl = 8 if state == "in" else 600 if state == "post" else 40
    raw = _cached(("game", sport, event_id), ttl, lambda: _game_raw(sport, event_id))
    out = dict(raw)
    out["game_id"] = game_id
    if since is not None:
        out["plays"] = [p for p in raw["plays"] if p["seq"] > since]
        out["incremental"] = True
    g = with_picks([{"game_id": game_id, "state": raw["state"], "home": raw["home"] or {"score": None}, "away": raw["away"] or {"score": None}}])
    out["picks"] = g[0]["picks"]
    return out
