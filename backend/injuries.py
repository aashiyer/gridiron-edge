"""Injury impact, scoped to actual depth chart starters (ingestion/depth_chart.py)
rather than any rostered player. QB gets its own read since it's by far the
highest-leverage position; `starters_out` gives the general "who's missing
from the starting lineup" list for everything else.
"""

from backend.ttl_cache import ttl_memo

OUT_ABBRS = {"O", "IR", "PUP", "SUS", "D/NE"}
QUESTIONABLE_ABBRS = {"Q", "D"}

EXCLUDED_POSITIONS = {"PK", "P", "H", "LS", "PR", "KR"}


@ttl_memo("qb_availability", 300)
def qb_availability(conn, team: str) -> dict:
    """QB1/QB2/... in true depth order, with injury status. `starter_out` is
    True only if the actual QB1 (not just *a* QB) is out."""
    rows = conn.execute(
        "SELECT depth_rank, player_name, injury_status FROM depth_chart WHERE team = ? AND position = 'QB' ORDER BY depth_rank",
        (team,),
    ).fetchall()
    depth = [dict(r) for r in rows]
    starter = depth[0] if depth else None
    starter_out = bool(starter and starter["injury_status"] in OUT_ABBRS)
    starter_questionable = bool(starter and starter["injury_status"] in QUESTIONABLE_ABBRS)
    likely_starter = next((p for p in depth if p["injury_status"] not in OUT_ABBRS), None)
    return {
        "depth": depth,
        "starter": starter,
        "starter_out": starter_out,
        "starter_questionable": starter_questionable,
        "likely_starter": likely_starter,
    }


@ttl_memo("starters_out", 300)
def starters_out(conn, team: str) -> list[dict]:
    """Depth-chart starters (depth_rank == 1) currently out, excluding
    special-teams slots."""
    placeholders = ",".join("?" * len(EXCLUDED_POSITIONS))
    rows = conn.execute(
        f"""SELECT position, player_name, injury_status FROM depth_chart
            WHERE team = ? AND depth_rank = 1 AND position NOT IN ({placeholders})
            ORDER BY position""",
        (team, *EXCLUDED_POSITIONS),
    ).fetchall()
    return [dict(r) for r in rows if r["injury_status"] in OUT_ABBRS]
