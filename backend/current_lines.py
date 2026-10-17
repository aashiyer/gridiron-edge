DECIDED = ("win", "loss", "push")


def current_lines(conn, game_ids: list) -> dict:
    """game_id -> (home_spread, total) from the latest odds snapshot taken
    before kickoff, the same numbers the game list shows as current."""
    if not game_ids:
        return {}
    placeholders = ",".join("?" * len(game_ids))
    rows = conn.execute(
        f"""
        SELECT game_id, home_spread, total FROM (
            SELECT o.game_id, o.home_spread, o.total,
                   ROW_NUMBER() OVER (PARTITION BY o.game_id ORDER BY o.captured_at DESC, o.id DESC) AS rn
            FROM odds_snapshots o
            JOIN games g ON g.game_id = o.game_id
            WHERE o.game_id IN ({placeholders}) AND (g.kickoff_time IS NULL OR o.captured_at <= g.kickoff_time)
        ) ranked WHERE rn = 1
        """,
        tuple(game_ids),
    ).fetchall()
    return {r["game_id"]: (r["home_spread"], r["total"]) for r in rows}


def display_line(pick: dict, home_team: str, lines: dict):
    """The line a pick is effectively on right now. Graded picks show the line
    they were graded at; pending ones follow the live line for the side
    picked, since everything is graded against the closing line."""
    stored = pick.get("line_at_pick_time")
    if pick["result"] in DECIDED:
        graded = pick.get("graded_line")
        return graded if graded is not None else stored
    current = lines.get(pick["game_id"])
    if not current:
        return stored
    spread, total = current
    if pick["pick_type"] == "ats":
        if spread is None:
            return stored
        return spread if pick["selection"] == home_team else -spread
    if pick["pick_type"] == "total":
        return total if total is not None else stored
    return stored
