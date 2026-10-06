"""Roster continuity: what fraction of a team's roster in `current_season`
was already on that roster in some `past_season`. Used as a weight on
historical games — a team whose roster has almost fully turned over
shouldn't have its 5-year-old (or even 1-year-old) results treated the same
as a team that's kept its core intact.

Deliberately simple: player_id set overlap on ACT roster entries, no snap-
count or positional weighting. Good enough to separate "this team is
basically the same team as 3 years ago" from "this team has been rebuilt."
"""
from backend.ttl_cache import ttl_memo

MIN_WEIGHT = 0.15


@ttl_memo("roster_overlap", 3600)
def _overlap_counts(conn, team: str, current_season: int, past_season: int):
    row = conn.execute(
        """
        SELECT
          (SELECT COUNT(DISTINCT player_id) FROM rosters WHERE team = ? AND season = ?) AS current_n,
          (SELECT COUNT(DISTINCT player_id) FROM rosters WHERE team = ? AND season = ?) AS past_n,
          (SELECT COUNT(DISTINCT a.player_id) FROM rosters a
             JOIN rosters b ON a.player_id = b.player_id AND b.team = ? AND b.season = ?
             WHERE a.team = ? AND a.season = ?) AS both_n
        """,
        (team, current_season, team, past_season, team, past_season, team, current_season),
    ).fetchone()
    return row["current_n"], row["past_n"], row["both_n"]


def continuity_weight(conn, team: str, current_season: int, past_season: int) -> float:
    """Fraction of `current_season`'s roster also present in `past_season`,
    floored/capped to [MIN_WEIGHT, 1.0]. Returns a neutral 0.75 if roster data
    isn't available for either season (rather than silently zeroing it out)."""
    if past_season >= current_season:
        return 1.0
    current_n, past_n, both_n = _overlap_counts(conn, team, current_season, past_season)
    if not current_n or not past_n:
        return 0.75
    return max(MIN_WEIGHT, min(1.0, both_n / current_n))


def continuity_weights_for_seasons(conn, team: str, current_season: int, seasons: set) -> dict:
    """Batch version — one query per distinct season instead of one per game."""
    return {s: continuity_weight(conn, team, current_season, s) for s in seasons}
