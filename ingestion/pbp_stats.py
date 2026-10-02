"""Aggregate nflverse play-by-play into team-week efficiency stats: EPA/play
(offense and defense, overall/pass/rush), success rate, 3rd-down conversion,
red-zone TD rate, turnover margin, pass rate.

nflverse's play-by-play ships `epa`/`success`/`wpa` already computed by
their own published EP/WP models — this aggregates those to team-week
level, it doesn't refit the underlying models.

Usage:
    python -m ingestion.pbp_stats --start 2021 --end 2025
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

SCRIMMAGE_TYPES = {"pass", "run"}


def _team_week_stats(pbp: pd.DataFrame) -> pd.DataFrame:
    pbp = pbp[pbp["play_type"].isin(SCRIMMAGE_TYPES) & pbp["epa"].notna()].copy()
    pbp["posteam"] = pbp["posteam"].map(normalize_abbr)
    pbp["defteam"] = pbp["defteam"].map(normalize_abbr)
    pbp["turnover"] = ((pbp["interception"] == 1) | (pbp["fumble_lost"] == 1)).astype(int)

    rows = []
    for (season, week, team), off in pbp.groupby(["season", "week", "posteam"]):
        deff = pbp[(pbp["season"] == season) & (pbp["week"] == week) & (pbp["defteam"] == team)]

        third_down = off[off["down"] == 3]
        third_down_def = deff[deff["down"] == 3]

        rz_drives = off[off["yardline_100"] <= 20]["drive"].unique()
        rz_td_pct = None
        if len(rz_drives):
            drive_td = off[off["drive"].isin(rz_drives)].groupby("drive")["touchdown"].max()
            rz_td_pct = round(float(drive_td.mean()) * 100, 1)

        rz_drives_def = deff[deff["yardline_100"] <= 20]["drive"].unique()
        rz_td_pct_def = None
        if len(rz_drives_def):
            drive_td_def = deff[deff["drive"].isin(rz_drives_def)].groupby("drive")["touchdown"].max()
            rz_td_pct_def = round(float(drive_td_def.mean()) * 100, 1)

        pass_plays = off[off["pass"] == 1]
        rush_plays = off[off["rush"] == 1]

        rows.append(
            {
                "season": int(season),
                "week": int(week),
                "team": team,
                "plays_offense": len(off),
                "off_epa_play": round(float(off["epa"].mean()), 4),
                "off_epa_pass": round(float(pass_plays["epa"].mean()), 4) if len(pass_plays) else None,
                "off_epa_rush": round(float(rush_plays["epa"].mean()), 4) if len(rush_plays) else None,
                "off_success_rate": round(float(off["success"].mean()) * 100, 1),
                "off_yards_play": round(float(off["yards_gained"].mean()), 2) if len(off) else None,
                "pass_rate": round(len(pass_plays) / len(off) * 100, 1) if len(off) else None,
                "def_epa_play": round(float(deff["epa"].mean()), 4) if len(deff) else None,
                "def_success_rate": round(float(deff["success"].mean()) * 100, 1) if len(deff) else None,
                "def_yards_play": round(float(deff["yards_gained"].mean()), 2) if len(deff) else None,
                "third_down_pct": round(float(third_down["first_down"].mean()) * 100, 1) if len(third_down) else None,
                "third_down_pct_def": round(float(third_down_def["first_down"].mean()) * 100, 1) if len(third_down_def) else None,
                "red_zone_td_pct": rz_td_pct,
                "red_zone_td_pct_def": rz_td_pct_def,
                "turnovers_lost": int(off["turnover"].sum()),
                "turnovers_forced": int(deff["turnover"].sum()) if len(deff) else 0,
            }
        )

    df = pd.DataFrame(rows)
    df["turnover_margin"] = df["turnovers_forced"] - df["turnovers_lost"]
    return df


PBP_COLUMNS = [
    "season", "week", "play_type", "epa", "success", "posteam", "defteam",
    "interception", "fumble_lost", "down", "first_down", "yardline_100",
    "drive", "touchdown", "pass", "rush", "yards_gained",
]


def sync_pbp_stats(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching play-by-play for seasons {seasons} (this pulls ~50k rows/season)...")
    pbp = nfl.import_pbp_data(seasons, columns=PBP_COLUMNS, downcast=True, cache=False, include_participation=False)
    print(f"Loaded {len(pbp)} plays. Aggregating to team-week...")

    stats = _team_week_stats(pbp)

    init_db()
    with db_session() as conn:
        games = conn.execute(
            "SELECT season, week, home_team, away_team, final_home_score, final_away_score FROM games WHERE status = 'final'"
        ).fetchall()
        points = {}
        for g in games:
            points[(g["season"], g["week"], g["home_team"])] = (g["final_home_score"], g["final_away_score"])
            points[(g["season"], g["week"], g["away_team"])] = (g["final_away_score"], g["final_home_score"])

        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for _, r in stats.iterrows():
            pf, pa = points.get((r["season"], r["week"], r["team"]), (None, None))
            rows.append(
                (
                    r["season"], r["week"], r["team"], int(r["plays_offense"]),
                    r["off_epa_play"], r["off_epa_pass"], r["off_epa_rush"], r["off_success_rate"], r["off_yards_play"], r["pass_rate"],
                    r["def_epa_play"], r["def_success_rate"], r["def_yards_play"], r["third_down_pct"], r["third_down_pct_def"],
                    r["red_zone_td_pct"], r["red_zone_td_pct_def"],
                    int(r["turnovers_lost"]), int(r["turnovers_forced"]), int(r["turnover_margin"]),
                    pf, pa, now,
                )
            )

        rows = [tuple(None if isinstance(v, float) and v != v else v for v in row) for row in rows]

        conn.executemany(
            """
            INSERT INTO team_stats (
                season, week, team, plays_offense, off_epa_play, off_epa_pass, off_epa_rush,
                off_success_rate, off_yards_play, pass_rate, def_epa_play, def_success_rate, def_yards_play,
                third_down_pct, third_down_pct_def,
                red_zone_td_pct, red_zone_td_pct_def, turnovers_lost, turnovers_forced, turnover_margin,
                points_for, points_against, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(season, week, team) DO UPDATE SET
                plays_offense = excluded.plays_offense, off_epa_play = excluded.off_epa_play,
                off_epa_pass = excluded.off_epa_pass, off_epa_rush = excluded.off_epa_rush,
                off_success_rate = excluded.off_success_rate, off_yards_play = excluded.off_yards_play, pass_rate = excluded.pass_rate,
                def_epa_play = excluded.def_epa_play, def_success_rate = excluded.def_success_rate, def_yards_play = excluded.def_yards_play,
                third_down_pct = excluded.third_down_pct, third_down_pct_def = excluded.third_down_pct_def,
                red_zone_td_pct = excluded.red_zone_td_pct, red_zone_td_pct_def = excluded.red_zone_td_pct_def,
                turnovers_lost = excluded.turnovers_lost, turnovers_forced = excluded.turnovers_forced,
                turnover_margin = excluded.turnover_margin, points_for = excluded.points_for,
                points_against = excluded.points_against, updated_at = excluded.updated_at
            """,
            rows,
        )
    print(f"Upserted {len(rows)} team-week rows ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2021)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()
    sync_pbp_stats(args.start, args.end)
