"""Recent-form efficiency signals from play-by-play-derived team_stats
(ingestion/pbp_stats.py), plus a custom opponent-adjusted composite rating —
the "Gridiron Efficiency Index" (GEI).

GEI is a from-scratch, transparent analogue to DVOA/SRS: it takes each
team's per-game net efficiency (offensive EPA/play minus defensive EPA/play
allowed that week) and iteratively adjusts it by the strength of that week's
opponent, the same way a Simple Rating System bootstraps opponent-adjusted
point margins — just applied to EPA instead of points. A few iterations
converge quickly; this recomputes on the fly (32 teams, ~1 season of games)
rather than needing a stored table.
"""

RECENT_N = 8


def recent_efficiency_form(conn, team: str, season: int, before_week: int):
    """Average of the team's last N team_stats (+ NGS) rows strictly before
    (season, before_week) — reaches back into the prior season's tail for
    week-1 games, same pattern used elsewhere (continuity, recent form)."""
    rows = conn.execute(
        """
        SELECT * FROM team_stats
        WHERE team = ? AND (season < ? OR (season = ? AND week < ?))
        ORDER BY season DESC, week DESC
        LIMIT ?
        """,
        (team, season, season, before_week, RECENT_N),
    ).fetchall()
    if not rows:
        return None

    ngs_rows = conn.execute(
        """
        SELECT * FROM ngs_team_stats
        WHERE team = ? AND (season < ? OR (season = ? AND week < ?))
        ORDER BY season DESC, week DESC
        LIMIT ?
        """,
        (team, season, season, before_week, RECENT_N),
    ).fetchall()

    def avg(field, source=rows):
        vals = [r[field] for r in source if r[field] is not None]
        return round(sum(vals) / len(vals), 3) if vals else None

    return {
        "games_sampled": len(rows),
        "off_epa_play": avg("off_epa_play"),
        "def_epa_play": avg("def_epa_play"),
        "off_success_rate": avg("off_success_rate"),
        "def_success_rate": avg("def_success_rate"),
        "third_down_pct": avg("third_down_pct"),
        "red_zone_td_pct": avg("red_zone_td_pct"),
        "turnover_margin": avg("turnover_margin"),
        "pass_rate": avg("pass_rate"),
        "avg_time_to_throw": avg("avg_time_to_throw", ngs_rows),
        "cpoe": avg("cpoe", ngs_rows),
        "avg_separation": avg("avg_separation", ngs_rows),
        "yac_above_expectation": avg("yac_above_expectation", ngs_rows),
        "rush_yards_over_expected_per_att": avg("rush_yards_over_expected_per_att", ngs_rows),
    }


def _game_net_epa(conn, season: int, through_week: int):
    """(week, team) -> net EPA/play differential (offense minus defense
    allowed) for that team's game that week — the per-game "margin" GEI's
    iteration adjusts by opponent strength, the way SRS adjusts point margin."""
    rows = conn.execute(
        "SELECT week, team, off_epa_play, def_epa_play FROM team_stats WHERE season = ? AND week <= ?",
        (season, through_week),
    ).fetchall()
    return {
        (r["week"], r["team"]): r["off_epa_play"] - r["def_epa_play"]
        for r in rows
        if r["off_epa_play"] is not None and r["def_epa_play"] is not None
    }


def opponent_adjusted_ratings(conn, season: int, through_week: int, iterations: int = 8) -> dict:
    matchups = conn.execute(
        "SELECT week, home_team, away_team FROM games WHERE season = ? AND week <= ? AND status = 'final'",
        (season, through_week),
    ).fetchall()
    if not matchups:
        return {}

    net_epa = _game_net_epa(conn, season, through_week)
    schedule: dict = {}
    for m in matchups:
        schedule.setdefault(m["home_team"], []).append((m["week"], m["away_team"]))
        schedule.setdefault(m["away_team"], []).append((m["week"], m["home_team"]))

    ratings = {team: 0.0 for team in schedule}
    has_data = {team: False for team in schedule}
    for _ in range(iterations):
        new_ratings = {}
        for team, games in schedule.items():
            adjusted = []
            for week, opp in games:
                net = net_epa.get((week, team))
                if net is None:
                    continue
                adjusted.append(net + ratings.get(opp, 0.0))
            if adjusted:
                new_ratings[team] = round(sum(adjusted) / len(adjusted), 4)
                has_data[team] = True
            else:
                new_ratings[team] = 0.0
        ratings = new_ratings
    return {team: (rating if has_data[team] else None) for team, rating in ratings.items()}


def gei_for_game(conn, home: str, away: str, season: int, week: int):
    """GEI ratings as of just before this game, falling back to the prior
    season's final ratings for week 1 (no current-season games yet)."""
    rating_season, rating_week = season, week - 1
    if rating_week < 1:
        rating_season, rating_week = season - 1, 22

    ratings = opponent_adjusted_ratings(conn, rating_season, rating_week)
    if not ratings:
        return None, None
    return ratings.get(home), ratings.get(away)
