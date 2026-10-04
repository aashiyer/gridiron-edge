"""Gridiron Efficiency Index (GEI) v2 — the app's own power ranking, built
to replace ESPN FPI as the "how good is this team, really" number used
everywhere else in the app.

Real DVOA can't be sourced (Football Outsiders' methodology and data are
proprietary, not published anywhere free) — by explicit choice, GEI doesn't
try to imitate a "DVOA slot": opponent-adjustment IS the whole methodology
here, same idea as DVOA, just this app's own computation.

Design, one team-game at a time:
  1. Every game produces one z-scored composite margin: EPA/play
     differential (the best single predictor available), offensive and
     defensive yards/play (offense weighted far more than defense — yards
     allowed is a much noisier signal than yards gained), point margin
     (which is what "wins and losses" collapses to in continuous form — a
     14-point win and a 1-point win are both "wins," but they aren't the
     same evidence of quality, and pure win/loss would rank a "successful"
     result the same as a lucky one), NextGen Stats average time to throw
     (offense — a longer time to throw reads as a clean pocket letting
     routes develop, not indecision; explicit design call, weighted heavily
     per an explicit ask that this matter a lot), and three more defensive
     terms beyond EPA/yards allowed — success rate, 3rd-down conversion
     rate, and red-zone TD rate, all allowed, all inverted so higher-z
     always means better defense.
  2. That per-game margin gets a WEIGHT, not just a value: road games count
     more than home games (a good road performance says more about a team
     than the same performance at home — travel, crowd noise, no
     home-field officiating edge), and games in real cold/wind/precipitation
     count more too (survives conditions that flatten a lot of offenses).
     Weight, not a separate bolted-on "road record" number — a team's
     rating already reflects the games that were actually hard to be good
     in, more than the ones that weren't.
  3. Those weighted per-game margins get opponent-adjusted the same way
     GEI v1 did: an SRS-style iteration (a team's rating is the weighted
     average of its game margins, each bumped by that week's opponent's own
     rating, repeated until it converges) — a good "successful 0-2" grades
     out ahead of a bad 0-2, and ahead of a bad winning record too, because
     the SCHEDULE and the MARGIN QUALITY both matter, not just the record
     column.
  4. The starting QB's own efficiency (EPA/dropback, from qb_starters) adds
     a smaller supplementary term on top — smaller because QB play already
     shows up inside offensive EPA; this only captures the QB-specific
     signal (CPOE, a QB's own accuracy) that team-level EPA blends with
     everything else the offense does.
  5. Current season carries the large majority of the weight. The last 3
     seasons blend in at a small, recency-decayed weight underneath it — a
     little benefit of the doubt against small-sample early-season noise
     and this system's own inevitable human-bias-like quirks, without
     letting last year's team meaningfully outweigh this year's.
"""
import math
import statistics

RECENT_SEASONS = 3

W_EPA = 0.55
W_OFF_YPP = 0.10
W_DEF_YPP = 0.05
W_MARGIN = 0.05

W_TIME_TO_THROW = 0.15

W_DEF_SUCCESS_RATE = 0.05
W_THIRD_DOWN_DEF = 0.03
W_RED_ZONE_DEF = 0.02

ROAD_WEIGHT = 1.25
INCLEMENT_WEIGHT = 1.15

W_QB = 0.12

CURRENT_SEASON_WEIGHT = 0.85
PRIOR_SEASONS_WEIGHT = 0.15
PRIOR_SEASON_DECAY = [3, 2, 1]

REGULARIZATION_WEIGHT = 5.0


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


def _inclement(temp, wind, precip_pct, roof) -> bool:
    if roof == "dome":
        return False
    if temp is not None and temp <= 40:
        return True
    if wind is not None and wind >= 15:
        return True
    if precip_pct is not None and precip_pct >= 50:
        return True
    return False


def _season_game_rows(conn, season: int, through_week: int):
    """One row per team-game: the raw per-game inputs needed for the
    composite margin, weight, and opponent, for every final game in the
    season through `through_week`."""
    games = conn.execute(
        """
        SELECT game_id, week, home_team, away_team, final_home_score, final_away_score,
               temp, wind, precip_pct, roof
        FROM games WHERE season = ? AND week <= ? AND status = 'final'
        """,
        (season, through_week),
    ).fetchall()
    stats_rows = conn.execute(
        """SELECT week, team, off_epa_play, def_epa_play, off_yards_play, def_yards_play,
                  def_success_rate, third_down_pct_def, red_zone_td_pct_def
           FROM team_stats WHERE season = ? AND week <= ?""",
        (season, through_week),
    ).fetchall()
    stats = {(r["week"], r["team"]): r for r in stats_rows}
    ngs_rows = conn.execute(
        "SELECT week, team, avg_time_to_throw FROM ngs_team_stats WHERE season = ? AND week <= ?",
        (season, through_week),
    ).fetchall()
    ngs = {(r["week"], r["team"]): r["avg_time_to_throw"] for r in ngs_rows}

    rows = []
    for g in games:
        inclement = _inclement(g["temp"], g["wind"], g["precip_pct"], g["roof"])
        for team, opp, is_home in ((g["home_team"], g["away_team"], True), (g["away_team"], g["home_team"], False)):
            s = stats.get((g["week"], team))
            margin = (g["final_home_score"] - g["final_away_score"]) if is_home else (g["final_away_score"] - g["final_home_score"])
            weight = 1.0
            if not is_home:
                weight *= ROAD_WEIGHT
            if inclement:
                weight *= INCLEMENT_WEIGHT
            rows.append(
                {
                    "week": g["week"],
                    "team": team,
                    "opponent": opp,
                    "margin": margin,
                    "off_epa_play": s["off_epa_play"] if s else None,
                    "def_epa_play": s["def_epa_play"] if s else None,
                    "off_yards_play": s["off_yards_play"] if s else None,
                    "def_yards_play": s["def_yards_play"] if s else None,
                    "def_success_rate": s["def_success_rate"] if s else None,
                    "third_down_pct_def": s["third_down_pct_def"] if s else None,
                    "red_zone_td_pct_def": s["red_zone_td_pct_def"] if s else None,
                    "avg_time_to_throw": ngs.get((g["week"], team)),
                    "weight": weight,
                }
            )
    return rows


def _composite_margins(rows: list) -> dict:
    """(week, team) -> weighted composite z-score margin for that one game,
    plus the raw weight (returned separately so the SRS iteration can use
    it) — z-scoring happens league-wide across every team-game in the
    season, not per-team, so the scale is consistent for opponent
    adjustment."""
    epa_diff, off_ypp, def_ypp_allowed, margin = {}, {}, {}, {}
    time_to_throw, def_success_allowed, third_down_allowed, red_zone_allowed = {}, {}, {}, {}
    for r in rows:
        key = (r["week"], r["team"])
        if r["off_epa_play"] is not None and r["def_epa_play"] is not None:
            epa_diff[key] = r["off_epa_play"] - r["def_epa_play"]
        if r["off_yards_play"] is not None:
            off_ypp[key] = r["off_yards_play"]
        if r["def_yards_play"] is not None:
            def_ypp_allowed[key] = -r["def_yards_play"]
        margin[key] = r["margin"]
        if r["avg_time_to_throw"] is not None:
            time_to_throw[key] = r["avg_time_to_throw"]
        if r["def_success_rate"] is not None:
            def_success_allowed[key] = -r["def_success_rate"]
        if r["third_down_pct_def"] is not None:
            third_down_allowed[key] = -r["third_down_pct_def"]
        if r["red_zone_td_pct_def"] is not None:
            red_zone_allowed[key] = -r["red_zone_td_pct_def"]

    z_epa = _zscore_map(epa_diff)
    z_off = _zscore_map(off_ypp)
    z_def = _zscore_map(def_ypp_allowed)
    z_margin = _zscore_map(margin)
    z_ttt = _zscore_map(time_to_throw)
    z_def_success = _zscore_map(def_success_allowed)
    z_third_down_def = _zscore_map(third_down_allowed)
    z_red_zone_def = _zscore_map(red_zone_allowed)

    composite = {}
    for r in rows:
        key = (r["week"], r["team"])
        parts = []
        weights = []
        if key in z_epa:
            parts.append(z_epa[key] * W_EPA)
            weights.append(W_EPA)
        if key in z_off:
            parts.append(z_off[key] * W_OFF_YPP)
            weights.append(W_OFF_YPP)
        if key in z_def:
            parts.append(z_def[key] * W_DEF_YPP)
            weights.append(W_DEF_YPP)
        if key in z_margin:
            parts.append(z_margin[key] * W_MARGIN)
            weights.append(W_MARGIN)
        if key in z_ttt:
            parts.append(z_ttt[key] * W_TIME_TO_THROW)
            weights.append(W_TIME_TO_THROW)
        if key in z_def_success:
            parts.append(z_def_success[key] * W_DEF_SUCCESS_RATE)
            weights.append(W_DEF_SUCCESS_RATE)
        if key in z_third_down_def:
            parts.append(z_third_down_def[key] * W_THIRD_DOWN_DEF)
            weights.append(W_THIRD_DOWN_DEF)
        if key in z_red_zone_def:
            parts.append(z_red_zone_def[key] * W_RED_ZONE_DEF)
            weights.append(W_RED_ZONE_DEF)
        if not weights:
            continue
        composite[key] = sum(parts) / sum(weights)
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

    raw_avg = {}
    for team, games in schedule.items():
        weighted_sum = 0.0
        weight_total = 0.0
        for week, _opp in games:
            key = (week, team)
            margin = composite.get(key)
            if margin is None:
                continue
            w = weight_by_key.get(key, 1.0)
            weighted_sum += margin * w
            weight_total += w
        raw_avg[team] = (weighted_sum / weight_total) if weight_total else 0.0

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
                phantom_weight = max(0.0, REGULARIZATION_WEIGHT - weight_total)
                if phantom_weight:
                    weighted_sum += raw_avg[team] * phantom_weight
                    weight_total += phantom_weight
                new_ratings[team] = round(weighted_sum / weight_total, 4)
            else:
                new_ratings[team] = 0.0
        ratings = new_ratings
    return {team: (rating if has_data[team] else None) for team, rating in ratings.items()}


def _qb_zscores(conn, season: int, through_week: int) -> dict:
    """team -> z-score of its current starter's EPA/dropback (the most
    recent qb_starters row through this point), league-wide. A team with no
    qb_starters data yet this season is simply absent, same convention as
    everywhere else here."""
    rows = conn.execute(
        """
        SELECT team, epa_dropback FROM qb_starters
        WHERE season = ? AND week <= ? AND epa_dropback IS NOT NULL
        ORDER BY week DESC
        """,
        (season, through_week),
    ).fetchall()
    latest: dict = {}
    for r in rows:
        latest.setdefault(r["team"], r["epa_dropback"])
    return _zscore_map(latest)


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
        "current_season_weight": CURRENT_SEASON_WEIGHT,
        "prior_seasons_weight": PRIOR_SEASONS_WEIGHT,
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
            final = CURRENT_SEASON_WEIGHT * with_qb + PRIOR_SEASONS_WEIGHT * prior_blend
        else:
            final = with_qb

        scores[team] = round(final, 4)

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
