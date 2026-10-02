"""Backfill `games` with historical schedules + closing lines from nflverse (nfl_data_py).

nfl_data_py's `import_schedules` already includes closing spread/total/moneyline
per game, so no separate odds scraping is needed for historical backtesting data.

Usage:
    python -m ingestion.backfill_historical --start 2021 --end 2025
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nfl_data_py as nfl

from backend.database import db_session, init_db
from backend.teams import normalize_abbr


def backfill(start_season: int, end_season: int):
    seasons = list(range(start_season, end_season + 1))
    print(f"Fetching schedules for seasons {seasons}...")
    df = nfl.import_schedules(seasons)

    rows = []
    for _, r in df.iterrows():
        status = "final" if not (r.get("home_score") != r.get("home_score")) else "scheduled"
        home_score = None if r.get("home_score") != r.get("home_score") else int(r["home_score"])
        away_score = None if r.get("away_score") != r.get("away_score") else int(r["away_score"])

        def clean(v):
            return None if v != v else float(v)

        def clean_str(v):
            return None if v != v else str(v)

        def clean_int(v):
            return None if v != v else int(v)

        rows.append(
            (
                r["game_id"],
                int(r["season"]),
                int(r["week"]),
                r.get("game_type", "REG"),
                normalize_abbr(r["home_team"]),
                normalize_abbr(r["away_team"]),
                str(r.get("gameday", "")) + ("T" + str(r["gametime"]) if r.get("gametime") == r.get("gametime") else ""),
                status,
                home_score,
                away_score,
                (-clean(r.get("spread_line")) if clean(r.get("spread_line")) is not None else None),
                clean(r.get("total_line")),
                clean(r.get("home_moneyline")),
                clean(r.get("away_moneyline")),
                "nflverse",
                clean_str(r.get("stadium_id")),
                clean_str(r.get("stadium")),
                clean_str(r.get("roof")),
                clean_str(r.get("surface")),
                clean_int(r.get("home_rest")),
                clean_int(r.get("away_rest")),
                clean_int(r.get("div_game")),
                clean(r.get("temp")),
                clean(r.get("wind")),
            )
        )

    init_db()
    with db_session() as conn:
        conn.executemany(
            """
            INSERT INTO games (
                game_id, season, week, game_type, home_team, away_team, kickoff_time,
                status, final_home_score, final_away_score,
                home_spread_close, total_close, home_ml_close, away_ml_close, source,
                stadium_id, stadium, roof, surface, home_rest, away_rest, div_game, temp, wind
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET
                final_home_score = excluded.final_home_score,
                final_away_score = excluded.final_away_score,
                status = excluded.status,
                home_spread_close = excluded.home_spread_close,
                total_close = excluded.total_close,
                home_ml_close = excluded.home_ml_close,
                away_ml_close = excluded.away_ml_close,
                stadium_id = excluded.stadium_id,
                stadium = excluded.stadium,
                roof = excluded.roof,
                surface = excluded.surface,
                home_rest = excluded.home_rest,
                away_rest = excluded.away_rest,
                div_game = excluded.div_game,
                temp = excluded.temp,
                wind = excluded.wind
            """,
            rows,
        )
    print(f"Upserted {len(rows)} games ({start_season}-{end_season}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2021)
    parser.add_argument("--end", type=int, default=2025)
    args = parser.parse_args()
    backfill(args.start, args.end)
