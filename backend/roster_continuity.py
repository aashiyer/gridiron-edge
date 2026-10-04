"""Roster continuity: what fraction of a team's roster in `current_season`
was already on that roster in some `past_season`. Used as a weight on
historical games — a team whose roster has almost fully turned over
shouldn't have its 5-year-old (or even 1-year-old) results treated the same
as a team that's kept its core intact.

Deliberately simple: player_id set overlap on ACT roster entries, no snap-
count or positional weighting. Good enough to separate "this team is
basically the same team as 3 years ago" from "this team has been rebuilt."
"""
from functools import lru_cache

MIN_WEIGHT = 0.15


_ROSTER_CACHE: dict = {}
_ROSTER_TTL_SECONDS = 3600


def _roster_set(conn, team: str, season: int) -> frozenset:
    import time

    hit = _ROSTER_CACHE.get((team, season))
    if hit and time.time() - hit[0] < _ROSTER_TTL_SECONDS:
        return hit[1]
    value = _load_roster_set(conn, team, season)
    _ROSTER_CACHE[(team, season)] = (time.time(), value)
    return value


def _load_roster_set(conn, team: str, season: int) -> frozenset:
    rows = conn.execute("SELECT player_id FROM rosters WHERE team = ? AND season = ?", (team, season)).fetchall()
    return frozenset(r["player_id"] for r in rows)


def continuity_weight(conn, team: str, current_season: int, past_season: int) -> float:
    """Fraction of `current_season`'s roster also present in `past_season`,
    floored/capped to [MIN_WEIGHT, 1.0]. Returns a neutral 0.75 if roster data
    isn't available for either season (rather than silently zeroing it out)."""
    if past_season >= current_season:
        return 1.0
    current_roster = _roster_set(conn, team, current_season)
    past_roster = _roster_set(conn, team, past_season)
    if not current_roster or not past_roster:
        return 0.75
    overlap = len(current_roster & past_roster) / len(current_roster)
    return max(MIN_WEIGHT, min(1.0, overlap))


def continuity_weights_for_seasons(conn, team: str, current_season: int, seasons: set) -> dict:
    """Batch version — one query per distinct season instead of one per game."""
    return {s: continuity_weight(conn, team, current_season, s) for s in seasons}
