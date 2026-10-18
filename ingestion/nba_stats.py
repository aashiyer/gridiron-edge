"""Team box scores for finished NBA games, from ESPN's summary endpoint.

One request per finished game, stored as two small rows (one per team) in
nba_team_games. Games are picked up as they finish, a few per run, so the
cost is spread across the season and nothing is loaded for games nobody is
looking at yet. The game view reads aggregates of these rows, never the rows.

Usage:
    python -m ingestion.nba_stats                 # new finals this season (capped)
    python -m ingestion.nba_stats --limit 200     # catch up after a gap
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"


def _pair(value):
    try:
        made, att = str(value).split("-")
        return int(made), int(att)
    except (ValueError, AttributeError):
        return None, None


def _num(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def parse_box(summary: dict, home: str, away: str, home_pts, away_pts):
    """[(team, opp, is_home, own_pts, opp_pts, stats)] from a summary payload."""
    out = []
    for t in (summary.get("boxscore") or {}).get("teams", []):
        abbr = t["team"]["abbreviation"]
        s = {x["name"]: x.get("displayValue") for x in t.get("statistics", [])}
        fgm, fga = _pair(s.get("fieldGoalsMade-fieldGoalsAttempted"))
        tpm, tpa = _pair(s.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
        ftm, fta = _pair(s.get("freeThrowsMade-freeThrowsAttempted"))
        is_home = abbr == home
        opp = away if is_home else home
        out.append((abbr, opp, int(is_home), home_pts if is_home else away_pts, away_pts if is_home else home_pts, {
            "fgm": fgm, "fga": fga, "tpm": tpm, "tpa": tpa, "ftm": ftm, "fta": fta,
            "reb": _num(s.get("totalRebounds")), "oreb": _num(s.get("offensiveRebounds")),
            "ast": _num(s.get("assists")), "stl": _num(s.get("steals")), "blk": _num(s.get("blocks")),
            "tov": _num(s.get("totalTurnovers") or s.get("turnovers")), "pf": _num(s.get("fouls")),
            "paint": _num(s.get("pointsInPaint")), "fastbreak": _num(s.get("fastBreakPoints")),
        }))
    return out


COLS = ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "reb", "oreb", "ast", "stl", "blk", "tov", "pf", "paint", "fastbreak"]


def sync_box_scores(limit: int = 30, season: int = None):
    with db_session() as conn:
        if season is None:
            season = conn.execute("SELECT MAX(season) AS s FROM games WHERE sport = 'nba'").fetchone()["s"]
        if season is None:
            return 0
        todo = conn.execute(
            """SELECT g.game_id, g.home_team, g.away_team, g.final_home_score, g.final_away_score FROM games g
               WHERE g.sport = 'nba' AND g.season = ? AND g.status = 'final'
                 AND NOT EXISTS (SELECT 1 FROM nba_team_games n WHERE n.game_id = g.game_id)
               ORDER BY g.kickoff_time ASC LIMIT ?""",
            (season, limit),
        ).fetchall()
    stored = 0
    for g in todo:
        event_id = g["game_id"].replace("nba-", "", 1)
        try:
            resp = requests.get(SUMMARY_URL, params={"event": event_id}, timeout=20)
            resp.raise_for_status()
            rows = parse_box(resp.json(), g["home_team"], g["away_team"], g["final_home_score"], g["final_away_score"])
        except (requests.RequestException, KeyError, ValueError) as e:
            print(f"  {g['game_id']}: box score failed ({e})")
            continue
        if len(rows) != 2:
            continue
        with db_session() as conn:
            for team, opp, is_home, pts, opp_pts, s in rows:
                conn.execute(
                    f"""INSERT INTO nba_team_games (game_id, team, opp, is_home, pts, opp_pts, {", ".join(COLS)})
                        VALUES (?, ?, ?, ?, ?, ?, {", ".join("?" for _ in COLS)}) ON CONFLICT(game_id, team) DO NOTHING""",
                    (g["game_id"], team, opp, is_home, pts, opp_pts, *[s[c] for c in COLS]),
                )
        stored += 1
    print(f"NBA box scores: {stored} game(s) stored.")
    return stored


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--season", type=int)
    args = parser.parse_args()
    init_db()
    sync_box_scores(args.limit, args.season)
