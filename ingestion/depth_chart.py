"""Scrape true positional depth charts (starter/2nd/3rd string) from ESPN's
team depth chart pages.

There's no clean JSON REST endpoint for this — checked
`teams/{id}/depthchart` and `?enable=depthchart` variants on both
site.api.espn.com and the core API, all returned empty/404. ESPN's website
does render it, though, as a server-side JSON blob embedded in the page
(`window['__espnfitt__']`), which is what this scrapes. More fragile than a
real API (depends on that blob's key names, which could change with a
redesign) but it's the only free source of actual starter/depth-order data,
which is what lets injury signals be scoped to "does this affect the
starter" rather than any rostered player.

Usage:
    python -m ingestion.depth_chart
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from backend.database import db_session, init_db
from backend.teams import TEAMS, normalize_abbr

DEPTH_URL_TMPL = "https://www.espn.com/nfl/team/depth/_/name/{team_slug}"
MARKER = "window['__espnfitt__']="
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; GridironEdge/1.0)"}


def fetch_team_depth_chart(team_abbr: str) -> list[dict]:
    slug = TEAMS[team_abbr]["espn_slug"]
    resp = requests.get(DEPTH_URL_TMPL.format(team_slug=slug), headers=HEADERS, timeout=20)
    resp.raise_for_status()
    html = resp.text

    start = html.index(MARKER) + len(MARKER)
    end = html.index("};</script>", start) + 1
    data = json.loads(html[start:end])

    groups = data["page"]["content"]["depth"]["dethTeamGroups"]
    entries = []
    for group in groups:
        seen_positions: dict = {}
        for position, *players in group["rows"]:
            seen_positions[position] = seen_positions.get(position, 0) + 1
            slot = position if seen_positions[position] == 1 else f"{position}{seen_positions[position]}"
            for depth_rank, player in enumerate(players, start=1):
                if not player or not player.get("name"):
                    continue
                injuries = player.get("injuries") or []
                player_id = None
                uid = player.get("uid", "")
                if "a:" in uid:
                    player_id = uid.split("a:")[-1]
                entries.append(
                    {
                        "position": slot,
                        "depth_rank": depth_rank,
                        "player_id": player_id,
                        "player_name": player["name"],
                        "injury_status": injuries[0] if injuries else None,
                    }
                )
    return entries


def sync_depth_charts():
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    total = 0
    with db_session() as conn:
        for team in TEAMS:
            try:
                entries = fetch_team_depth_chart(normalize_abbr(team))
            except (requests.RequestException, ValueError, KeyError, json.JSONDecodeError) as e:
                print(f"  {team}: fetch failed ({e})")
                continue
            conn.execute("DELETE FROM depth_chart WHERE team = ?", (team,))
            conn.executemany(
                """INSERT INTO depth_chart (team, position, depth_rank, player_id, player_name, injury_status, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (team, position, depth_rank) DO NOTHING""",
                [(team, e["position"], e["depth_rank"], e["player_id"], e["player_name"], e["injury_status"], now) for e in entries],
            )
            total += len(entries)
    print(f"Synced depth charts for 32 teams, {total} depth-chart slots total.")


if __name__ == "__main__":
    sync_depth_charts()
