"""Qualitative game context from real ESPN news (practice reports,
beat-writer notes) — the nuance structured data (depth chart, injury status)
can't capture, e.g. "coach hinted the backup might play limited snaps."

Uses OpenAI (gpt-4o-mini — a few hundredths of a cent per game) to read the
last few days of headlines for both teams and extract anything relevant to
who plays or how the game might go. Requires OPENAI_API_KEY in the
environment; the feature is silently skipped (no reasons line, no cost) if
it isn't set — same pattern as the Anthropic explanation hook.

Results are cached per game (news_notes table) for CACHE_HOURS so repeat
page views don't re-spend credits — the news backing a game barely changes
hour to hour anyway.
"""
import os
from datetime import datetime, timedelta, timezone

import requests

from backend.teams import TEAMS, team_meta

NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"
CACHE_HOURS = 6
LOOKBACK_DAYS = 4
MODEL = "gpt-4o-mini"


def _fetch_team_headlines(team_abbr: str) -> list[dict]:
    meta = team_meta(team_abbr)
    slug = TEAMS.get(team_abbr, {}).get("espn_slug", team_abbr.lower())
    try:
        resp = requests.get(NEWS_URL, params={"team": slug}, timeout=10)
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
    except requests.RequestException:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    nickname = meta["name"].split()[-1]

    out = []
    for a in articles:
        published = a.get("published")
        if not published:
            continue
        try:
            pub_dt = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError:
            continue
        if pub_dt < cutoff:
            continue
        headline = a.get("headline", "")
        if nickname.lower() not in headline.lower() and meta["name"].lower() not in headline.lower():
            continue
        out.append({"headline": headline, "description": a.get("description", "")})
    return out[:5]


def _generate_note(home: str, away: str, home_news: list, away_news: list) -> str | None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or not (home_news or away_news):
        return None

    def fmt(team, items):
        if not items:
            return f"{team}: no recent team-specific news."
        lines = "\n".join(f"  - {i['headline']}: {i['description']}" for i in items)
        return f"{team}:\n{lines}"

    prompt = (
        "You're a terse NFL analyst prepping notes for an upcoming game. Given these recent headlines for "
        "each team, extract ONLY information relevant to who plays or how the game might go (injuries, "
        "practice participation, benchings, coaching decisions, suspensions). Ignore anything generic "
        "(power rankings, draft coverage, unrelated storylines).\n\n"
        "Write ONE combined note, 1-2 short sentences, no preamble, covering only whichever team(s) "
        "actually have something relevant — do not mention a team that has nothing relevant, and do not "
        "write the word NONE anywhere unless literally nothing in either team's news is relevant, in "
        "which case your entire response must be exactly: NONE\n\n"
        f"{fmt(home, home_news)}\n\n{fmt(away, away_news)}"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=MODEL,
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.choices[0].message.content.strip()
        return None if text.upper().startswith("NONE") else text
    except Exception as e:
        print(f"News note generation failed: {e}")
        return None


def get_news_note(conn, game_id: str, home: str, away: str) -> str | None:
    if not os.environ.get("OPENAI_API_KEY"):
        return None

    row = conn.execute("SELECT note, generated_at FROM news_notes WHERE game_id = ?", (game_id,)).fetchone()
    if row:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(row["generated_at"])
        if age < timedelta(hours=CACHE_HOURS):
            return row["note"]

    home_news = _fetch_team_headlines(home)
    away_news = _fetch_team_headlines(away)
    note = _generate_note(home, away, home_news, away_news)

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO news_notes (game_id, note, generated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(game_id) DO UPDATE SET note = excluded.note, generated_at = excluded.generated_at",
        (game_id, note, now),
    )
    return note
