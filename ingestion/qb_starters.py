"""Identify each team's actual starting QB per week (leading passer by
attempts), from nflverse play-by-play. Used to backtest QB-change
disruption — who really took the snaps is more reliable ground truth than
guessing a historical depth chart (no free source for that exists).

Sourced from play-by-play, not nflverse's weekly `player_stats` release:
that release lags real games by months (as of this writing it has no 2025
file at all, even though the 2025 season is long since final in our own
`games` table from ESPN), which silently undercounted every QB's career
start total for any season it hadn't caught up to yet — e.g. Michael Penix
Jr. read as "3 career starts" instead of his real ~12 once 2025 is
included. Play-by-play is the same source `ingestion/pbp_stats.py` already
uses for team efficiency stats and is available same-season, so deriving
starts from it (leading passer by pass_attempt count) sidesteps that lag
entirely and keeps working for whatever the most recent season actually is.

Usage:
    python -m ingestion.qb_starters --start 2021 --end 2025
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nfl_data_py as nfl
import pandas as pd

from backend.database import db_session, init_db
from backend.teams import normalize_abbr


def _player_name_map() -> dict:
    """gsis_id -> full display name ("Michael Penix Jr."), not play-by-play's
    own abbreviated `passer_player_name` ("M.Penix") — the live Edge panel
    matches this table's names against the depth chart's full names (see
    resolve_qb_player_id_by_name in historical_injury_signal.py), which
    would silently stop matching anyone if this stored the abbreviated
    form instead."""
    try:
        players = nfl.import_players()
        return dict(zip(players["gsis_id"], players["display_name"]))
    except Exception as e:
        print(f"  couldn't fetch player name directory ({e}); falling back to play-by-play's abbreviated names")
        return {}


def sync_qb_starters(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching play-by-play QB usage for seasons {seasons}...")
    frames = []
    for season in seasons:
        try:
            frames.append(
                nfl.import_pbp_data(
                    [season],
                    columns=[
                        "passer_player_id", "passer_player_name", "posteam", "season", "week",
                        "pass_attempt", "sack", "epa", "success", "cpoe", "yards_gained",
                    ],
                    downcast=True,
                    include_participation=False,
                )
            )
        except Exception as e:
            print(f"  {season}: not available yet ({e}), skipping")
    if not frames:
        print("No play-by-play available for any requested season.")
        return

    df = pd.concat(frames, ignore_index=True)

    dropbacks = df[((df["pass_attempt"] == 1) | (df["sack"] == 1)) & df["passer_player_id"].notna() & df["posteam"].notna()].copy()
    dropbacks["posteam"] = dropbacks["posteam"].map(normalize_abbr)
    attempts_only = dropbacks[dropbacks["pass_attempt"] == 1]

    group_cols = ["season", "week", "posteam", "passer_player_id", "passer_player_name"]
    attempts = attempts_only.groupby(group_cols).size().reset_index(name="attempts")
    agg = dropbacks.groupby(group_cols).agg(
        dropbacks=("epa", "size"),
        epa_dropback=("epa", "mean"),
        success_rate=("success", "mean"),
    ).reset_index()
    attempt_agg = attempts_only.groupby(group_cols).agg(
        cpoe=("cpoe", "mean"),
        yards_per_att=("yards_gained", "mean"),
    ).reset_index()

    merged = attempts.merge(agg, on=group_cols, how="left").merge(attempt_agg, on=group_cols, how="left")

    idx = merged.groupby(["season", "week", "posteam"])["attempts"].idxmax()
    starters = merged.loc[idx]

    names = _player_name_map()
    now = datetime.now(timezone.utc).isoformat()

    def _round_or_none(v, digits):
        return round(float(v), digits) if pd.notna(v) else None

    rows = [
        (
            int(r["season"]),
            int(r["week"]),
            r["posteam"],
            str(r["passer_player_id"]),
            names.get(r["passer_player_id"], r["passer_player_name"]),
            int(r["attempts"]),
            int(r["dropbacks"]),
            _round_or_none(r["epa_dropback"], 4),
            _round_or_none(r["cpoe"], 2),
            _round_or_none(r["yards_per_att"], 2),
            _round_or_none(r["success_rate"] * 100 if pd.notna(r["success_rate"]) else None, 1),
            now,
        )
        for _, r in starters.iterrows()
    ]

    init_db()
    with db_session() as conn:
        conn.executemany(
            """
            INSERT INTO qb_starters (
                season, week, team, player_id, player_name, attempts,
                dropbacks, epa_dropback, cpoe, yards_per_att, success_rate, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(season, week, team) DO UPDATE SET
                player_id = excluded.player_id, player_name = excluded.player_name,
                attempts = excluded.attempts, dropbacks = excluded.dropbacks,
                epa_dropback = excluded.epa_dropback, cpoe = excluded.cpoe,
                yards_per_att = excluded.yards_per_att, success_rate = excluded.success_rate,
                updated_at = excluded.updated_at
            """,
            rows,
        )
    print(f"Upserted {len(rows)} team-week QB starter rows ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2021)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()
    sync_qb_starters(args.start, args.end)
