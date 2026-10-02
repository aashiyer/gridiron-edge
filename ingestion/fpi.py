"""Pull ESPN's Football Power Index (FPI) team ratings.

FPI is ESPN's power rating: expected point margin vs. an average opponent on
a neutral field, with offense/defense/special-teams components. It updates
roughly weekly during the season. No auth required; same unofficial-API
caveats as the odds/scoreboard endpoints.

Usage:
    python -m ingestion.fpi
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db
from backend.teams import normalize_abbr

POWERINDEX_URL = "https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex"


def _category_by_name(categories: list, name: str) -> dict:
    return next((c for c in categories if c.get("name") == name), {})


def fetch_fpi() -> list[dict]:
    resp = requests.get(POWERINDEX_URL, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    season = data.get("requestedSeason", {}).get("year")

    ratings = []
    for entry in data.get("teams", []):
        abbr = normalize_abbr(entry["team"]["abbreviation"])
        fpi_cat = _category_by_name(entry.get("categories", []), "fpi")
        values = fpi_cat.get("values", [])
        if len(values) < 13:
            continue
        ratings.append(
            {
                "team": abbr,
                "season": season,
                "fpi": values[0],
                "off_epa": values[1],
                "def_epa": values[2],
                "st_epa": values[3],
                "fpi_rank": int(values[4]) if values[4] is not None else None,
                "wins": int(values[11]) if values[11] is not None else None,
                "losses": int(values[12]) if values[12] is not None else None,
            }
        )
    return ratings


def sync_fpi():
    ratings = fetch_fpi()
    now = datetime.now(timezone.utc).isoformat()
    init_db()
    with db_session() as conn:
        for r in ratings:
            conn.execute(
                """
                INSERT INTO fpi_ratings (team, season, fpi, fpi_rank, off_epa, def_epa, st_epa, wins, losses, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(team) DO UPDATE SET
                    season = excluded.season, fpi = excluded.fpi, fpi_rank = excluded.fpi_rank,
                    off_epa = excluded.off_epa, def_epa = excluded.def_epa, st_epa = excluded.st_epa,
                    wins = excluded.wins, losses = excluded.losses, updated_at = excluded.updated_at
                """,
                (r["team"], r["season"], r["fpi"], r["fpi_rank"], r["off_epa"], r["def_epa"], r["st_epa"], r["wins"], r["losses"], now),
            )
    print(f"Synced FPI for {len(ratings)} teams.")


if __name__ == "__main__":
    sync_fpi()
