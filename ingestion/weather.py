"""Fetch game-day weather forecasts for upcoming outdoor games via Open-Meteo
(free, no API key, worldwide). Dome games are skipped — weather doesn't
reach the field. Historical temp/wind for completed games comes from
nflverse instead (see backfill_historical.py); this script is forecast-only.

Open-Meteo's hourly forecast only reaches out ~16 days, so games further out
than that are silently skipped until they roll into range on a later run.

Usage:
    python -m ingestion.weather
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db
from backend.stadiums import stadium_coords

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def _nearest_hour_value(times: list, values: list, target_iso: str):
    if not times or target_iso not in times:
        if times:
            target = datetime.fromisoformat(target_iso)
            closest_idx = min(range(len(times)), key=lambda i: abs((datetime.fromisoformat(times[i]) - target).total_seconds()))
            return values[closest_idx]
        return None
    return values[times.index(target_iso)]


def fetch_forecast(lat: float, lon: float, kickoff_iso: str):
    kickoff = datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    resp = requests.get(
        FORECAST_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,windspeed_10m,precipitation_probability",
            "temperature_unit": "fahrenheit",
            "windspeed_unit": "mph",
            "forecast_days": 16,
            "timezone": "UTC",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    target = kickoff.strftime("%Y-%m-%dT%H:00")
    return {
        "temp": _nearest_hour_value(times, hourly.get("temperature_2m", []), target),
        "wind": _nearest_hour_value(times, hourly.get("windspeed_10m", []), target),
        "precip_pct": _nearest_hour_value(times, hourly.get("precipitation_probability", []), target),
    }


def sync_weather():
    init_db()
    updated = 0
    skipped_dome = 0
    failed = 0
    horizon = (datetime.now(timezone.utc) + timedelta(days=16)).isoformat()
    with db_session() as conn:
        games = conn.execute(
            """SELECT game_id, home_team, kickoff_time, roof FROM games
               WHERE status = 'scheduled' AND kickoff_time IS NOT NULL AND kickoff_time <= ?""",
            (horizon,),
        ).fetchall()
        for g in games:
            if g["roof"] == "dome":
                skipped_dome += 1
                continue
            coords = stadium_coords(g["home_team"])
            if not coords:
                continue
            try:
                forecast = fetch_forecast(coords[0], coords[1], g["kickoff_time"])
                if forecast["temp"] is None:
                    continue
                conn.execute(
                    "UPDATE games SET temp = ?, wind = ?, precip_pct = ? WHERE game_id = ?",
                    (forecast["temp"], forecast["wind"], forecast["precip_pct"], g["game_id"]),
                )
                conn.commit()
                updated += 1
            except Exception as e:
                failed += 1
                print(f"  weather fetch failed for {g['game_id']}: {e}")
                continue
    print(f"Updated weather for {updated} game(s); skipped {skipped_dome} dome game(s); {failed} failed.")


if __name__ == "__main__":
    sync_weather()
