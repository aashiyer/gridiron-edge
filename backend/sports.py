import time

from backend.database import db_session
from backend.teams import team_meta as nfl_team_meta

SPORTS = ("nfl", "nba")
DEFAULT_SPORT = "nfl"
_NBA_TEAMS: dict = {"at": 0.0, "teams": {}}
_NBA_TEAMS_TTL_SECONDS = 3600


def normalize_sport(value) -> str:
    return value if value in SPORTS else DEFAULT_SPORT


def nba_game_id(event_id: str) -> str:
    return f"nba-{event_id}"


def _nba_teams() -> dict:
    if time.time() - _NBA_TEAMS["at"] > _NBA_TEAMS_TTL_SECONDS or not _NBA_TEAMS["teams"]:
        with db_session() as conn:
            rows = conn.execute("SELECT abbr, name, logo, color, secondary FROM sport_teams WHERE sport = 'nba'").fetchall()
        _NBA_TEAMS["teams"] = {r["abbr"]: dict(r) for r in rows}
        _NBA_TEAMS["at"] = time.time()
    return _NBA_TEAMS["teams"]


def team_meta_for(sport: str, abbr: str) -> dict:
    if sport != "nba":
        return nfl_team_meta(abbr)
    row = _nba_teams().get(abbr)
    if row:
        return {
            "abbr": abbr,
            "name": row["name"],
            "logo": row["logo"] or f"https://a.espncdn.com/i/teamlogos/nba/500/{abbr.lower()}.png",
            "color": row["color"] or "#333333",
            "secondary": row["secondary"] or "#666666",
        }
    return {"abbr": abbr, "name": abbr, "logo": f"https://a.espncdn.com/i/teamlogos/nba/500/{abbr.lower()}.png", "color": "#333333", "secondary": "#666666"}


def nba_team_list() -> list:
    return sorted((team_meta_for("nba", abbr) for abbr in _nba_teams()), key=lambda t: t["name"])
