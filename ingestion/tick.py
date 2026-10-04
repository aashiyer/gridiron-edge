"""One-shot ingestion tick, meant to be invoked by launchd's own interval
scheduling (StartInterval) rather than a long-running in-process scheduler.

Why: a persistent BlockingScheduler process can silently stall across a
Mac sleep/wake cycle (observed: process stayed alive per macOS but stopped
ticking for 23+ hours after one sleep) and launchd's KeepAlive only catches
a process that *exits* badly, not one that's alive but wedged. Short-lived
processes that launchd itself re-spawns on a timer have no equivalent
failure mode — there's no long-lived timer thread to get stuck.

Usage:
    python -m ingestion.tick --job odds     # scores/odds + auto-grade (frequent)
    python -m ingestion.tick --job season   # full-season sweep, all weeks (hourly-ish)
    python -m ingestion.tick --job fpi      # FPI ratings (every few hours)
    python -m ingestion.tick --job depth    # depth charts / injuries (every couple hours)
    python -m ingestion.tick --job weather  # game-day forecasts (every couple hours)
    python -m ingestion.tick --job qb_starters  # recent-season QB usage (every couple hours)
    python -m ingestion.tick --job pbp_stats    # recent-season EPA/play efficiency stats (every couple hours)
    python -m ingestion.tick --job ngs_stats    # recent-season NextGen Stats (every couple hours)
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.database import init_db


def _refresh_qb_baselines():
    from backend.database import db_session
    from backend.historical_injury_signal import refresh_qb_baselines

    now = datetime.now()
    season = now.year - 1 if now.month <= 2 else now.year
    with db_session() as conn:
        refresh_qb_baselines(conn, season)


def snapshot_games(limit: int = 25):
    """Freeze the recommendation for every game that kicks off within the
    next 75 minutes (or has already started) and doesn't have a snapshot
    yet, so game-time analysis is a stored read instead of a recompute."""
    from datetime import timedelta, timezone

    from backend.analysis import freeze_recommendation
    from backend.database import db_session

    cutoff = (datetime.now(timezone.utc) + timedelta(minutes=75)).strftime("%Y-%m-%dT%H:%MZ")
    now = datetime.now()
    season = now.year - 1 if now.month <= 2 else now.year
    with db_session() as conn:
        rows = conn.execute(
            """SELECT g.game_id FROM games g
               WHERE g.season = ? AND (g.status != 'scheduled' OR g.kickoff_time <= ?)
                 AND NOT EXISTS (SELECT 1 FROM recommendation_snapshots s WHERE s.game_id = g.game_id)
               ORDER BY g.kickoff_time DESC LIMIT ?""",
            (season, cutoff, limit),
        ).fetchall()
    frozen = 0
    for r in rows:
        try:
            if freeze_recommendation(r["game_id"]):
                frozen += 1
        except Exception as e:
            print(f"  {r['game_id']}: snapshot failed ({e})")
    print(f"Froze {frozen} recommendation snapshot(s).")


def run_odds():
    from ingestion.espn_odds import poll_once

    poll_once()
    from backend.routers.picks import grade_pending_picks

    result = grade_pending_picks()
    if result["count"]:
        print(f"Auto-graded {result['count']} pick(s).")
    snapshot_games()


def run_season():
    from ingestion.espn_odds import poll_full_season

    now = datetime.now()
    season = now.year - 1 if now.month <= 2 else now.year
    poll_full_season(season)


def run_fpi():
    from ingestion.fpi import sync_fpi

    sync_fpi()


def run_depth():
    from ingestion.depth_chart import sync_depth_charts

    sync_depth_charts()
    _refresh_qb_baselines()


def run_weather():
    from ingestion.weather import sync_weather

    sync_weather()


def run_qb_starters():
    """Refresh the last two seasons only, not the full historical range —
    that's already backfilled once (see ingestion/qb_starters.py's own
    docstring for why it was stale) and re-downloading years of
    play-by-play every couple hours would be wasteful. Two seasons covers
    both "this season's games keep adding new weeks" and "last season just
    wrapped and nflverse finally published it"."""
    from ingestion.qb_starters import sync_qb_starters

    now = datetime.now()
    current_season = now.year - 1 if now.month <= 2 else now.year
    sync_qb_starters(current_season - 1, current_season)
    _refresh_qb_baselines()


def run_pbp_stats():
    """Refresh the last two seasons only — same reasoning as
    run_qb_starters above. Keeps team_stats (EPA/play, success rate,
    3rd-down%, red-zone%, turnovers) current as the season progresses,
    which GEI and the recommendation engine both depend on."""
    from ingestion.pbp_stats import sync_pbp_stats

    now = datetime.now()
    current_season = now.year - 1 if now.month <= 2 else now.year
    sync_pbp_stats(current_season - 1, current_season)


def run_ngs_stats():
    """Refresh the last two seasons only — same reasoning as
    run_qb_starters above. Keeps NextGen Stats (time-to-throw, CPOE,
    separation, rush efficiency) current as the season progresses."""
    from ingestion.ngs_stats import sync_ngs_stats

    now = datetime.now()
    current_season = now.year - 1 if now.month <= 2 else now.year
    sync_ngs_stats(current_season - 1, current_season)


def run_recs():
    """Precompute recommendations for every game that could plausibly be
    looked at soon, so a user's page load is always a cache hit.

    Computing one of these is ~25 queries; doing it on demand meant a whole
    week's Picker slate could kick off 16 of them at once and starve the
    connection pool for everything else, including pick saves. Doing it here
    — off-request, one at a time — keeps that cost entirely off the path
    anyone actually waits on."""
    from datetime import timezone

    from backend.analysis import build_recommendation
    from backend.database import db_session

    now = datetime.now()
    season = now.year - 1 if now.month <= 2 else now.year

    with db_session() as conn:
        rows = conn.execute(
            """SELECT game_id FROM games
               WHERE season = ? AND status = 'scheduled'
               ORDER BY kickoff_time ASC""",
            (season,),
        ).fetchall()

    import json

    ok = failed = 0
    for r in rows:
        game_id = r["game_id"]
        try:
            result = build_recommendation(game_id)
            if not result or result.get("error"):
                failed += 1
                continue
            with db_session() as conn:
                conn.execute(
                    """INSERT INTO recommendation_cache (game_id, payload, generated_at) VALUES (?, ?, ?)
                       ON CONFLICT(game_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at""",
                    (game_id, json.dumps(result), datetime.now(timezone.utc).isoformat()),
                )
            ok += 1
        except Exception as e:
            failed += 1
            print(f"  {game_id}: recommendation precompute failed ({e})")
    print(f"Precomputed {ok} recommendation(s), {failed} failed.")


JOBS = {
    "odds": run_odds,
    "season": run_season,
    "fpi": run_fpi,
    "depth": run_depth,
    "weather": run_weather,
    "qb_starters": run_qb_starters,
    "pbp_stats": run_pbp_stats,
    "ngs_stats": run_ngs_stats,
    "recs": run_recs,
    "snapshots": lambda: snapshot_games(limit=500),
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", choices=JOBS, required=True)
    args = parser.parse_args()

    init_db()
    print(f"[{datetime.now().isoformat()}] Running tick: {args.job}")
    try:
        JOBS[args.job]()
    except Exception as e:
        print(f"Tick '{args.job}' failed: {e}")
        raise
