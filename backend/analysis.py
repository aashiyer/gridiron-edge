"""Heuristic "which side is better" recommendation engine.

Uses historical results + closing lines in the `games` table, plus
play-by-play-derived efficiency stats (`ingestion/pbp_stats.py`,
`team_efficiency.py`), to score each side of an upcoming matchup on:
  - recent EPA/play (offense minus defense allowed), success rate, 3rd-down
    and red-zone rates, and turnover margin — aggregated from nflverse's
    play-by-play (which ships its own precomputed epa/success/wpa per play;
    we aggregate those, we don't refit the underlying EP/WP models)
  - the Gridiron Efficiency Index (GEI) — our own opponent-adjusted composite
    rating, an SRS-style iterative adjustment of net EPA/play by the strength
    of each week's opponent (see `team_efficiency.opponent_adjusted_ratings`)
  - recent ATS cover rate (last N games)
  - recent straight-up win rate (last N games)
  - home/away ATS split
  - head-to-head ATS history vs this specific opponent
  - current SU win/loss streak
  - average scoring margin over the recent sample
  - record at this specific stadium (not just home/away in general)
  - rest-day edge (bye weeks, short weeks) from each team's previous kickoff
  - ESPN FPI power rating (season-long team strength, not just recent form —
    the closest free proxy to a "roster grade"; synced via `ingestion/fpi.py`)
  - each team's ATS/SU record over the last 5 seasons in similar weather
    (cold / windy / hot / mild), using the forecast for this game and
    nflverse's recorded temp/wind for past games (`ingestion/weather.py`)
  - live starter injury status, scoped to the REAL depth chart (not just any
    rostered player) via `ingestion/depth_chart.py` — ESPN's JSON APIs don't
    expose starter/depth data (checked several endpoint variants), so this
    scrapes the server-rendered depth chart page instead. QB gets its own
    signal that scales with how far down the chart the likely starter has
    fallen (backup starting is bad; 3rd-stringer starting is much worse);
    other positions roll up into a general "missing starters" signal,
    excluding specialists (K/P/LS) who rarely move a line. This is the
    freshest signal in the model and catches things FPI/recent-form can't —
    e.g. a team suddenly down to its 3rd-string QB days before kickoff
  - long-run (up to 5 season) ATS quality, weighted by roster continuity —
    a season only counts as much as the fraction of the CURRENT roster that
    was already on the team that year, so a rebuilt team's old results carry
    much less weight than a team that's kept its core intact
    (`roster_continuity.py`, `ingestion/rosters.py`)

This list is meant to grow — add a new signal by computing it in
`_team_form`/its own helper, folding a `score[...] += ...` term into
`build_recommendation`, and appending a plain-English reason so it shows up
in both the templated and LLM explanations automatically.

If ANTHROPIC_API_KEY is set, the structured reasons are passed to Claude to
produce a short natural-language writeup. Otherwise a clear templated
explanation is built from the same structured reasons — the recommendation
logic itself never depends on the LLM being configured.

If OPENAI_API_KEY is set, `news.py` adds one more (unscored, informational)
signal: real ESPN headlines for both teams from the last few days, read by
gpt-4o-mini and distilled into 1-2 sentences of qualitative context
structured data can't capture (practice-report nuance, benching hints).
Cached 6h per game so repeat views don't re-spend credits — costs a small
fraction of a cent per game. Silently skipped if no key is set.
"""
import os
from typing import Optional

from backend.database import db_session

import time as _time

_TTL_CACHES: dict = {}


def _ttl_memo(name: str, ttl_seconds: int):
    """Memoize a function of (conn, *args) on its args alone, for a short
    TTL. Used for read-only lookups a single recommendation (and a whole
    week's batch of them) repeats many times with identical arguments."""

    def deco(fn):
        cache = _TTL_CACHES.setdefault(name, {})

        def wrapper(conn, *args):
            hit = cache.get(args)
            if hit and _time.time() - hit[0] < ttl_seconds:
                return hit[1]
            value = fn(conn, *args)
            cache[args] = (_time.time(), value)
            return value

        wrapper.__name__ = fn.__name__
        return wrapper

    return deco


RECENT_N = 8


@_ttl_memo("team_games", 600)
def _team_games(conn, team: str, before_kickoff: str, limit: int = RECENT_N):
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE (home_team = ? OR away_team = ?)
          AND status = 'final'
          AND home_spread_close IS NOT NULL
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC
        LIMIT ?
        """,
        (team, team, before_kickoff or "9999", limit),
    ).fetchall()
    return rows


def _ats_result_for_team(game, team: str):
    """Return 'cover' / 'loss' / 'push' for `team` in this completed game."""
    home, away = game["home_team"], game["away_team"]
    line = game["home_spread_close"]
    if line is None or game["final_home_score"] is None:
        return None
    margin_home = (game["final_home_score"] - game["final_away_score"]) + line
    if team == home:
        margin = margin_home
    elif team == away:
        margin = -margin_home
    else:
        return None
    if margin > 0:
        return "cover"
    if margin < 0:
        return "loss"
    return "push"


def _su_result_for_team(game, team: str):
    home, away = game["home_team"], game["away_team"]
    if game["final_home_score"] is None:
        return None
    home_won = game["final_home_score"] > game["final_away_score"]
    if game["final_home_score"] == game["final_away_score"]:
        return "tie"
    if team == home:
        return "win" if home_won else "loss"
    if team == away:
        return "win" if not home_won else "loss"
    return None


def _margin_for_team(game, team: str):
    if game["final_home_score"] is None:
        return None
    if team == game["home_team"]:
        return game["final_home_score"] - game["final_away_score"]
    if team == game["away_team"]:
        return game["final_away_score"] - game["final_home_score"]
    return None


def _total_result(game):
    """Return 'over' / 'under' / 'push' for the combined score vs. the
    closing total — a team-agnostic result, unlike ATS/SU, since going
    over or under doesn't belong to either side."""
    total = game["total_close"]
    if total is None or game["final_home_score"] is None:
        return None
    combined = game["final_home_score"] + game["final_away_score"]
    if combined > total:
        return "over"
    if combined < total:
        return "under"
    return "push"


def _team_total_form(conn, team: str, before_kickoff: str):
    """Is this a team whose games tend to go high- or low-scoring, and how
    many points do they actually score/allow — regardless of whether
    they're favored. The over/under record answers "relative to whatever
    that game's own total line was"; avg_combined is the more portable raw
    number, since a team's own total lines move with its scoring
    reputation over time (a team that's 8-2 to the Over likely also has a
    total line that's crept up to reflect it)."""
    games = _team_games(conn, team, before_kickoff)
    results = [r for r in (_total_result(g) for g in games) if r]
    overs = results.count("over")
    decided = overs + results.count("under")
    points_for, points_against = [], []
    for g in games:
        if g["final_home_score"] is None:
            continue
        if g["home_team"] == team:
            points_for.append(g["final_home_score"])
            points_against.append(g["final_away_score"])
        elif g["away_team"] == team:
            points_for.append(g["final_away_score"])
            points_against.append(g["final_home_score"])
    return {
        "games_sampled": len(games),
        "over_decided": decided,
        "overs": overs,
        "over_pct": round(overs / decided * 100, 1) if decided else None,
        "avg_points_for": round(sum(points_for) / len(points_for), 1) if points_for else None,
        "avg_points_against": round(sum(points_against) / len(points_against), 1) if points_against else None,
        "avg_combined": round((sum(points_for) + sum(points_against)) / len(points_for), 1) if points_for else None,
    }


def _head_to_head_totals(conn, home: str, away: str, before_kickoff: str, limit: int = 5):
    """Like `_head_to_head`'s ATS history, but for whether meetings between
    these two specific teams tend to go over or under — two teams can have
    a real, repeatable combined-scoring dynamic (a shootout rivalry, or two
    defenses that always grind each other down) independent of either
    team's general over/under tendency against the rest of the league."""
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE status = 'final' AND total_close IS NOT NULL
          AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC LIMIT ?
        """,
        (home, away, away, home, before_kickoff or "9999", limit),
    ).fetchall()
    results = [r for r in (_total_result(g) for g in rows) if r]
    overs = results.count("over")
    decided = overs + results.count("under")
    return {"meetings": len(rows), "overs": overs, "decided": decided}


def _current_streak(games, team: str):
    """`games` is newest-first. Returns (kind, length): kind is 'W'/'L'/None."""
    kind = None
    length = 0
    for g in games:
        result = _su_result_for_team(g, team)
        if result not in ("win", "loss"):
            break
        this_kind = "W" if result == "win" else "L"
        if kind is None:
            kind = this_kind
        elif this_kind != kind:
            break
        length += 1
    return kind, length


def _season_record(conn, team: str, season: int, before_kickoff: str):
    """This team's actual won-loss and ATS record for `season`, through
    whatever's already been played strictly before this kickoff — the real
    standings number, not a last-N-games sample like _team_form below (which
    can span a season boundary and stays capped at RECENT_N regardless of
    how many games this season has actually happened)."""
    games = conn.execute(
        """
        SELECT * FROM games
        WHERE (home_team = ? OR away_team = ?) AND status = 'final' AND season = ?
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time ASC
        """,
        (team, team, season, before_kickoff or "9999"),
    ).fetchall()
    wins = losses = ties = 0
    ats_wins = ats_losses = ats_pushes = 0
    for g in games:
        su = _su_result_for_team(g, team)
        if su == "win":
            wins += 1
        elif su == "loss":
            losses += 1
        elif su == "tie":
            ties += 1
        ats = _ats_result_for_team(g, team)
        if ats == "cover":
            ats_wins += 1
        elif ats == "loss":
            ats_losses += 1
        elif ats == "push":
            ats_pushes += 1
    return {
        "wins": wins, "losses": losses, "ties": ties,
        "ats_wins": ats_wins, "ats_losses": ats_losses, "ats_pushes": ats_pushes,
    }


def _team_form(conn, team: str, before_kickoff: str, home_only: bool = False, away_only: bool = False):
    """Pure recent-form signal ("is this team hot or cold right now") over
    the last N games regardless of roster turnover — a brand-new roster can
    still be on a genuine hot/cold streak, so this one is intentionally not
    continuity-weighted. See `_continuity_weighted_form` for the long-run,
    roster-aware counterpart."""
    games = _team_games(conn, team, before_kickoff)
    if home_only:
        games = [g for g in games if g["home_team"] == team]
    elif away_only:
        games = [g for g in games if g["away_team"] == team]
    ats = [r for r in (_ats_result_for_team(g, team) for g in games) if r]
    su = [r for r in (_su_result_for_team(g, team) for g in games) if r]
    margins = [m for m in (_margin_for_team(g, team) for g in games) if m is not None]
    ats_covers = ats.count("cover")
    ats_decided = ats.count("cover") + ats.count("loss")
    su_wins = su.count("win")
    su_decided = su.count("win") + su.count("loss")
    streak_kind, streak_len = _current_streak(games, team) if not (home_only or away_only) else (None, 0)
    return {
        "games_sampled": len(games),
        "ats_covers": ats_covers,
        "ats_decided": ats_decided,
        "ats_pct": round(ats_covers / ats_decided * 100, 1) if ats_decided else None,
        "su_wins": su_wins,
        "su_decided": su_decided,
        "su_pct": round(su_wins / su_decided * 100, 1) if su_decided else None,
        "avg_margin": round(sum(margins) / len(margins), 1) if margins else None,
        "streak_kind": streak_kind,
        "streak_len": streak_len,
    }


def _continuity_weighted_form(conn, team: str, current_season: int, before_kickoff: str, seasons_back: int = 5):
    """Long-run team quality over up to `seasons_back` seasons, with each
    game weighted by how much of the CURRENT roster was already on the team
    that season (see roster_continuity.py). A team that's kept its core
    together (e.g. Bills) keeps drawing real signal from years back; a
    heavily-turned-over team (e.g. a post-rebuild Dolphins) has old seasons
    weighted down toward irrelevance instead of contributing at full strength."""
    from backend.roster_continuity import continuity_weights_for_seasons

    season_floor = current_season - seasons_back
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE (home_team = ? OR away_team = ?) AND status = 'final' AND home_spread_close IS NOT NULL
          AND season >= ? AND season <= ?
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC
        """,
        (team, team, season_floor, current_season, before_kickoff or "9999"),
    ).fetchall()
    if not rows:
        return None

    weights = continuity_weights_for_seasons(conn, team, current_season, {g["season"] for g in rows})

    weighted_covers = weighted_decided = weighted_margin_sum = weighted_margin_n = 0.0
    for g in rows:
        w = weights.get(g["season"], 1.0)
        ats = _ats_result_for_team(g, team)
        if ats == "cover":
            weighted_covers += w
            weighted_decided += w
        elif ats == "loss":
            weighted_decided += w
        margin = _margin_for_team(g, team)
        if margin is not None:
            weighted_margin_sum += margin * w
            weighted_margin_n += w

    avg_continuity = sum(weights.get(g["season"], 1.0) for g in rows) / len(rows)
    return {
        "games_sampled": len(rows),
        "seasons_spanned": sorted({g["season"] for g in rows}),
        "ats_pct": round(weighted_covers / weighted_decided * 100, 1) if weighted_decided else None,
        "avg_margin": round(weighted_margin_sum / weighted_margin_n, 1) if weighted_margin_n else None,
        "avg_continuity": round(avg_continuity, 2),
        "effective_n": round(weighted_decided, 1),
    }


def _venue_form(conn, away_team: str, home_team: str, before_kickoff: str, limit: int = 10):
    """How `away_team` has fared (ATS/SU) specifically visiting `home_team`'s
    stadium. We match on the home team rather than a stadium id/name because
    ESPN's venue ids and nflverse's don't share a scheme (numeric vs "CIN00"
    style) and stadium names change with sponsorships — but a team hosts at
    one building, so "games at this venue" and "road games vs this home team"
    are the same set in all but the rare neutral-site case."""
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE home_team = ? AND away_team = ?
          AND status = 'final' AND home_spread_close IS NOT NULL
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC LIMIT ?
        """,
        (home_team, away_team, before_kickoff or "9999", limit),
    ).fetchall()
    team = away_team
    ats = [r for r in (_ats_result_for_team(g, team) for g in rows) if r]
    su = [r for r in (_su_result_for_team(g, team) for g in rows) if r]
    ats_covers = ats.count("cover")
    ats_decided = ats_covers + ats.count("loss")
    su_wins = su.count("win")
    su_decided = su_wins + su.count("loss")
    return {
        "games_sampled": len(rows),
        "ats_covers": ats_covers,
        "ats_decided": ats_decided,
        "ats_pct": round(ats_covers / ats_decided * 100, 1) if ats_decided else None,
        "su_wins": su_wins,
        "su_decided": su_decided,
        "su_pct": round(su_wins / su_decided * 100, 1) if su_decided else None,
    }


def _head_to_head(conn, home: str, away: str, before_kickoff: str, limit: int = 5):
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE status = 'final' AND home_spread_close IS NOT NULL
          AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC LIMIT ?
        """,
        (home, away, away, home, before_kickoff or "9999", limit),
    ).fetchall()
    home_ats = [r for r in (_ats_result_for_team(g, home) for g in rows) if r]
    covers = home_ats.count("cover")
    decided = covers + home_ats.count("loss")
    return {"meetings": len(rows), "home_covers": covers, "decided": decided}


def _weather_bucket(temp, wind, roof):
    """Classify game conditions into a bucket used to look up how a team has
    historically performed in similar weather. Returns (key, label) or
    (None, None) if there isn't enough data to classify."""
    if roof == "dome":
        return "dome", "indoors"
    if temp is None and wind is None:
        return None, None
    if temp is not None and temp <= 40:
        return "cold", "cold weather (≤40°F)"
    if wind is not None and wind >= 15:
        return "windy", "windy conditions (≥15 mph)"
    if temp is not None and temp >= 85:
        return "hot", "hot weather (≥85°F)"
    return "mild", "mild conditions"


def _weather_form(conn, team: str, bucket_key: str, season_floor: int, before_kickoff: str):
    """team's ATS/SU record over the last 5 seasons in games matching this
    weather bucket. Filters in Python (not SQL) since the bucket depends on
    both temp and wind together."""
    if not bucket_key or bucket_key == "dome":
        return None
    rows = conn.execute(
        """
        SELECT * FROM games
        WHERE (home_team = ? OR away_team = ?) AND status = 'final' AND home_spread_close IS NOT NULL
          AND roof != 'dome' AND season >= ?
          AND (kickoff_time IS NULL OR kickoff_time < ?)
        ORDER BY kickoff_time DESC
        """,
        (team, team, season_floor, before_kickoff or "9999"),
    ).fetchall()
    matched = [g for g in rows if _weather_bucket(g["temp"], g["wind"], g["roof"])[0] == bucket_key]
    ats = [r for r in (_ats_result_for_team(g, team) for g in matched) if r]
    su = [r for r in (_su_result_for_team(g, team) for g in matched) if r]
    ats_covers = ats.count("cover")
    ats_decided = ats_covers + ats.count("loss")
    su_wins = su.count("win")
    su_decided = su_wins + su.count("loss")
    return {
        "games_sampled": len(matched),
        "ats_covers": ats_covers,
        "ats_decided": ats_decided,
        "ats_pct": round(ats_covers / ats_decided * 100, 1) if ats_decided else None,
        "su_wins": su_wins,
        "su_decided": su_decided,
        "su_pct": round(su_wins / su_decided * 100, 1) if su_decided else None,
    }


def _fpi(conn, team: str):
    row = conn.execute("SELECT fpi, fpi_rank FROM fpi_ratings WHERE team = ?", (team,)).fetchone()
    return (row["fpi"], row["fpi_rank"]) if row else (None, None)


_MODEL_CACHE = {"loaded": False, "payload": None}


def _load_model():
    """Lazily load the trained ATS logistic regression (scripts/train_ats_model.py),
    if it's been trained. Returns None if not trained yet or the deps aren't
    installed — the rest of the recommendation works fine without it."""
    if not _MODEL_CACHE["loaded"]:
        _MODEL_CACHE["loaded"] = True
        try:
            import joblib
            from pathlib import Path

            path = Path(__file__).resolve().parent.parent / "data" / "ats_model.joblib"
            if path.exists():
                _MODEL_CACHE["payload"] = joblib.load(path)
        except Exception as e:
            print(f"ATS model not loaded: {e}")
    return _MODEL_CACHE["payload"]


def _model_prediction(conn, game):
    payload = _load_model()
    if not payload:
        return None
    from backend.features import extract_features

    feats = extract_features(conn, game)
    x = [[feats[name] for name in payload["feature_names"]]]
    prob_home_covers = payload["model"].predict_proba(x)[0][1]
    return {"prob_home_covers": round(float(prob_home_covers), 3), "test_season": payload["test_season"], "test_acc": payload["test_acc"]}


_TOTAL_MODEL_CACHE = {"loaded": False, "payload": None}


def _load_total_model():
    """Same pattern as _load_model(), for the Over/Under classifier
    (scripts/train_total_model.py) — a separate model, not a repurposed ATS
    one, since "will this be high-scoring" and "who covers the spread" are
    predicted by an overlapping but distinct feature set (see
    features.py's TOTAL_FEATURE_NAMES)."""
    if not _TOTAL_MODEL_CACHE["loaded"]:
        _TOTAL_MODEL_CACHE["loaded"] = True
        try:
            import joblib
            from pathlib import Path

            path = Path(__file__).resolve().parent.parent / "data" / "total_model.joblib"
            if path.exists():
                _TOTAL_MODEL_CACHE["payload"] = joblib.load(path)
        except Exception as e:
            print(f"Total model not loaded: {e}")
    return _TOTAL_MODEL_CACHE["payload"]


def _model_prediction_total(conn, game):
    payload = _load_total_model()
    if not payload:
        return None
    from backend.features import extract_total_features

    feats = extract_total_features(conn, game)
    x = [[feats[name] for name in payload["feature_names"]]]
    prob_over = payload["model"].predict_proba(x)[0][1]
    return {"prob_over": round(float(prob_over), 3), "test_season": payload["test_season"], "test_acc": payload["test_acc"]}


RECOMMENDATION_CACHE_TTL_MINUTES = 360


_RECOMMENDATION_SCHEMA_VERSION = 12


MIN_COMPATIBLE_SCHEMA_VERSION = 7


def _usable_cached_payload(raw_json: str):
    """(payload, is_current) for any cached payload old enough versions still
    render correctly — a slightly stale analysis shown instantly beats a
    spinner while the fresh one recomputes. None if unreadable/too old."""
    import json

    try:
        payload = json.loads(raw_json)
    except (ValueError, TypeError):
        return None
    version = payload.get("_schema_version")
    if version is None:
        version = MIN_COMPATIBLE_SCHEMA_VERSION
    if not isinstance(version, int) or version < MIN_COMPATIBLE_SCHEMA_VERSION:
        return None
    payload = dict(payload)
    payload.pop("_schema_version", None)
    return payload, version == _RECOMMENDATION_SCHEMA_VERSION


def _valid_cached_payload(raw_json: str) -> Optional[dict]:
    import json

    try:
        payload = json.loads(raw_json)
    except (ValueError, TypeError):
        return None
    if payload.get("_schema_version") != _RECOMMENDATION_SCHEMA_VERSION:
        return None
    payload = dict(payload)
    payload.pop("_schema_version", None)
    return payload


def _load_snapshots(conn, game_ids: list) -> dict:
    import json

    if not game_ids:
        return {}
    placeholders = ",".join("?" for _ in game_ids)
    rows = conn.execute(
        f"SELECT game_id, payload FROM recommendation_snapshots WHERE game_id IN ({placeholders})", tuple(game_ids)
    ).fetchall()
    out = {}
    for r in rows:
        try:
            payload = json.loads(r["payload"])
        except (ValueError, TypeError):
            continue
        payload.pop("_schema_version", None)
        out[r["game_id"]] = payload
    return out


def cached_recommendations_batch(game_ids: list):
    """(recs, stale_ids): game_id -> recommendation for every id with a frozen
    snapshot or a usable cache entry, in two queries. stale_ids are those
    served from an older cache version, which the caller should refresh in
    the background."""
    if not game_ids:
        return {}, []
    with db_session() as conn:
        out = _load_snapshots(conn, game_ids)
        rest = [g for g in game_ids if g not in out]
        rows = []
        if rest:
            ph = ",".join("?" for _ in rest)
            rows = conn.execute(
                f"SELECT game_id, payload FROM recommendation_cache WHERE game_id IN ({ph})", tuple(rest)
            ).fetchall()
    stale = []
    for r in rows:
        usable = _usable_cached_payload(r["payload"])
        if usable is None:
            continue
        payload, is_current = usable
        out[r["game_id"]] = payload
        if not is_current:
            stale.append(r["game_id"])
    return out, stale


_refreshing: set = set()
_refreshing_lock = __import__("threading").Lock()


def _refresh_async(game_id: str):
    import threading

    with _refreshing_lock:
        if game_id in _refreshing:
            return
        _refreshing.add(game_id)

    def run():
        try:
            refresh_recommendation(game_id)
        except Exception as e:
            print(f"background refresh failed for {game_id}: {e}")
        finally:
            with _refreshing_lock:
                _refreshing.discard(game_id)

    threading.Thread(target=run, daemon=True).start()


def freeze_recommendation(game_id: str, overwrite: bool = False) -> bool:
    """Build this game's recommendation and save it as its permanent
    snapshot. Called automatically ~an hour before kickoff (and for any
    already-started game that lacks one), so by game time the analysis is
    just a stored read — and stays exactly as it was at kickoff."""
    import json
    from datetime import datetime, timezone

    with db_session() as conn:
        if not overwrite and conn.execute(
            "SELECT 1 FROM recommendation_snapshots WHERE game_id = ?", (game_id,)
        ).fetchone():
            return False
    result = build_recommendation(game_id)
    if not result or result.get("error"):
        return False
    with db_session() as conn:
        conn.execute(
            """INSERT INTO recommendation_snapshots (game_id, payload, frozen_at) VALUES (?, ?, ?)
               ON CONFLICT(game_id) DO UPDATE SET payload = excluded.payload, frozen_at = excluded.frozen_at""",
            (game_id, json.dumps(result), datetime.now(timezone.utc).isoformat()),
        )
    return True


def cached_recommendation(game_id: str, allow_compute: bool = True, conn=None) -> Optional[dict]:
    """The recommendation for a game, from `recommendation_cache` when it's
    there and fresh enough, otherwise computed and stored.

    Everything that needs a recommendation must go through here rather than
    calling build_recommendation() directly. That was the single worst
    latency bug in the app: create_pick() called build_recommendation()
    inline to snapshot the model's call, so *saving a pick* ran the entire
    model engine — ~25 sequential queries — before it could return, on top
    of whatever else was competing for the connection pool at that moment.
    Measured live: a pick save fired while a week's slate was loading took
    71 seconds.

    `allow_compute=False` returns None instead of computing on a miss — for
    callers that must never block on a cold cache (see the batch endpoint's
    use, and the precompute tick job that fills this in the background).

    Pass `conn` to read the cache on a connection the caller already holds,
    rather than checking a second one out of the pool — the pick-save path
    does this, since every extra checkout is measurable there.
    """
    import json
    from contextlib import nullcontext
    from datetime import datetime, timedelta, timezone

    with (nullcontext(conn) if conn is not None else db_session()) as c:
        snap = _load_snapshots(c, [game_id]).get(game_id)
        if snap is not None:
            return snap
        game = c.execute("SELECT status FROM games WHERE game_id = ?", (game_id,)).fetchone()
        cached = c.execute(
            "SELECT payload, generated_at FROM recommendation_cache WHERE game_id = ?", (game_id,)
        ).fetchone()

    valid = _valid_cached_payload(cached["payload"]) if cached else None

    if valid is not None:
        if game and game["status"] == "final":
            return valid
        try:
            generated_at = datetime.fromisoformat(cached["generated_at"])
            if datetime.now(timezone.utc) - generated_at < timedelta(minutes=RECOMMENDATION_CACHE_TTL_MINUTES):
                return valid
        except ValueError:
            pass

    if not allow_compute:
        return valid

    if valid is None and cached:
        usable = _usable_cached_payload(cached["payload"])
        if usable is not None:
            _refresh_async(game_id)
            return usable[0]

    return refresh_recommendation(game_id, started=bool(game and game["status"] != "scheduled"))


def refresh_recommendation(game_id: str, started: bool = False) -> dict:
    """Recompute and store a game's recommendation in the live cache,
    ignoring whatever is cached now (and freezing a permanent snapshot if the
    game has already started)."""
    import json
    from datetime import datetime, timezone

    result = build_recommendation(game_id)
    if result and not result.get("error"):
        if started:
            freeze_recommendation(game_id)
        stored = dict(result)
        stored["_schema_version"] = _RECOMMENDATION_SCHEMA_VERSION
        with db_session() as conn:
            conn.execute(
                """INSERT INTO recommendation_cache (game_id, payload, generated_at) VALUES (?, ?, ?)
                   ON CONFLICT(game_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at""",
                (game_id, json.dumps(stored), datetime.now(timezone.utc).isoformat()),
            )
    return result


def build_recommendation(game_id: str) -> dict:
    with db_session() as conn:
        game = conn.execute("SELECT * FROM games WHERE game_id = ?", (game_id,)).fetchone()
        if not game:
            return {"error": "game not found"}

        home, away = game["home_team"], game["away_team"]
        kickoff = game["kickoff_time"] or "9999"
        line = game["home_spread_close"]
        total_line = game["total_close"]
        if line is None or total_line is None:
            latest_odds = conn.execute(
                "SELECT home_spread, total FROM odds_snapshots WHERE game_id = ? AND captured_at <= COALESCE((SELECT kickoff_time FROM games WHERE game_id = odds_snapshots.game_id), '9999') ORDER BY captured_at DESC LIMIT 1",
                (game_id,),
            ).fetchone()
            if line is None:
                line = latest_odds["home_spread"] if latest_odds else None
            if total_line is None:
                total_line = latest_odds["total"] if latest_odds else None

        current_season = game["season"]
        home_form = _team_form(conn, home, kickoff)
        away_form = _team_form(conn, away, kickoff)
        home_split = _team_form(conn, home, kickoff, home_only=True)
        away_split = _team_form(conn, away, kickoff, away_only=True)
        home_continuity_form = _continuity_weighted_form(conn, home, current_season, kickoff)
        away_continuity_form = _continuity_weighted_form(conn, away, current_season, kickoff)
        h2h = _head_to_head(conn, home, away, kickoff)
        h2h_totals = _head_to_head_totals(conn, home, away, kickoff)
        home_total_form = _team_total_form(conn, home, kickoff)
        away_total_form = _team_total_form(conn, away, kickoff)
        away_venue_form = _venue_form(conn, away, home, kickoff)
        home_rest, away_rest = game["home_rest"], game["away_rest"]
        home_fpi, home_fpi_rank = _fpi(conn, home)
        away_fpi, away_fpi_rank = _fpi(conn, away)
        home_record = _season_record(conn, home, current_season, kickoff)
        away_record = _season_record(conn, away, current_season, kickoff)

        weather_key, weather_label = _weather_bucket(game["temp"], game["wind"], game["roof"])
        season_floor = (game["season"] or 2021) - 5
        home_weather_form = _weather_form(conn, home, weather_key, season_floor, kickoff)
        away_weather_form = _weather_form(conn, away, weather_key, season_floor, kickoff)

        model_pred = _model_prediction(conn, game)
        model_pred_total = _model_prediction_total(conn, game)

        from backend.team_efficiency import recent_efficiency_form
        from backend.power_ranking import gei_for_game

        home_eff = recent_efficiency_form(conn, home, current_season, game["week"])
        away_eff = recent_efficiency_form(conn, away, current_season, game["week"])
        home_gei_rating, away_gei_rating = gei_for_game(conn, home, away, current_season, game["week"])
        home_gei = home_gei_rating["gei"] if home_gei_rating else None
        away_gei = away_gei_rating["gei"] if away_gei_rating else None
        home_gei_rank = home_gei_rating["rank"] if home_gei_rating else None
        away_gei_rank = away_gei_rating["rank"] if away_gei_rating else None

        news_note = None
        if game["status"] == "scheduled":
            from backend.news import get_news_note

            news_note = get_news_note(conn, game_id, home, away)

        from backend.injuries import qb_availability, starters_out, OUT_ABBRS as _INJ_OUT

        home_qb = qb_availability(conn, home)
        away_qb = qb_availability(conn, away)
        home_starters_out = starters_out(conn, home)
        away_starters_out = starters_out(conn, away)

        from backend.historical_injury_signal import resolve_qb_player_id_by_name, qb_career_starts, qb_starter_lost

        qb_lost = {
            "home": qb_starter_lost(conn, home, current_season, game["week"], home_qb),
            "away": qb_starter_lost(conn, away, current_season, game["week"], away_qb),
        }

        def _likely_starter_career_starts(qb_info):
            likely = qb_info["likely_starter"]
            if not likely:
                return None
            pid = resolve_qb_player_id_by_name(conn, likely["player_name"])
            if not pid:
                return None
            return qb_career_starts(conn, pid, current_season, game["week"])

        home_qb_starts = _likely_starter_career_starts(home_qb)
        away_qb_starts = _likely_starter_career_starts(away_qb)

    reasons = []

    def _add(text: str, su: float = 0.0, ats: float = 0.0, total: float = 0.0, highlight: bool = False):
        reasons.append({"text": text, "impact": abs(su) + abs(ats) + abs(total), "highlight": highlight})

    score_su = {"home": 0.0, "away": 0.0}
    score_ats = {"home": 0.0, "away": 0.0}
    score_total = {"over": 0.0, "under": 0.0}

    for side, form, label in ((("home", home_form, home)), (("away", away_form, away))):
        if form["ats_pct"] is not None:
            ats_delta = (form["ats_pct"] - 50) / 10
            score_ats[side] += ats_delta
            if form["games_sampled"] >= 3:
                _add(
                    f"{label} is {form['ats_covers']}-{form['ats_decided'] - form['ats_covers']} ATS "
                    f"({form['ats_pct']}%) over their last {form['games_sampled']} games.",
                    ats=ats_delta,
                )
        if form["su_pct"] is not None:
            score_su[side] += (form["su_pct"] - 50) / 20
        if form["streak_len"] >= 2:
            direction = 1 if form["streak_kind"] == "W" else -1
            streak_delta = direction * min(form["streak_len"], 5) / 10
            score_su[side] += streak_delta
            verb = "won" if form["streak_kind"] == "W" else "lost"
            _add(f"{label} has {verb} {form['streak_len']} straight games.", su=streak_delta)
        if form["avg_margin"] is not None and form["games_sampled"] >= 3:
            margin_delta = form["avg_margin"] / 20
            score_su[side] += margin_delta
            _add(
                f"{label} is averaging a {'+' if form['avg_margin'] >= 0 else ''}{form['avg_margin']} point margin "
                f"over their last {form['games_sampled']} games.",
                su=margin_delta,
            )

    for side, form, label in (("home", home_continuity_form, home), ("away", away_continuity_form, away)):
        if form and form["ats_pct"] is not None and form["effective_n"] >= 3:
            continuity_delta = (form["ats_pct"] - 50) / 12
            score_ats[side] += continuity_delta
            span = f"{form['seasons_spanned'][0]}-{form['seasons_spanned'][-1]}"
            continuity_note = (
                "high roster continuity" if form["avg_continuity"] >= 0.5
                else "low roster continuity — history discounted" if form["avg_continuity"] < 0.3
                else "moderate roster continuity"
            )
            _add(
                f"{label} is {form['ats_pct']}% ATS across {form['games_sampled']} games from {span} "
                f"({continuity_note}, {int(form['avg_continuity'] * 100)}% of current roster overlaps that span).",
                ats=continuity_delta,
                highlight=True,
            )

    for side, qb, label in (("home", home_qb, home), ("away", away_qb, away)):
        likely = qb["likely_starter"]
        if qb["starter_out"]:
            out_ahead = [
                p["player_name"] for p in qb["depth"]
                if p["injury_status"] in _INJ_OUT and (not likely or p["depth_rank"] < likely["depth_rank"])
            ]
            if likely:
                drop = likely["depth_rank"] - 1
                penalty = 1.6 + drop * 1.4
                score_su[side] -= penalty
                score_ats[side] -= penalty * 0.55
                _add(
                    f"{label}'s starting QB situation is in flux: {', '.join(out_ahead)} out — "
                    f"expected starter is {likely['player_name']} (QB{likely['depth_rank']} on the depth chart).",
                    su=penalty, ats=penalty * 0.55, highlight=True,
                )
            else:
                score_su[side] -= 5.0
                score_ats[side] -= 2.5
                _add(f"{label} has no healthy QB on the depth chart right now.", su=5.0, ats=2.5, highlight=True)
        elif qb_lost[side]:
            lost = qb_lost[side]
            penalty = 1.6
            score_su[side] -= penalty
            score_ats[side] -= penalty * 0.55
            _add(
                f"{label}'s usual starter {lost['established']} is out ({lost['status']}) — "
                f"{lost['replacement']} is now QB1, a real step down from the QB this team's recent results and "
                f"efficiency stats were built on.",
                su=penalty, ats=penalty * 0.55, highlight=True,
            )
        elif qb["starter_questionable"] and qb["starter"]:
            _add(f"{label} starting QB {qb['starter']['player_name']} is questionable.", su=0.3)

    for side, starts, qb, label in (
        ("home", home_qb_starts, home_qb, home),
        ("away", away_qb_starts, away_qb, away),
    ):
        likely = qb["likely_starter"]
        if starts is None or not likely:
            continue
        if starts == 0:
            su_pen, ats_pen, tier = 2.0, 1.0, "making his first career start"
        elif starts <= 15:
            su_pen, ats_pen, tier = 0.8, 0.4, f"only {starts} career start{'s' if starts != 1 else ''}"
        else:
            continue
        score_su[side] -= su_pen
        score_ats[side] -= ats_pen
        _add(
            f"{label}'s likely starter {likely['player_name']} is {tier} — a real floor on the team's "
            f"ceiling regardless of how the rest of the matchup grades out.",
            su=su_pen, ats=ats_pen, highlight=True,
        )

    for side, missing, label in (("home", home_starters_out, home), ("away", away_starters_out, away)):
        if missing:
            penalty = min(len(missing), 5) * 0.2
            score_su[side] -= penalty
            score_ats[side] -= penalty * 0.5
            names = ", ".join(f"{p['player_name']} ({p['position']})" for p in missing[:4])
            more = f" +{len(missing) - 4} more" if len(missing) > 4 else ""
            _add(f"{label} missing starters: {names}{more}.", su=penalty, ats=penalty * 0.5, highlight=True)

    if home_eff and away_eff and home_eff["off_epa_play"] is not None and away_eff["off_epa_play"] is not None:
        home_net = home_eff["off_epa_play"] - (home_eff["def_epa_play"] or 0)
        away_net = away_eff["off_epa_play"] - (away_eff["def_epa_play"] or 0)
        net_diff = home_net - away_net
        epa_su, epa_ats = net_diff / 0.15, net_diff / 0.3
        score_su["home"] += epa_su
        score_ats["home"] += epa_ats
        better = home if net_diff > 0 else away if net_diff < 0 else None
        if better:
            _add(
                f"{home} nets {home_net:+.3f} EPA/play (off minus def allowed) over their last "
                f"{home_eff['games_sampled']} games vs {away} at {away_net:+.3f} — edge {better}.",
                su=epa_su, ats=epa_ats, highlight=True,
            )
        if home_eff["turnover_margin"] is not None and away_eff["turnover_margin"] is not None:
            to_diff = home_eff["turnover_margin"] - away_eff["turnover_margin"]
            score_su["home"] += to_diff / 3
            score_ats["home"] += to_diff / 3
            _add(
                f"{home} is averaging a {home_eff['turnover_margin']:+.2f} turnover margin recently vs "
                f"{away} at {away_eff['turnover_margin']:+.2f}.",
                su=to_diff / 3, ats=to_diff / 3,
            )
        if home_eff["third_down_pct"] is not None and away_eff["third_down_pct"] is not None:
            _add(
                f"3rd-down conversion: {home} {home_eff['third_down_pct']:.0f}% vs {away} {away_eff['third_down_pct']:.0f}% "
                f"(recent games)."
            )
        if home_eff["red_zone_td_pct"] is not None and away_eff["red_zone_td_pct"] is not None:
            _add(
                f"Red-zone TD rate: {home} {home_eff['red_zone_td_pct']:.0f}% vs {away} {away_eff['red_zone_td_pct']:.0f}% "
                f"(recent games)."
            )

        if home_eff["cpoe"] is not None and away_eff["cpoe"] is not None:
            cpoe_diff = home_eff["cpoe"] - away_eff["cpoe"]
            score_su["home"] += cpoe_diff / 3
            score_ats["home"] += cpoe_diff / 6
            _add(
                f"QB accuracy vs. expectation (CPOE): {home} {home_eff['cpoe']:+.1f}% vs {away} {away_eff['cpoe']:+.1f}%.",
                su=cpoe_diff / 3, ats=cpoe_diff / 6,
            )
        if home_eff["avg_separation"] is not None and away_eff["avg_separation"] is not None:
            sep_diff = home_eff["avg_separation"] - away_eff["avg_separation"]
            score_su["home"] += sep_diff / 2
            score_ats["home"] += sep_diff / 4
            _add(
                f"Avg receiver separation: {home} {home_eff['avg_separation']:.1f} yds vs {away} {away_eff['avg_separation']:.1f} yds.",
                su=sep_diff / 2, ats=sep_diff / 4,
            )
        if home_eff["rush_yards_over_expected_per_att"] is not None and away_eff["rush_yards_over_expected_per_att"] is not None:
            ryoe_diff = home_eff["rush_yards_over_expected_per_att"] - away_eff["rush_yards_over_expected_per_att"]
            score_su["home"] += ryoe_diff / 1.5
            score_ats["home"] += ryoe_diff / 3
            _add(
                f"Rush yards over expected/att: {home} {home_eff['rush_yards_over_expected_per_att']:+.2f} vs "
                f"{away} {away_eff['rush_yards_over_expected_per_att']:+.2f}.",
                su=ryoe_diff / 1.5, ats=ryoe_diff / 3,
            )

    if home_gei is not None and away_gei is not None:
        gei_diff = home_gei - away_gei
        gei_su, gei_ats = gei_diff / 0.6, gei_diff / 1.2
        score_su["home"] += gei_su
        score_ats["home"] += gei_ats
        better = home if gei_diff > 0 else away if gei_diff < 0 else None
        if better:
            _add(
                f"Gridiron Efficiency Index (our opponent-adjusted power ranking): {home} {home_gei:+.3f} "
                f"(#{home_gei_rank}) vs {away} {away_gei:+.3f} (#{away_gei_rank}) — {better} rates better once "
                f"strength of opponents played is accounted for.",
                su=gei_su, ats=gei_ats, highlight=True,
            )

    if home_fpi is not None and away_fpi is not None:
        fpi_diff = home_fpi - away_fpi
        fpi_su, fpi_ats = fpi_diff / 4, fpi_diff / 8
        score_su["home"] += fpi_su
        score_ats["home"] += fpi_ats
        better = home if fpi_diff > 0 else away if fpi_diff < 0 else None
        if better:
            worse = away if better == home else home
            caveat = " (though both grade below a league-average team)" if home_fpi < 0 and away_fpi < 0 else ""
            _add(
                f"ESPN FPI (updated for this season's rosters) rates {home} #{home_fpi_rank} overall ({home_fpi:+.1f}) "
                f"vs {away} #{away_fpi_rank} ({away_fpi:+.1f}) — {better} graded better than {worse}{caveat}.",
                su=fpi_su, ats=fpi_ats, highlight=True,
            )

    if home_split["ats_pct"] is not None and home_split["games_sampled"] >= 2:
        delta = (home_split["ats_pct"] - 50) / 15
        score_ats["home"] += delta
        _add(
            f"{home} is {home_split['ats_covers']}-{home_split['ats_decided'] - home_split['ats_covers']} ATS "
            f"at home over their last {home_split['games_sampled']} home games.",
            ats=delta,
        )

    if away_split["ats_pct"] is not None and away_split["games_sampled"] >= 2:
        delta = (away_split["ats_pct"] - 50) / 15
        score_ats["away"] += delta
        _add(
            f"{away} is {away_split['ats_covers']}-{away_split['ats_decided'] - away_split['ats_covers']} ATS "
            f"on the road over their last {away_split['games_sampled']} away games.",
            ats=delta,
        )

    if h2h["decided"] >= 2:
        h2h_pct = round(h2h["home_covers"] / h2h["decided"] * 100, 1)
        delta = (h2h_pct - 50) / 20
        score_ats["home"] += delta
        _add(
            f"In their last {h2h['meetings']} meetings, {home} covered {h2h['home_covers']} of "
            f"{h2h['decided']} decided games vs {away}.",
            ats=delta,
        )

    if away_venue_form["ats_pct"] is not None and away_venue_form["games_sampled"] >= 2:
        delta = (away_venue_form["ats_pct"] - 50) / 20
        score_ats["away"] += delta
        _add(
            f"{away} is {away_venue_form['ats_covers']}-{away_venue_form['ats_decided'] - away_venue_form['ats_covers']} ATS "
            f"in their last {away_venue_form['games_sampled']} trips to {home}'s stadium.",
            ats=delta,
        )

    context_lines = []
    if game["roof"] == "dome":
        context_lines.append(f"Played indoors at {game['stadium'] or 'a dome'} — no weather factor.")
    elif game["roof"] == "outdoors" and game["stadium"]:
        conditions = f"Outdoor game at {game['stadium']}"
        if game["temp"] is not None:
            conditions += f", forecast {game['temp']:.0f}°F"
            if game["wind"] is not None:
                conditions += f" with {game['wind']:.0f} mph wind"
            if game["precip_pct"] is not None and game["precip_pct"] >= 30:
                conditions += f" ({game['precip_pct']:.0f}% chance of precipitation)"
        context_lines.append(conditions + ".")

        for side, form, label in (("home", home_weather_form, home), ("away", away_weather_form, away)):
            if form and form["ats_pct"] is not None and form["games_sampled"] >= 3:
                delta = (form["ats_pct"] - 50) / 20
                score_ats[side] += delta
                _add(
                    f"{label} is {form['ats_covers']}-{form['ats_decided'] - form['ats_covers']} ATS "
                    f"in {weather_label} over the last 5 seasons ({form['games_sampled']} such games).",
                    ats=delta,
                )

    if (
        home_rest is not None
        and away_rest is not None
        and home_rest != away_rest
        and home_rest <= 20
        and away_rest <= 20
    ):
        rest_diff = home_rest - away_rest
        rest_weight = max(-1.0, min(1.0, rest_diff / 7)) * 0.5
        score_su["home"] += rest_weight
        score_ats["home"] += rest_weight
        more_rested = home if rest_diff > 0 else away
        _add(
            f"{home} has had {home_rest} days of rest vs {away_rest} for {away} "
            f"({more_rested} enters with the rest advantage).",
            su=rest_weight, ats=rest_weight,
        )

    if model_pred:
        p = model_pred["prob_home_covers"]
        model_delta = (p - 0.5) * 3
        score_ats["home"] += model_delta
        favored = home if p >= 0.5 else away
        model_pct = round(p * 100 if p >= 0.5 else (1 - p) * 100, 1)
        _add(
            f"Logistic regression (trained through {model_pred['test_season'] - 1}, backtested to "
            f"{model_pred['test_acc']:.1%} ATS accuracy on {model_pred['test_season']}) gives {favored} a "
            f"{model_pct}% chance to cover.",
            ats=model_delta, highlight=True,
        )

    for form, label in ((home_total_form, home), (away_total_form, away)):
        if form["over_pct"] is not None and form["games_sampled"] >= 3:
            delta = (form["over_pct"] - 50) / 10
            if delta > 0:
                score_total["over"] += delta
            else:
                score_total["under"] += -delta
            _add(
                f"{label}'s games have gone {form['overs']}-{form['over_decided'] - form['overs']} to the "
                f"Over ({form['over_pct']}%) over their last {form['games_sampled']} games.",
                total=delta,
            )

    if (
        total_line is not None
        and home_total_form["avg_combined"] is not None
        and away_total_form["avg_combined"] is not None
    ):
        expected_total = (home_total_form["avg_combined"] + away_total_form["avg_combined"]) / 2
        gap = expected_total - total_line
        delta = gap / 7
        if delta > 0:
            score_total["over"] += delta
        else:
            score_total["under"] += -delta
        _add(
            f"{home} and {away} have averaged {expected_total:.1f} combined points in their recent games, "
            f"vs. tonight's total of {total_line}.",
            total=delta, highlight=True,
        )

    if home_eff and away_eff and home_eff["off_epa_play"] is not None and away_eff["off_epa_play"] is not None:
        combined_off = home_eff["off_epa_play"] + away_eff["off_epa_play"]
        combined_def = (home_eff["def_epa_play"] or 0) + (away_eff["def_epa_play"] or 0)
        net = combined_off + combined_def
        delta = net / 0.2
        if delta > 0:
            score_total["over"] += delta
        else:
            score_total["under"] += -delta
        _add(
            f"{home} and {away} combine for {combined_off:+.3f} EPA/play on offense and {combined_def:+.3f} "
            f"allowed on defense recently — {'favors a higher-scoring game' if delta > 0 else 'favors a lower-scoring game'}.",
            total=delta, highlight=True,
        )

    if h2h_totals["decided"] >= 2:
        h2h_over_pct = round(h2h_totals["overs"] / h2h_totals["decided"] * 100, 1)
        delta = (h2h_over_pct - 50) / 15
        if delta > 0:
            score_total["over"] += delta
        else:
            score_total["under"] += -delta
        _add(
            f"In their last {h2h_totals['meetings']} meetings, {home} and {away} have gone to the Over "
            f"{h2h_totals['overs']} of {h2h_totals['decided']} decided games.",
            total=delta,
        )

    if game["roof"] != "dome" and (game["temp"] is not None or game["wind"] is not None):
        weather_delta = 0.0
        if game["temp"] is not None and game["temp"] <= 32:
            weather_delta -= 0.4
        if game["wind"] is not None and game["wind"] >= 15:
            weather_delta -= 0.4
        if weather_delta != 0:
            score_total["under"] += -weather_delta
            _add(
                f"Cold/windy conditions forecast ({weather_label}) typically suppress scoring.",
                total=weather_delta,
            )

    if model_pred_total:
        p = model_pred_total["prob_over"]
        model_delta = (p - 0.5) * 3
        if model_delta > 0:
            score_total["over"] += model_delta
        else:
            score_total["under"] += -model_delta
        favored = "Over" if p >= 0.5 else "Under"
        model_pct = round(p * 100 if p >= 0.5 else (1 - p) * 100, 1)
        _add(
            f"Logistic regression (trained through {model_pred_total['test_season'] - 1}, backtested to "
            f"{model_pred_total['test_acc']:.1%} accuracy on {model_pred_total['test_season']}) gives the "
            f"{favored} a {model_pct}% chance.",
            total=model_delta, highlight=True,
        )

    favored_side = "home" if (line is not None and line < 0) else "away" if line is not None else None
    if favored_side and line is not None:
        context_lines.append(f"Current line: {home} {line:+.1f} (favorite: {home if line < 0 else away}).")
    if total_line is not None:
        context_lines.append(f"Current total: {total_line}.")

    if news_note:
        context_lines.append(f"📰 {news_note}")

    lean_su = "home" if score_su["home"] > score_su["away"] else "away" if score_su["away"] > score_su["home"] else None
    lean_su_team = home if lean_su == "home" else away if lean_su == "away" else None
    confidence_su = round(abs(score_su["home"] - score_su["away"]), 2)

    lean_ats = "home" if score_ats["home"] > score_ats["away"] else "away" if score_ats["away"] > score_ats["home"] else None
    lean_ats_team = home if lean_ats == "home" else away if lean_ats == "away" else None
    confidence_ats = round(abs(score_ats["home"] - score_ats["away"]), 2)

    lean_total = "over" if score_total["over"] > score_total["under"] else "under" if score_total["under"] > score_total["over"] else None
    confidence_total = round(abs(score_total["over"] - score_total["under"]), 2)

    if line is not None and lean_su_team and lean_ats_team and lean_su_team != lean_ats_team:
        ats_side_must_win_to_cover = (lean_ats == "home" and line <= 0) or (lean_ats == "away" and line >= 0)
        if ats_side_must_win_to_cover:
            if confidence_ats > confidence_su:
                lean_su, lean_su_team = lean_ats, lean_ats_team
            else:
                lean_ats, lean_ats_team = lean_su, lean_su_team

    reasons.sort(key=lambda r: r["impact"], reverse=True)
    highlighted = [r for r in reasons if r["highlight"]]
    supporting = [r for r in reasons if not r["highlight"]][:3]
    kept = sorted(highlighted + supporting, key=lambda r: r["impact"], reverse=True)

    explanation = _explain(
        lean_su_team, lean_ats_team, lean_total, [r["text"] for r in kept], confidence_su, confidence_ats, confidence_total
    )

    structured_reasons = [{"text": r["text"], "highlight": r["highlight"]} for r in kept]
    structured_reasons += [{"text": t, "highlight": False} for t in context_lines]

    return {
        "game_id": game_id,
        "home_team": home,
        "away_team": away,
        "lean_straight_up": lean_su_team,
        "confidence_straight_up": confidence_su,
        "lean_ats": lean_ats_team,
        "confidence_ats": confidence_ats,
        "lean_total": lean_total,
        "confidence_total": confidence_total,
        "current_line": line,
        "current_total": total_line,
        "reasons": structured_reasons,
        "explanation": explanation,
        "home_form": home_form,
        "away_form": away_form,
        "home_fpi": {"fpi": home_fpi, "rank": home_fpi_rank},
        "away_fpi": {"fpi": away_fpi, "rank": away_fpi_rank},
        "home_record": home_record,
        "away_record": away_record,
        "model_prediction": model_pred,
        "model_prediction_total": model_pred_total,
        "home_efficiency": home_eff,
        "away_efficiency": away_eff,
        "home_gei": {"gei": home_gei, "rank": home_gei_rank},
        "away_gei": {"gei": away_gei, "rank": away_gei_rank},
        "home_qb_status": home_qb,
        "away_qb_status": away_qb,
        "news_note": news_note,
        "weather": {
            "temp": game["temp"],
            "wind": game["wind"],
            "precip_pct": game["precip_pct"],
            "roof": game["roof"],
            "bucket": weather_label,
        },
    }


def _explain(
    lean_su: str, lean_ats: str, lean_total: str, reasons: list,
    confidence_su: float, confidence_ats: float, confidence_total: float,
) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            return _explain_with_llm(
                lean_su, lean_ats, lean_total, reasons, confidence_su, confidence_ats, confidence_total, api_key
            )
        except Exception as e:
            print(f"LLM explanation failed, falling back to template: {e}")

    if not lean_su and not lean_ats and not lean_total:
        return "No meaningful historical edge either way based on recent form and head-to-head trends."
    if not reasons:
        pick = lean_su or lean_ats or lean_total
        return f"Slight lean toward {pick}, but with limited recent-game history to back it up."
    if lean_su == lean_ats and lean_su:
        return f"Lean: {lean_su} (both straight-up and ATS). Total lean: {lean_total or 'none'}."
    return f"Straight-up lean: {lean_su or 'none'}. ATS lean: {lean_ats or 'none'}. Total lean: {lean_total or 'none'}."


def _explain_with_llm(
    lean_su: str, lean_ats: str, lean_total: str, reasons: list,
    confidence_su: float, confidence_ats: float, confidence_total: float, api_key: str,
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    prompt = (
        "You are a terse sports betting analyst. Given these structured facts about an NFL matchup, "
        "write a 2-3 sentence explanation. Straight-up (who wins outright), ATS (who covers the spread), and "
        "the Total (Over/Under) are three independent questions — explain all three, and why they differ if "
        "they do. Be factual and hedge appropriately — this is informational, not a guarantee.\n\n"
        f"Straight-up lean: {lean_su or 'no clear lean'} (confidence score {confidence_su})\n"
        f"ATS lean: {lean_ats or 'no clear lean'} (confidence score {confidence_ats})\n"
        f"Total lean: {lean_total or 'no clear lean'} (confidence score {confidence_total})\n"
        f"Supporting facts:\n- " + "\n- ".join(reasons)
    )
    msg = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=220,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()
