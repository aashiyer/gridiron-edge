import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(os.environ.get("DB_PATH", str(Path(__file__).resolve().parent.parent / "data" / "nfl.db")))
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.sql"
SCHEMA_PATH_PG = Path(__file__).resolve().parent.parent / "db" / "schema_postgres.sql"

DATABASE_URL = os.environ.get("DATABASE_URL")


def get_connection():
    if DATABASE_URL:
        from backend.db_compat_pg import connect_postgres

        return connect_postgres(DATABASE_URL)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_GAMES_MIGRATIONS = [
    ("stadium_id", "TEXT"),
    ("stadium", "TEXT"),
    ("roof", "TEXT"),
    ("surface", "TEXT"),
    ("home_rest", "INTEGER"),
    ("away_rest", "INTEGER"),
    ("div_game", "INTEGER"),
    ("temp", "REAL"),
    ("wind", "REAL"),
    ("precip_pct", "REAL"),
]


_PICKS_MIGRATIONS = [
    ("model_lean", "TEXT"),
    ("model_confidence", "REAL"),
    ("model_line", "REAL"),
    ("model_result", "TEXT NOT NULL DEFAULT 'pending'"),
    ("user_id", "INTEGER REFERENCES users(user_id)"),
]

_TEAM_STATS_MIGRATIONS = [
    ("off_yards_play", "REAL"),
    ("def_yards_play", "REAL"),
]

_QB_STARTERS_MIGRATIONS = [
    ("dropbacks", "INTEGER"),
    ("epa_dropback", "REAL"),
    ("cpoe", "REAL"),
    ("yards_per_att", "REAL"),
    ("success_rate", "REAL"),
]


def _migrate(conn):
    existing = {row["name"].lower() for row in conn.execute("PRAGMA table_info(games)")}
    for col, coltype in _GAMES_MIGRATIONS:
        if col.lower() not in existing:
            conn.execute(f"ALTER TABLE games ADD COLUMN {col} {coltype}")

    existing_picks = {row["name"].lower() for row in conn.execute("PRAGMA table_info(picks)")}
    for col, coltype in _PICKS_MIGRATIONS:
        if col.lower() not in existing_picks:
            conn.execute(f"ALTER TABLE picks ADD COLUMN {col} {coltype}")

    existing_team_stats = {row["name"].lower() for row in conn.execute("PRAGMA table_info(team_stats)")}
    for col, coltype in _TEAM_STATS_MIGRATIONS:
        if col.lower() not in existing_team_stats:
            conn.execute(f"ALTER TABLE team_stats ADD COLUMN {col} {coltype}")

    existing_qb_starters = {row["name"].lower() for row in conn.execute("PRAGMA table_info(qb_starters)")}
    for col, coltype in _QB_STARTERS_MIGRATIONS:
        if col.lower() not in existing_qb_starters:
            conn.execute(f"ALTER TABLE qb_starters ADD COLUMN {col} {coltype}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_picks_user ON picks(user_id)")

    conn.execute(
        """DELETE FROM picks WHERE user_id IS NOT NULL AND pick_id NOT IN (
               SELECT MAX(pick_id) FROM picks WHERE user_id IS NOT NULL
               GROUP BY user_id, game_id, pick_type
           )"""
    )
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_unique_market ON picks(user_id, game_id, pick_type)")

    conn.execute(
        """DELETE FROM odds_snapshots WHERE game_id IN (SELECT game_id FROM games WHERE status = 'final')
           AND id NOT IN (
               SELECT MAX(id) FROM odds_snapshots
               WHERE game_id IN (SELECT game_id FROM games WHERE status = 'final')
               GROUP BY game_id
           )"""
    )
    conn.execute(
        """UPDATE odds_snapshots SET
               home_spread = (SELECT g.home_spread_close FROM games g WHERE g.game_id = odds_snapshots.game_id),
               total = (SELECT g.total_close FROM games g WHERE g.game_id = odds_snapshots.game_id),
               home_ml = (SELECT g.home_ml_close FROM games g WHERE g.game_id = odds_snapshots.game_id),
               away_ml = (SELECT g.away_ml_close FROM games g WHERE g.game_id = odds_snapshots.game_id)
           WHERE game_id IN (
               SELECT g.game_id FROM games g
               WHERE g.status = 'final' AND g.home_spread_close IS NOT NULL
           )
           AND home_spread != (SELECT g.home_spread_close FROM games g WHERE g.game_id = odds_snapshots.game_id)"""
    )

    conn.execute(
        """UPDATE picks SET model_line = (
               SELECT CASE WHEN picks.model_lean = g.away_team THEN -g.home_spread_close ELSE g.home_spread_close END
               FROM games g WHERE g.game_id = picks.game_id
           )
           WHERE pick_type = 'ats' AND model_lean IS NOT NULL
           AND game_id IN (SELECT game_id FROM games WHERE home_spread_close IS NOT NULL)"""
    )
    conn.execute(
        """UPDATE picks SET model_result = (
               SELECT CASE
                   WHEN picks.model_lean = g.home_team THEN
                       CASE WHEN (g.final_home_score - g.final_away_score + picks.model_line) > 0 THEN 'win'
                            WHEN (g.final_home_score - g.final_away_score + picks.model_line) < 0 THEN 'loss'
                            ELSE 'push' END
                   WHEN picks.model_lean = g.away_team THEN
                       CASE WHEN (g.final_away_score - g.final_home_score + picks.model_line) > 0 THEN 'win'
                            WHEN (g.final_away_score - g.final_home_score + picks.model_line) < 0 THEN 'loss'
                            ELSE 'push' END
                   ELSE picks.model_result
               END
               FROM games g WHERE g.game_id = picks.game_id
           )
           WHERE pick_type = 'ats' AND model_lean IS NOT NULL AND model_line IS NOT NULL
           AND game_id IN (SELECT game_id FROM games WHERE status = 'final')"""
    )

    ts_cols = {row["name"].lower() for row in conn.execute("PRAGMA table_info(team_stats)")}
    if ts_cols and "off_epa_play" not in ts_cols:
        conn.execute("DROP TABLE team_stats")
        with open(SCHEMA_PATH) as f:
            schema_sql = f.read()
        start = schema_sql.index("CREATE TABLE IF NOT EXISTS team_stats")
        end = schema_sql.index(";", start) + 1
        conn.executescript(schema_sql[start:end])


def init_db():
    if DATABASE_URL:
        conn = get_connection()
        with open(SCHEMA_PATH_PG) as f:
            conn.executescript(f.read())
        conn.commit()
        conn.close()
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())
    _migrate(conn)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Initialized database at {DB_PATH}")
