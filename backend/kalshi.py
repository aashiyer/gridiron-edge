"""Kalshi prediction-market probabilities for NFL games.

Uses Kalshi's public market-data API (no key needed) to read three series:
head-to-head winner (KXNFLGAME), "team wins by over N" (KXNFLSPREAD) and
"over N total points" (KXNFLTOTAL). Prices are in dollars, so a mid price of
$0.57 is a 57% implied probability.
"""
import re
import time
from datetime import date, datetime, timedelta

import requests

API = "https://api.elections.kalshi.com/trade-api/v2"
CACHE_SECONDS = 60

KALSHI_TO_OURS = {"JAC": "JAX", "LAR": "LA"}
TEAM_CODES = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
    "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
    "TB", "TEN", "WAS",
}
_MONTHS = {m: i + 1 for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
_EVENT_RE = re.compile(r"^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$")

_cache: dict = {"at": 0.0, "events": {}}


def _norm(code: str) -> str:
    return KALSHI_TO_OURS.get(code, code)


def _split_teams(blob: str):
    for i in range(2, len(blob) - 1):
        a, b = _norm(blob[:i]), _norm(blob[i:])
        if a in TEAM_CODES and b in TEAM_CODES:
            return a, b
    return None


def _parse_event(event_ticker: str):
    m = _EVENT_RE.match(event_ticker.rsplit("-", 1)[-1])
    if not m or m.group(2) not in _MONTHS:
        return None
    teams = _split_teams(m.group(4))
    if not teams:
        return None
    return date(2000 + int(m.group(1)), _MONTHS[m.group(2)], int(m.group(3))), teams


def _price(market: dict):
    def num(key):
        try:
            return float(market.get(key))
        except (TypeError, ValueError):
            return None

    bid, ask, last = num("yes_bid_dollars"), num("yes_ask_dollars"), num("last_price_dollars")
    if bid and ask:
        return (bid + ask) / 2
    if last:
        return last
    return None


def _markets(series: str) -> list:
    out, cursor = [], None
    while True:
        params = {"series_ticker": series, "status": "open", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(f"{API}/markets", params=params, timeout=10)
        r.raise_for_status()
        body = r.json()
        out.extend(body.get("markets", []))
        cursor = body.get("cursor")
        if not cursor:
            return out


def _load_events() -> dict:
    events: dict = {}

    def slot(ticker):
        parsed = _parse_event(ticker)
        if not parsed:
            return None
        d, teams = parsed
        return events.setdefault(ticker.rsplit("-", 1)[-1], {"date": d, "teams": set(teams), "win": {}, "spread": {}, "total": {}})

    for m in _markets("KXNFLGAME"):
        ev, p = slot(m["event_ticker"]), _price(m)
        team = _norm(m["ticker"].rsplit("-", 1)[-1])
        if ev and p is not None:
            ev["win"][team] = p
    for m in _markets("KXNFLSPREAD"):
        ev, p = slot(m["event_ticker"]), _price(m)
        strike = m.get("floor_strike")
        team = _norm(re.sub(r"\d+$", "", m["ticker"].rsplit("-", 1)[-1]))
        if ev and p is not None and strike is not None:
            ev["spread"].setdefault(team, {})[float(strike)] = p
    for m in _markets("KXNFLTOTAL"):
        ev, p = slot(m["event_ticker"]), _price(m)
        strike = m.get("floor_strike")
        if ev and p is not None and strike is not None:
            ev["total"][float(strike)] = p
    return events


def _events() -> dict:
    if time.time() - _cache["at"] < CACHE_SECONDS:
        return _cache["events"]
    try:
        _cache["events"] = _load_events()
        _cache["at"] = time.time()
    except Exception as e:
        print(f"kalshi fetch failed: {e}")
        _cache["at"] = time.time() - CACHE_SECONDS + 10
    return _cache["events"]


def _kickoff_dates(kickoff: str):
    try:
        k = datetime.strptime(kickoff, "%Y-%m-%dT%H:%MZ")
    except (TypeError, ValueError):
        return []
    return [k.date(), (k - timedelta(hours=8)).date()]


def odds_for_games(games: list) -> dict:
    events = _events()
    out = {}
    for g in games:
        pair = {g["home_team"], g["away_team"]}
        dates = _kickoff_dates(g["kickoff_time"])
        best = None
        for ev in events.values():
            if ev["teams"] != pair or not dates:
                continue
            gap = min(abs((ev["date"] - d).days) for d in dates)
            if gap <= 1 and (best is None or gap < best[0]):
                best = (gap, ev)
        if not best:
            continue
        ev = best[1]
        home, away = g["home_team"], g["away_team"]
        entry = {}
        if home in ev["win"] and away in ev["win"]:
            total = ev["win"][home] + ev["win"][away]
            entry["win"] = {"home": round(ev["win"][home] / total, 4), "away": round(ev["win"][away] / total, 4)}
        elif home in ev["win"] or away in ev["win"]:
            p = ev["win"].get(home)
            p = p if p is not None else 1 - ev["win"][away]
            entry["win"] = {"home": round(p, 4), "away": round(1 - p, 4)}
        if ev["spread"]:
            entry["spread"] = {
                "home": {str(k): round(v, 4) for k, v in ev["spread"].get(home, {}).items()},
                "away": {str(k): round(v, 4) for k, v in ev["spread"].get(away, {}).items()},
            }
        if ev["total"]:
            entry["total"] = {str(k): round(v, 4) for k, v in ev["total"].items()}
        if entry:
            out[g["game_id"]] = entry
    return out
