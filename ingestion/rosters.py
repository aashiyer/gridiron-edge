"""Backfill active-roster membership per team/season from nflverse, used to
compute roster continuity (how much of a team's roster carries over year to
year) — a fast-turnover team like a post-rebuild Dolphins should have its
own history discounted much more than a stable team like the Bills.

Usage:
    python -m ingestion.rosters --start 2020 --end 2026
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nfl_data_py as nfl

from backend.database import db_session, init_db
from backend.teams import normalize_abbr


def backfill_rosters(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching rosters for seasons {seasons}...")
    df = nfl.import_seasonal_rosters(seasons)
    df = df[df["status"] == "ACT"]
    df = df.dropna(subset=["player_id", "team", "season"])

    rows = [
        (int(r["season"]), normalize_abbr(r["team"]), str(r["player_id"]), r.get("position"))
        for _, r in df.iterrows()
    ]

    init_db()
    with db_session() as conn:
        conn.executemany(
            """INSERT INTO rosters (season, team, player_id, position) VALUES (?, ?, ?, ?)
               ON CONFLICT (season, team, player_id) DO UPDATE SET position = excluded.position""",
            rows,
        )
    print(f"Upserted {len(rows)} active-roster entries ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2020)
    parser.add_argument("--end", type=int, default=2026)
    args = parser.parse_args()
    backfill_rosters(args.start, args.end)
