"""Aggregate nflverse NextGen Stats (tracking-chip data) to team-week level.
Player-level passing/receiving/rushing NGS feeds, volume-weighted (by
attempts/targets/carries) up to a team-week summary — a pressure/skill-
quality layer that box-score EPA alone doesn't capture.

Usage:
    python -m ingestion.ngs_stats --start 2021 --end 2025
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nfl_data_py as nfl
import numpy as np
import pandas as pd

from backend.database import db_session, init_db
from backend.teams import normalize_abbr


def _weighted_avg(df: pd.DataFrame, value_col: str, weight_col: str):
    d = df[[value_col, weight_col]].dropna()
    if d.empty or d[weight_col].sum() == 0:
        return None
    return round(float(np.average(d[value_col], weights=d[weight_col])), 3)


def sync_ngs_stats(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching NextGen Stats for seasons {seasons}...")
    passing = nfl.import_ngs_data("passing", seasons)
    receiving = nfl.import_ngs_data("receiving", seasons)
    rushing = nfl.import_ngs_data("rushing", seasons)

    passing = passing[passing["week"] > 0].copy()
    receiving = receiving[receiving["week"] > 0].copy()
    rushing = rushing[rushing["week"] > 0].copy()

    for df in (passing, receiving, rushing):
        df["team_abbr"] = df["team_abbr"].map(normalize_abbr)

    keys = set()
    for df in (passing, receiving, rushing):
        keys |= set(zip(df["season"], df["week"], df["team_abbr"]))

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for season, week, team in keys:
        p = passing[(passing["season"] == season) & (passing["week"] == week) & (passing["team_abbr"] == team)]
        r = receiving[(receiving["season"] == season) & (receiving["week"] == week) & (receiving["team_abbr"] == team)]
        u = rushing[(rushing["season"] == season) & (rushing["week"] == week) & (rushing["team_abbr"] == team)]

        rows.append(
            (
                int(season), int(week), team,
                _weighted_avg(p, "avg_time_to_throw", "attempts"),
                _weighted_avg(p, "aggressiveness", "attempts"),
                _weighted_avg(p, "completion_percentage_above_expectation", "attempts"),
                _weighted_avg(r, "avg_separation", "targets"),
                _weighted_avg(r, "avg_cushion", "targets"),
                _weighted_avg(r, "avg_yac_above_expectation", "targets"),
                _weighted_avg(u, "efficiency", "rush_attempts"),
                _weighted_avg(u, "rush_yards_over_expected_per_att", "rush_attempts"),
                now,
            )
        )

    init_db()
    with db_session() as conn:
        conn.executemany(
            """
            INSERT INTO ngs_team_stats (
                season, week, team, avg_time_to_throw, aggressiveness, cpoe,
                avg_separation, avg_cushion, yac_above_expectation,
                rush_efficiency, rush_yards_over_expected_per_att, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(season, week, team) DO UPDATE SET
                avg_time_to_throw = excluded.avg_time_to_throw,
                aggressiveness = excluded.aggressiveness,
                cpoe = excluded.cpoe,
                avg_separation = excluded.avg_separation,
                avg_cushion = excluded.avg_cushion,
                yac_above_expectation = excluded.yac_above_expectation,
                rush_efficiency = excluded.rush_efficiency,
                rush_yards_over_expected_per_att = excluded.rush_yards_over_expected_per_att,
                updated_at = excluded.updated_at
            """,
            rows,
        )
    print(f"Upserted {len(rows)} team-week NGS rows ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2021)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()
    sync_ngs_stats(args.start, args.end)
