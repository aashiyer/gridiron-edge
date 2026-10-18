"""Everything ESPN knows about an NBA game, fetched live and trimmed.

Fetched from ESPN on request (never stored), so it costs the database nothing:
the only cache is in memory here, short while a game is live and longer for
games that haven't started or are over.
"""
import time

import requests

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
_CACHE: dict = {}
_TTL = {"scheduled": 900, "in_progress": 60, "final": 3600}


def _athlete(a: dict) -> dict:
    return {
        "name": a.get("displayName") or a.get("fullName"),
        "short": a.get("shortName"),
        "jersey": a.get("jersey"),
        "position": (a.get("position") or {}).get("abbreviation"),
        "headshot": (a.get("headshot") or {}).get("href"),
    }


def _by_team(items, build):
    return {x["team"]["abbreviation"]: build(x) for x in items or [] if x.get("team")}


def _leaders(x):
    out = []
    for cat in x.get("leaders", []):
        if cat.get("leaders"):
            top = cat["leaders"][0]
            out.append({"category": cat.get("displayName"), "value": top.get("displayValue"), **_athlete(top.get("athlete") or {})})
    return out


def _injuries(x):
    out = []
    for i in x.get("injuries", []):
        out.append({
            **_athlete(i.get("athlete") or {}),
            "status": i.get("status"),
            "detail": (i.get("details") or {}).get("detail") or (i.get("details") or {}).get("type"),
            "note": (i.get("shortComment") or "")[:220] or None,
            "date": i.get("date"),
        })
    return out


def _players(x):
    out = []
    for block in x.get("statistics", []):
        keys = block.get("labels") or block.get("names") or []
        for a in block.get("athletes", []):
            stats = a.get("stats") or []
            if not stats or a.get("didNotPlay"):
                continue
            row = dict(zip(keys, stats))
            out.append({**_athlete(a.get("athlete") or {}), "starter": bool(a.get("starter")), "stats": row})
        totals = dict(zip(keys, block.get("totals") or []))
    return {"labels": keys, "players": out}


def _standings(d, abbrs, ids):
    out = {}
    for group in (d.get("standings") or {}).get("groups", []):
        for e in (group.get("standings") or {}).get("entries", []):
            if str(e.get("id")) in ids:
                abbr = ids[str(e["id"])]
                out[abbr] = {
                    "group": group.get("header"),
                    "stats": {s.get("displayName"): s.get("displayValue") for s in e.get("stats", []) if s.get("displayValue") not in (None, "")},
                }
    return out


def fetch_extras(event_id: str, status: str) -> dict:
    key = event_id
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL.get(status, 900):
        return hit[1]
    try:
        resp = requests.get(SUMMARY_URL, params={"event": event_id}, timeout=15)
        resp.raise_for_status()
        d = resp.json()
    except (requests.RequestException, ValueError):
        return hit[1] if hit else {}

    info = d.get("gameInfo") or {}
    venue = info.get("venue") or {}
    ids = {}
    for t in (d.get("boxscore") or {}).get("teams", []):
        ids[str(t["team"]["id"])] = t["team"]["abbreviation"]
    for c in ((d.get("header") or {}).get("competitions") or [{}])[0].get("competitors", []):
        ids[str(c["team"]["id"])] = c["team"]["abbreviation"]

    pick = (d.get("pickcenter") or [None])[0] or {}
    result = {
        "venue": {
            "name": venue.get("fullName"), "city": (venue.get("address") or {}).get("city"), "state": (venue.get("address") or {}).get("state"),
            "image": ((venue.get("images") or [{}])[0]).get("href"), "indoor": not venue.get("grass", False),
        } if venue else None,
        "attendance": info.get("attendance") or None,
        "officials": [{"name": o.get("displayName"), "role": (o.get("position") or {}).get("displayName")} for o in info.get("officials", [])],
        "broadcasts": sorted({(b.get("media") or {}).get("shortName") or b.get("station") for b in d.get("broadcasts", []) if b.get("station") or b.get("media")}),
        "leaders": _by_team(d.get("leaders"), _leaders),
        "injuries": _by_team(d.get("injuries"), _injuries),
        "standings": _standings(d, None, ids),
        "ats": _by_team(d.get("againstTheSpread"), lambda x: [{"label": r.get("displayName") or r.get("type"), "record": r.get("summary") or r.get("displayValue")} for r in x.get("records", [])]),
        "series": [{"summary": s.get("summary"), "title": s.get("title")} for s in d.get("seasonseries", [])],
        "box": _by_team((d.get("boxscore") or {}).get("players"), _players) if status != "scheduled" else {},
        "odds": {
            "provider": (pick.get("provider") or {}).get("name"), "details": pick.get("details"), "over_under": pick.get("overUnder"),
            "over_odds": pick.get("overOdds"), "under_odds": pick.get("underOdds"),
            "away_ml": (pick.get("awayTeamOdds") or {}).get("moneyLine"), "home_ml": (pick.get("homeTeamOdds") or {}).get("moneyLine"),
            "away_spread_odds": (pick.get("awayTeamOdds") or {}).get("spreadOdds"), "home_spread_odds": (pick.get("homeTeamOdds") or {}).get("spreadOdds"),
        } if pick else None,
        "leaders_kind": "game" if status != "scheduled" else "season",
    }
    _CACHE[key] = (time.time(), result)
    return result
