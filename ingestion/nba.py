"""Pull the NBA schedule, scores and DraftKings lines from ESPN's public
scoreboard (one small request per day) into the shared games table.

Only a handful of runs a day is needed: odds rows are written only when a line
actually changes, and lines freeze at tip-off just like the NFL's do.

Usage:
    python -m ingestion.nba                    # yesterday-and-before through next week
    python -m ingestion.nba --days-ahead 60    # fill in more of the schedule
"""
import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db
from backend.sports import nba_game_id

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
EASTERN = ZoneInfo("America/New_York")
FIRST_MONDAY = {2026: date(2026, 10, 19)}
SKIPPED_SEASON_TYPES = {1, 4}

FINAL_STATUSES = {"STATUS_FINAL", "STATUS_FINAL_OT"}
LIVE_STATUSES = {"STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_DELAYED", "STATUS_OVERTIME"}


def _monday_on_or_before(d: date) -> date:
    return d - timedelta(days=d.weekday())


def season_for(eastern_day: date) -> int:
    return eastern_day.year if eastern_day.month >= 8 else eastern_day.year - 1


def week_for(eastern_day: date, season: int) -> int:
    first = FIRST_MONDAY.get(season) or _monday_on_or_before(date(season, 10, 20))
    return max(1, (eastern_day - first).days // 7 + 1)


def _moneyline(raw):
    if raw in (None, ""):
        return None
    text = str(raw).strip().upper()
    if text in ("EVEN", "PK"):
        return 100
    try:
        return int(text.replace("+", ""))
    except ValueError:
        return None


def parse_odds(comp: dict):
    odds = (comp.get("odds") or [None])[0]
    if not odds:
        return None
    ml = odds.get("moneyline") or {}
    return {
        "provider": (odds.get("provider") or {}).get("name", "DraftKings"),
        "home_spread": odds.get("spread"),
        "total": odds.get("overUnder"),
        "home_ml": _moneyline(((ml.get("home") or {}).get("close") or {}).get("odds")),
        "away_ml": _moneyline(((ml.get("away") or {}).get("close") or {}).get("odds")),
    }


def _status(comp: dict):
    name = comp["status"]["type"]["name"]
    if name in FINAL_STATUSES or name.startswith("STATUS_FINAL"):
        return "final"
    if name in LIVE_STATUSES:
        return "in_progress"
    if name in ("STATUS_SCHEDULED",):
        return "scheduled"
    return None


def _save_team(conn, team: dict):
    color = team.get("color")
    secondary = team.get("alternateColor")
    conn.execute(
        """INSERT INTO sport_teams (sport, abbr, name, logo, color, secondary) VALUES ('nba', ?, ?, ?, ?, ?)
           ON CONFLICT(sport, abbr) DO UPDATE SET name = excluded.name, logo = excluded.logo,
               color = excluded.color, secondary = excluded.secondary""",
        (team["abbreviation"], team.get("displayName") or team["abbreviation"], team.get("logo"),
         f"#{color}" if color else None, f"#{secondary}" if secondary else None),
    )


def _last_snapshot(conn, game_id: str):
    return conn.execute(
        "SELECT home_spread, total, home_ml, away_ml FROM odds_snapshots WHERE game_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1",
        (game_id,),
    ).fetchone()


def _closing_line(conn, game_id: str, kickoff: str):
    row = conn.execute(
        """SELECT home_spread, total, home_ml, away_ml FROM odds_snapshots
           WHERE game_id = ? AND captured_at <= ? ORDER BY captured_at DESC, id DESC LIMIT 1""",
        (game_id, kickoff or "9999"),
    ).fetchone()
    return row or _last_snapshot(conn, game_id)


def process_event(conn, event: dict):
    season_type = (event.get("season") or {}).get("type")
    if season_type in SKIPPED_SEASON_TYPES:
        return None
    comp = event["competitions"][0]
    status = _status(comp)
    if status is None:
        return None
    home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
    away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
    _save_team(conn, home["team"])
    _save_team(conn, away["team"])

    kickoff = event["date"]
    eastern_day = datetime.strptime(kickoff, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc).astimezone(EASTERN).date()
    season = season_for(eastern_day)
    game_id = nba_game_id(event["id"])
    home_score = int(home["score"]) if status != "scheduled" and home.get("score") not in (None, "") else None
    away_score = int(away["score"]) if status != "scheduled" and away.get("score") not in (None, "") else None

    spread = total = home_ml = away_ml = None
    if status == "final":
        closing = _closing_line(conn, game_id, kickoff)
        if closing:
            spread, total, home_ml, away_ml = closing["home_spread"], closing["total"], closing["home_ml"], closing["away_ml"]

    conn.execute(
        """
        INSERT INTO games (game_id, season, week, game_type, home_team, away_team, kickoff_time, status,
                           final_home_score, final_away_score, source, sport,
                           home_spread_close, total_close, home_ml_close, away_ml_close)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'espn', 'nba', ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
            kickoff_time = excluded.kickoff_time,
            status = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.status ELSE excluded.status END,
            final_home_score = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.final_home_score ELSE excluded.final_home_score END,
            final_away_score = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.final_away_score ELSE excluded.final_away_score END,
            home_spread_close = COALESCE(games.home_spread_close, excluded.home_spread_close),
            total_close = COALESCE(games.total_close, excluded.total_close),
            home_ml_close = COALESCE(games.home_ml_close, excluded.home_ml_close),
            away_ml_close = COALESCE(games.away_ml_close, excluded.away_ml_close)
        """,
        (
            game_id, season, week_for(eastern_day, season), "REG" if season_type == 2 else "POST",
            home["team"]["abbreviation"], away["team"]["abbreviation"], kickoff, status, home_score, away_score,
            spread, total, home_ml, away_ml,
        ),
    )

    started = status != "scheduled" or kickoff <= datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    odds = parse_odds(comp)
    if odds and not started and any(odds[k] is not None for k in ("home_spread", "total", "home_ml", "away_ml")):
        last = _last_snapshot(conn, game_id)
        current = (odds["home_spread"], odds["total"], odds["home_ml"], odds["away_ml"])
        if not last or (last["home_spread"], last["total"], last["home_ml"], last["away_ml"]) != current:
            conn.execute(
                """INSERT INTO odds_snapshots (game_id, provider, captured_at, home_spread, total, home_ml, away_ml)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (game_id, odds["provider"], datetime.now(timezone.utc).isoformat(), *current),
            )
            return "line"
    return "game"


def fetch_day(day: date):
    resp = requests.get(SCOREBOARD_URL, params={"dates": day.strftime("%Y%m%d")}, timeout=20)
    resp.raise_for_status()
    return resp.json().get("events", [])


def run_nba(days_back: int = 2, days_ahead: int = 7):
    today = datetime.now(EASTERN).date()
    seen: dict = {}
    for offset in range(-days_back, days_ahead + 1):
        day = today + timedelta(days=offset)
        try:
            for event in fetch_day(day):
                seen[event["id"]] = event
        except requests.RequestException as e:
            print(f"  {day}: fetch failed ({e})")
    if not seen:
        print("No NBA games in this window.")
        return
    games = lines = 0
    with db_session() as conn:
        for event in seen.values():
            outcome = process_event(conn, event)
            games += outcome is not None
            lines += outcome == "line"
    print(f"NBA: {games} games updated, {lines} new line snapshot(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days-back", type=int, default=2)
    parser.add_argument("--days-ahead", type=int, default=7)
    args = parser.parse_args()
    init_db()
    run_nba(args.days_back, args.days_ahead)
