"""Poll ESPN's unofficial API for current-week games, live odds, and scores.

No auth required, but undocumented/unofficial: schema can drift, so this is
defensive about missing fields.

Usage:
    python -m ingestion.espn_odds            # one-off poll
    python -m ingestion.espn_odds --loop 900  # poll every 900s (15 min)
"""
import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db
from backend.teams import normalize_abbr

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ODDS_URL_TMPL = (
    "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{event_id}/competitions/{event_id}/odds"
)

STATUS_MAP = {
    "STATUS_SCHEDULED": "scheduled",
    "STATUS_IN_PROGRESS": "in_progress",
    "STATUS_HALFTIME": "in_progress",
    "STATUS_FINAL": "final",
}


def fetch_scoreboard(week: int = None, season: int = None):
    params = {}
    if week:
        params["week"] = week
    if season:
        params["seasontype"] = 2
        params["dates"] = season
    resp = requests.get(SCOREBOARD_URL, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_odds(event_id: str):
    try:
        resp = requests.get(ODDS_URL_TMPL.format(event_id=event_id), timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"  odds fetch failed for {event_id}: {e}")
        return None


def _rest_days(conn, team: str, before_kickoff: str, exclude_game_id: str):
    """Days since `team`'s previous game, based on games already in our DB."""
    if not before_kickoff:
        return None
    row = conn.execute(
        """
        SELECT kickoff_time FROM games
        WHERE (home_team = ? OR away_team = ?) AND game_id != ? AND kickoff_time < ?
        ORDER BY kickoff_time DESC LIMIT 1
        """,
        (team, team, exclude_game_id, before_kickoff),
    ).fetchone()
    if not row or not row["kickoff_time"]:
        return None
    try:
        prev = datetime.fromisoformat(row["kickoff_time"].replace("Z", "+00:00")).replace(tzinfo=None)
        curr = datetime.fromisoformat(before_kickoff.replace("Z", "+00:00")).replace(tzinfo=None)
        return (curr - prev).days
    except ValueError:
        return None


def upsert_game(conn, event: dict):
    comp = event["competitions"][0]
    competitors = comp["competitors"]
    home = next(c for c in competitors if c["homeAway"] == "home")
    away = next(c for c in competitors if c["homeAway"] == "away")

    home_abbr = normalize_abbr(home["team"]["abbreviation"])
    away_abbr = normalize_abbr(away["team"]["abbreviation"])
    status_name = comp["status"]["type"]["name"]
    status = STATUS_MAP.get(status_name, "scheduled")

    home_score = int(home["score"]) if status != "scheduled" and home.get("score") not in (None, "") else None
    away_score = int(away["score"]) if status != "scheduled" and away.get("score") not in (None, "") else None

    season = event.get("season", {}).get("year")
    week = event.get("week", {}).get("number")

    venue = comp.get("venue", {})
    stadium_id = venue.get("id")
    stadium = venue.get("fullName")
    roof = "dome" if venue.get("indoor") else "outdoors"
    kickoff_time = event.get("date")

    home_rest = _rest_days(conn, home_abbr, kickoff_time, event["id"])
    away_rest = _rest_days(conn, away_abbr, kickoff_time, event["id"])

    home_spread_close = total_close = home_ml_close = away_ml_close = None
    if status == "final":
        latest = conn.execute(
            "SELECT home_spread, total, home_ml, away_ml FROM odds_snapshots WHERE game_id = ? ORDER BY captured_at DESC LIMIT 1",
            (event["id"],),
        ).fetchone()
        if latest:
            home_spread_close, total_close, home_ml_close, away_ml_close = (
                latest["home_spread"], latest["total"], latest["home_ml"], latest["away_ml"],
            )

    conn.execute(
        """
        INSERT INTO games (game_id, season, week, game_type, home_team, away_team, kickoff_time,
                            status, final_home_score, final_away_score, source,
                            stadium_id, stadium, roof, home_rest, away_rest,
                            home_spread_close, total_close, home_ml_close, away_ml_close)
        VALUES (?, ?, ?, 'REG', ?, ?, ?, ?, ?, ?, 'espn', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
            -- Once locally recorded as final, a later poll reporting this
            -- game as anything else is more likely ESPN flakiness (observed
            -- live — see _poll_events' kickoff-time comment) than a real
            -- reversal, so don't let status/scores regress once final.
            status = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.status ELSE excluded.status END,
            final_home_score = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.final_home_score ELSE excluded.final_home_score END,
            final_away_score = CASE WHEN games.status = 'final' AND excluded.status != 'final' THEN games.final_away_score ELSE excluded.final_away_score END,
            stadium_id = excluded.stadium_id,
            stadium = excluded.stadium,
            home_spread_close = COALESCE(games.home_spread_close, excluded.home_spread_close),
            total_close = COALESCE(games.total_close, excluded.total_close),
            home_ml_close = COALESCE(games.home_ml_close, excluded.home_ml_close),
            away_ml_close = COALESCE(games.away_ml_close, excluded.away_ml_close),
            roof = excluded.roof,
            home_rest = excluded.home_rest,
            away_rest = excluded.away_rest
        """,
        (
            event["id"], season, week, home_abbr, away_abbr, kickoff_time, status, home_score, away_score,
            stadium_id, stadium, roof, home_rest, away_rest,
            home_spread_close, total_close, home_ml_close, away_ml_close,
        ),
    )
    return event["id"], status, kickoff_time


def record_odds_snapshot(conn, game_id: str):
    data = fetch_odds(game_id)
    if not data or "items" not in data:
        return 0
    captured_at = datetime.now(timezone.utc).isoformat()
    count = 0
    for item in data["items"]:
        provider = item.get("provider", {}).get("name", "unknown")
        home_spread = item.get("spread")
        total = item.get("overUnder")
        home_ml = item.get("homeTeamOdds", {}).get("moneyLine")
        away_ml = item.get("awayTeamOdds", {}).get("moneyLine")
        conn.execute(
            """INSERT INTO odds_snapshots (game_id, provider, captured_at, home_spread, total, home_ml, away_ml)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (game_id, provider, captured_at, home_spread, total, home_ml, away_ml),
        )
        count += 1
    return count


def _poll_events(events: list):
    with db_session() as conn:
        for event in events:
            game_id, status, kickoff_time = upsert_game(conn, event)

            kickoff_long_past = False
            if kickoff_time:
                try:
                    kt = datetime.fromisoformat(kickoff_time.replace("Z", "+00:00"))
                    kickoff_long_past = (datetime.now(timezone.utc) - kt).total_seconds() > 5.5 * 3600
                except ValueError:
                    pass

            if status == "final" or kickoff_long_past:
                has_snapshot = conn.execute(
                    "SELECT 1 FROM odds_snapshots WHERE game_id = ? LIMIT 1", (game_id,)
                ).fetchone()
                if has_snapshot:
                    print(f"  {game_id} ({status}, kickoff long past={kickoff_long_past}): already have a closing snapshot, skipping")
                    continue

            n = record_odds_snapshot(conn, game_id)
            print(f"  {game_id} ({status}): {n} odds snapshot(s) recorded")


def poll_once():
    """Poll ESPN's default "current week" scoreboard — the fast, frequent
    tick for live scores/odds on whatever's actually being played right now."""
    board = fetch_scoreboard()
    events = board.get("events", [])
    print(f"[{datetime.now().isoformat()}] Found {len(events)} games on the scoreboard.")
    _poll_events(events)


def poll_full_season(season: int, start_week: int = 1, end_week: int = 18):
    """Explicitly fetch every week of the season, not just whatever ESPN's
    scoreboard defaults to — the default only ever returns the current week,
    so future weeks' matchups/lines never showed up until they became
    "current" on ESPN's own site. Lower frequency than poll_once (schedules
    and posted lines don't change minute to minute)."""
    total = 0
    for week in range(start_week, end_week + 1):
        try:
            board = fetch_scoreboard(week=week, season=season)
        except requests.RequestException as e:
            print(f"  week {week}: fetch failed ({e})")
            continue
        events = board.get("events", [])
        if not events:
            continue
        print(f"[{datetime.now().isoformat()}] Week {week}: {len(events)} games.")
        _poll_events(events)
        total += len(events)
    print(f"Full-season sweep complete: {total} games across weeks {start_week}-{end_week}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=0, help="Seconds between polls; 0 = run once")
    args = parser.parse_args()

    init_db()
    if args.loop:
        while True:
            poll_once()
            time.sleep(args.loop)
    else:
        poll_once()
