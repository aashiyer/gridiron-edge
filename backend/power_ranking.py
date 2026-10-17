"""Gridiron Efficiency Index (GEI) v3 — the app's own power ranking: how good
the football a team has played is, in points better or worse than an average
team (the difference between two teams' GEI is their neutral-field spread,
before the ~2 point home edge).

Every choice here was scored by gei_backtest.py: rate teams using only earlier
games, then check how well the ratings predict each later game's real margin.

  1. Each team-game gets a composite z-score: offensive EPA/play, defensive
     EPA/play allowed, offensive success rate and yards/play (all with garbage
     time removed — plays that began under 5% win probability for either
     side), point margin, and a small time-to-throw term. Weights are in
     WEIGHTS; the situational stats (3rd-down and red-zone defense) and
     defensive success rate scored no better than noise and are off.
  2. Home-field advantage is removed from each game's score (HFA_Z) instead of
     overweighting road games.
  3. An SRS-style loop opponent-adjusts those scores (a team's rating is the
     weighted average of its game scores plus its opponents' ratings).
     Games decay with age (RECENCY_HALF_LIFE_WEEKS) and every rating is
     shrunk toward the league average (REGULARIZATION_WEIGHT phantom games),
     so a few early blowouts can't dominate.
  4. The starting QB adds a small term: his shrunk EPA/dropback pooled over
     the last three seasons, so one hot game can't swing it.
  5. Last season's rating (decay-weighted over three seasons) carries weight
     PRIOR_PSEUDO_GAMES / (PRIOR_PSEUDO_GAMES + games played), fading as the
     season goes on.
  6. The result is scaled to points (POINTS_PER_RATING, fit by regression).
"""
import math
import statistics

from backend.ttl_cache import ttl_memo

RECENT_SEASONS = 3

WEIGHTS = {
    "off_epa": 0.30,
    "def_epa": 0.25,
    "off_success": 0.10,
    "def_success": 0.0,
    "off_yards": 0.05,
    "def_yards": 0.0,
    "margin": 0.25,
    "time_to_throw": 0.05,
    "third_down_def": 0.0,
    "red_zone_def": 0.0,
}

USE_CLEAN_STATS = True

HFA_Z = 0.08

POINTS_PER_RATING = 21.6

W_QB = 0.03

PRIOR_PSEUDO_GAMES = 3
PRIOR_SEASON_DECAY = [3, 2, 1]

REGULARIZATION_WEIGHT = 8.0

RECENCY_HALF_LIFE_WEEKS = 8.0

QB_PRIOR_DROPBACKS = 300
QB_PRIOR_SEASON_WEIGHT = 0.6


def _zscore_map(values: dict) -> dict:
    """team/key -> raw value, returns the same keys -> z-score against the
    league-wide mean/stdev of the values actually present. A missing value
    (None) stays absent from the result rather than defaulting to 0 (which
    would silently claim "exactly average")."""
    present = {k: v for k, v in values.items() if v is not None and not math.isnan(v)}
    if len(present) < 2:
        return {k: 0.0 for k in present}
    mean = statistics.mean(present.values())
    stdev = statistics.pstdev(present.values())
    if stdev == 0:
        return {k: 0.0 for k in present}
    return {k: (v - mean) / stdev for k, v in present.items()}


def _stat_select() -> str:
    if USE_CLEAN_STATS:
        return """COALESCE(off_epa_clean, off_epa_play) AS off_epa_play, COALESCE(def_epa_clean, def_epa_play) AS def_epa_play,
                  COALESCE(off_yards_clean, off_yards_play) AS off_yards_play, COALESCE(def_yards_clean, def_yards_play) AS def_yards_play,
                  COALESCE(off_success_clean, off_success_rate) AS off_success_rate, COALESCE(def_success_clean, def_success_rate) AS def_success_rate,
                  third_down_pct_def, red_zone_td_pct_def"""
    return """off_epa_play, def_epa_play, off_yards_play, def_yards_play, off_success_rate, def_success_rate,
              third_down_pct_def, red_zone_td_pct_def"""


def _season_game_rows(conn, season: int, through_week: int):
    """One row per team-game: the raw per-game inputs needed for the
    composite margin, weight, and opponent, for every final game in the
    season through `through_week`."""
    games = conn.execute(
        """
        SELECT game_id, week, home_team, away_team, final_home_score, final_away_score
        FROM games WHERE sport = 'nfl' AND season = ? AND week <= ? AND status = 'final'
        """,
        (season, through_week),
    ).fetchall()
    stats_rows = conn.execute(
        f"SELECT week, team, {_stat_select()} FROM team_stats WHERE season = ? AND week <= ?",
        (season, through_week),
    ).fetchall()
    stats = {(r["week"], r["team"]): r for r in stats_rows}
    ngs_rows = conn.execute(
        "SELECT week, team, avg_time_to_throw FROM ngs_team_stats WHERE season = ? AND week <= ?",
        (season, through_week),
    ).fetchall()
    ngs = {(r["week"], r["team"]): r["avg_time_to_throw"] for r in ngs_rows}

    latest_week = max((g["week"] for g in games), default=0)
    rows = []
    for g in games:
        recency = 0.5 ** ((latest_week - g["week"]) / RECENCY_HALF_LIFE_WEEKS) if RECENCY_HALF_LIFE_WEEKS else 1.0
        for team, opp, is_home in ((g["home_team"], g["away_team"], True), (g["away_team"], g["home_team"], False)):
            s = stats.get((g["week"], team))
            margin = (g["final_home_score"] - g["final_away_score"]) if is_home else (g["final_away_score"] - g["final_home_score"])
            weight = recency
            rows.append(
                {
                    "week": g["week"],
                    "team": team,
                    "opponent": opp,
                    "is_home": is_home,
                    "margin": margin,
                    "off_epa_play": s["off_epa_play"] if s else None,
                    "def_epa_play": s["def_epa_play"] if s else None,
                    "off_yards_play": s["off_yards_play"] if s else None,
                    "def_yards_play": s["def_yards_play"] if s else None,
                    "off_success_rate": s["off_success_rate"] if s else None,
                    "def_success_rate": s["def_success_rate"] if s else None,
                    "third_down_pct_def": s["third_down_pct_def"] if s else None,
                    "red_zone_td_pct_def": s["red_zone_td_pct_def"] if s else None,
                    "avg_time_to_throw": ngs.get((g["week"], team)),
                    "weight": weight,
                }
            )
    return rows


def _component_values(r: dict) -> dict:
    def neg(v):
        return None if v is None else -v

    return {
        "off_epa": r["off_epa_play"],
        "def_epa": neg(r["def_epa_play"]),
        "off_success": r["off_success_rate"],
        "def_success": neg(r["def_success_rate"]),
        "off_yards": r["off_yards_play"],
        "def_yards": neg(r["def_yards_play"]),
        "margin": r["margin"],
        "time_to_throw": r["avg_time_to_throw"],
        "third_down_def": neg(r["third_down_pct_def"]),
        "red_zone_def": neg(r["red_zone_td_pct_def"]),
    }


def _composite_margins(rows: list) -> dict:
    """(week, team) -> weighted composite z-score for that one game. Each
    ingredient is z-scored league-wide across every team-game in the season
    (not per-team) so the scale is consistent for opponent adjustment; the
    composite is the WEIGHTS-weighted average of whichever ingredients that
    team-game has, then nudged by HFA_Z (home credit removed, road credit
    added)."""
    by_component: dict = {name: {} for name in WEIGHTS}
    for r in rows:
        key = (r["week"], r["team"])
        for name, value in _component_values(r).items():
            if value is not None and WEIGHTS.get(name):
                by_component[name][key] = value
    z = {name: _zscore_map(values) for name, values in by_component.items()}

    composite = {}
    for r in rows:
        key = (r["week"], r["team"])
        total = weight_sum = 0.0
        for name, weight in WEIGHTS.items():
            if weight and key in z[name]:
                total += z[name][key] * weight
                weight_sum += weight
        if not weight_sum:
            continue
        composite[key] = total / weight_sum + (-HFA_Z if r["is_home"] else HFA_Z)
    return composite


_RATINGS_CACHE: dict = {}
_RATINGS_TTL_SECONDS = 900


def opponent_adjusted_power_ratings(conn, season: int, through_week: int, iterations: int = 10) -> dict:
    """Memoized for 15 minutes: every game in a week asks for the same
    (season, week) ratings plus the same three prior seasons, and recomputing
    all of that per game is the dominant cost of building a recommendation."""
    import time

    key = (season, through_week, iterations)
    hit = _RATINGS_CACHE.get(key)
    if hit and time.time() - hit[0] < _RATINGS_TTL_SECONDS:
        return hit[1]
    result = _opponent_adjusted_power_ratings(conn, season, through_week, iterations)
    _RATINGS_CACHE[key] = (time.time(), result)
    return result


def _opponent_adjusted_power_ratings(conn, season: int, through_week: int, iterations: int = 10) -> dict:
    """team -> opponent-adjusted composite rating (roughly z-score scaled:
    0 is league-average, positive is above), or None for a team with no
    usable data yet this season. This is GEI's core, single-season number —
    see gei_power_ranking() for the QB term and prior-season blend on top."""
    rows = _season_game_rows(conn, season, through_week)
    if not rows:
        return {}
    composite = _composite_margins(rows)

    schedule: dict = {}
    weight_by_key = {}
    for r in rows:
        key = (r["week"], r["team"])
        schedule.setdefault(r["team"], []).append((r["week"], r["opponent"]))
        weight_by_key[key] = r["weight"]

    ratings = {team: 0.0 for team in schedule}
    has_data = {team: False for team in schedule}
    for _ in range(iterations):
        new_ratings = {}
        for team, games in schedule.items():
            weighted_sum = 0.0
            weight_total = 0.0
            for week, opp in games:
                key = (week, team)
                margin = composite.get(key)
                if margin is None:
                    continue
                w = weight_by_key.get(key, 1.0)
                weighted_sum += (margin + ratings.get(opp, 0.0)) * w
                weight_total += w
            if weight_total:
                has_data[team] = True
                new_ratings[team] = round(weighted_sum / (weight_total + REGULARIZATION_WEIGHT), 4)
            else:
                new_ratings[team] = 0.0
        ratings = new_ratings
    return {team: (rating if has_data[team] else None) for team, rating in ratings.items()}


@ttl_memo("qb_rows", 600)
def _qb_rows(conn, first_season: int):
    return conn.execute(
        """
        SELECT season, week, team, player_id, dropbacks, epa_dropback FROM qb_starters
        WHERE season >= ? AND epa_dropback IS NOT NULL AND dropbacks > 0 AND player_id IS NOT NULL
        """,
        (first_season,),
    ).fetchall()


def _qb_zscores(conn, season: int, through_week: int) -> dict:
    """team -> z-score of its current starter's shrunk EPA/dropback. The
    starter is whoever led the team's most recent game; his value pools this
    season (full weight) with the two before it (QB_PRIOR_SEASON_WEIGHT) and
    is pulled toward the league average by QB_PRIOR_DROPBACKS phantom
    dropbacks, so a hot or cold single game can't swing it."""
    rows = [r for r in _qb_rows(conn, season - 2) if r["season"] < season or (r["season"] == season and r["week"] <= through_week)]
    if not rows:
        return {}
    current = [r for r in rows if r["season"] == season]
    league_dropbacks = sum(r["dropbacks"] for r in current)
    league_mean = sum(r["epa_dropback"] * r["dropbacks"] for r in current) / league_dropbacks if league_dropbacks else 0.0

    latest: dict = {}
    for r in current:
        if r["team"] not in latest or r["week"] > latest[r["team"]]["week"]:
            latest[r["team"]] = r

    by_player: dict = {}
    for r in rows:
        weight = 1.0 if r["season"] == season else QB_PRIOR_SEASON_WEIGHT
        num, den = by_player.get(r["player_id"], (0.0, 0.0))
        by_player[r["player_id"]] = (num + weight * r["dropbacks"] * r["epa_dropback"], den + weight * r["dropbacks"])

    values = {}
    for team, r in latest.items():
        num, den = by_player[r["player_id"]]
        values[team] = (num + QB_PRIOR_DROPBACKS * league_mean) / (den + QB_PRIOR_DROPBACKS)
    return _zscore_map(values)


def _full_season_ratings(conn, season: int) -> dict:
    """A season's final opponent-adjusted rating for every team, week 22
    standing in for "the whole season" the same way gei_for_game's week-1
    fallback already does."""
    return opponent_adjusted_power_ratings(conn, season, 22)


def gei_breakdown(conn, team: str, season: int, through_week: int) -> dict:
    """Every input that went into one team's current GEI number — the
    "why" behind a rank, not just the final float. Recomputes the same
    pieces gei_power_ranking does (this isn't on any hot path, a few extra
    queries here is fine) rather than threading extra return values through
    the main function for every team just to serve this occasionally."""
    rows = _season_game_rows(conn, season, through_week)
    composite = _composite_margins(rows)
    current = opponent_adjusted_power_ratings(conn, season, through_week)
    ranking = gei_power_ranking(conn, season, through_week)
    qb_z = _qb_zscores(conn, season, through_week)

    games = []
    for r in rows:
        if r["team"] != team:
            continue
        key = (r["week"], team)
        games.append(
            {
                "week": r["week"],
                "opponent": r["opponent"],
                "margin": r["margin"],
                "weight": round(r["weight"], 3),
                "composite_margin": composite.get(key),
                "opponent_current_rating": current.get(r["opponent"]),
            }
        )
    games.sort(key=lambda g: g["week"])

    prior = []
    for i, decay in enumerate(PRIOR_SEASON_DECAY, start=1):
        prior_season = season - i
        prior_rating = _full_season_ratings(conn, prior_season).get(team)
        prior.append({"season": prior_season, "decay_weight": decay, "rating": prior_rating})

    entry = ranking.get(team)
    return {
        "team": team,
        "games": games,
        "current_season_rating": current.get(team),
        "qb_epa_dropback_zscore": qb_z.get(team),
        "qb_term_weight": W_QB,
        "prior_seasons": prior,
        "prior_games_pseudo_count": PRIOR_PSEUDO_GAMES,
        "points_per_rating": POINTS_PER_RATING,
        "final_gei": entry["gei"] if entry else None,
        "rank": entry["rank"] if entry else None,
    }


def gei_power_ranking(conn, season: int, through_week: int) -> dict:
    """The full index: this season's opponent-adjusted composite (rows
    computed above) plus its QB term, blended with a small recency-decayed
    weight on the last RECENT_SEASONS seasons' final ratings. Returns
    team -> {"gei": float, "rank": int} for every team with at least
    current-season data, sorted best to worst."""
    current = opponent_adjusted_power_ratings(conn, season, through_week)
    qb_z = _qb_zscores(conn, season, through_week)

    prior_ratings = []
    for i, decay in enumerate(PRIOR_SEASON_DECAY, start=1):
        prior_ratings.append((decay, _full_season_ratings(conn, season - i)))

    scores = {}
    for team, rating in current.items():
        if rating is None:
            continue
        with_qb = rating + qb_z.get(team, 0.0) * W_QB

        prior_weighted_sum = 0.0
        prior_weight_total = 0.0
        for decay, prior in prior_ratings:
            prior_rating = prior.get(team)
            if prior_rating is None:
                continue
            prior_weighted_sum += prior_rating * decay
            prior_weight_total += decay

        if prior_weight_total:
            prior_blend = prior_weighted_sum / prior_weight_total
            prior_share = PRIOR_PSEUDO_GAMES / (PRIOR_PSEUDO_GAMES + through_week)
            final = (1 - prior_share) * with_qb + prior_share * prior_blend
        else:
            final = with_qb

        scores[team] = round(final * POINTS_PER_RATING, 2)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return {team: {"gei": score, "rank": i + 1} for i, (team, score) in enumerate(ranked)}


def gei_for_game(conn, home: str, away: str, season: int, week: int):
    """This index's rating for both sides of one upcoming/live matchup, as
    of just before it — same "fall back to the prior season's final
    ratings for week 1" convention team_efficiency.py's version used.
    Returns (home, away), each either a {"gei", "rank"} dict or None."""
    rating_season, rating_week = season, week - 1
    if rating_week < 1:
        rating_season, rating_week = season - 1, 22

    ratings = gei_power_ranking(conn, rating_season, rating_week)
    if not ratings:
        return None, None
    return ratings.get(home), ratings.get(away)
