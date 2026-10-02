"""Aggregate nflverse's official weekly injury reports to team-week counts,
for backtesting the "banged up" signal the live model gets from the current
depth chart. Scoped to impact positions (same list the live signal uses) —
excludes specialists.

Usage:
    python -m ingestion.historical_injuries --start 2021 --end 2025
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nfl_data_py as nfl

from backend.database import db_session, init_db
from backend.teams import normalize_abbr
from backend.injuries import EXCLUDED_POSITIONS

OUT_STATUSES = {"Out", "Doubtful"}


def sync_historical_injuries(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching historical injury reports for seasons {seasons}...")
    df = nfl.import_injuries(seasons)
    df = df[df["report_status"].isin(OUT_STATUSES)].copy()
    df["team"] = df["team"].map(normalize_abbr)

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for (season, week, team), grp in df.groupby(["season", "week", "team"]):
        impact = grp[~grp["position"].isin(EXCLUDED_POSITIONS)]
        qb_out = int((impact["position"] == "QB").any())
        rows.append((int(season), int(week), team, len(impact), qb_out, now))

    init_db()
    with db_session() as conn:
        conn.executemany(
            """
            INSERT INTO historical_injury_counts (season, week, team, impact_out_count, qb_listed_out, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(season, week, team) DO UPDATE SET
                impact_out_count = excluded.impact_out_count, qb_listed_out = excluded.qb_listed_out,
                updated_at = excluded.updated_at
            """,
            rows,
        )
    print(f"Upserted {len(rows)} team-week injury count rows ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2021)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()
    sync_historical_injuries(args.start, args.end)
