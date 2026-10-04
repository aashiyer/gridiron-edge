"""Backtestable injury/QB-stability signals, built from real usage data
(qb_starters) and official injury reports (historical_injury_counts) rather
than a historical depth chart, which doesn't exist as a free data source.
`qb_stability`/`recent_injury_load` are used only as regression-model
training features. `qb_career_starts`/`resolve_qb_player_id_by_name` are
shared by both the trained model AND the live "Edge" panel — the live panel
otherwise gets its injury signal from the current depth chart, which is
precise about *who* is playing but has no notion of whether that player has
ever actually played meaningful snaps before.
"""
import math
import re

RECENT_N = 4

_SUFFIX_RE = re.compile(r"\s+(jr\.?|sr\.?|ii|iii|iv)$", re.IGNORECASE)


def _normalize_name(name: str) -> str:
    return _SUFFIX_RE.sub("", (name or "").strip()).strip().lower()


def qb_stability(conn, team: str, season: int, before_week: int) -> int:
    """1 if the same player was the leading passer in each of the team's
    last RECENT_N games, 0 if there's been a QB change (a real disruption
    signal — not just any backup appearing, but the guy taking the most
    snaps actually changing)."""
    rows = conn.execute(
        """
        SELECT player_id FROM qb_starters
        WHERE team = ? AND (season < ? OR (season = ? AND week < ?))
        ORDER BY season DESC, week DESC LIMIT ?
        """,
        (team, season, season, before_week, RECENT_N),
    ).fetchall()
    ids = {r["player_id"] for r in rows}
    if len(rows) < 2:
        return 1
    return 1 if len(ids) == 1 else 0


def qb_career_starts(conn, player_id: str, before_season: int, before_week: int) -> int:
    """How many games this QB (by nflverse player_id) has been the leading
    passer anywhere in qb_starters before this point — a career track
    record, not scoped to the current team, since a journeyman backup's
    thin resume follows the player, not whichever team currently employs
    him.

    This is the absolute-quality signal the depth-chart-based injury check
    elsewhere (backend/injuries.py) can't provide on its own: that check
    only fires when a team's OWN normal starter is listed out, so once an
    emergency QB has been formally slotted in as the new depth-chart
    starter (healthy, no injury tag), the team reads as fine even though
    the actual quality of who's under center hasn't changed. History says
    a QB with almost no starting experience is a real drag on a team's
    chances regardless of anything else about the matchup — this makes
    that checkable independent of whose "normal" starter he is or isn't.
    """
    if not player_id:
        return 0
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM qb_starters WHERE player_id = ? AND (season < ? OR (season = ? AND week < ?))",
        (player_id, before_season, before_season, before_week),
    ).fetchone()
    return row["n"] if row else 0


def qb_experience_for_game(conn, team: str, season: int, week: int) -> float:
    """Training-only feature: log-scaled prior career starts of whoever
    actually started this specific game — ground truth from qb_starters,
    the same "who really took the snaps" data qb_stability() uses (that's
    legitimate pregame-knowable info, not outcome leakage: who starts is
    announced well before kickoff and essentially never wrong barring an
    in-game injury). Capped at 40 starts before the log so a long-tenured
    starter doesn't dominate the scale; 0.0 if there's no recorded starter
    for this team/week."""
    row = conn.execute(
        "SELECT player_id FROM qb_starters WHERE team = ? AND season = ? AND week = ?",
        (team, season, week),
    ).fetchone()
    if not row or not row["player_id"]:
        return 0.0
    starts = qb_career_starts(conn, row["player_id"], season, week)
    return math.log1p(min(starts, 40))


def resolve_qb_player_id_by_name(conn, player_name: str) -> str | None:
    """Best-effort match from a depth-chart player name (ESPN, scraped live
    for the current week) to the nflverse player_id qb_starters is keyed by
    — the two sources don't share an id scheme (see roster_continuity.py /
    team_efficiency.py for the same problem elsewhere in this codebase), so
    this falls back to a normalized name compare against qb_starters'
    (small, league-wide) distinct-name list. Only needed for the live
    signal; training features use qb_starters' own player_id directly, no
    matching required. Returns None on no match — callers should treat that
    as "couldn't confidently identify this player" and skip the signal
    rather than guess, since a false non-match would otherwise wrongly
    treat an established starter as a total unknown."""
    if not player_name:
        return None
    target = _normalize_name(player_name)
    rows = conn.execute("SELECT DISTINCT player_id, player_name FROM qb_starters").fetchall()
    for r in rows:
        if _normalize_name(r["player_name"]) == target:
            return r["player_id"]
    return None


def recent_injury_load(conn, team: str, season: int, before_week: int):
    rows = conn.execute(
        """
        SELECT impact_out_count, qb_listed_out FROM historical_injury_counts
        WHERE team = ? AND (season < ? OR (season = ? AND week < ?))
        ORDER BY season DESC, week DESC LIMIT ?
        """,
        (team, season, season, before_week, RECENT_N),
    ).fetchall()
    if not rows:
        return None
    avg_out = sum(r["impact_out_count"] for r in rows) / len(rows)
    any_qb_out = max(r["qb_listed_out"] for r in rows)
    return {"avg_impact_out": round(avg_out, 2), "recent_qb_out": any_qb_out}


def refresh_qb_baselines(conn, season: int):
    """Persist each team's baseline ("original") starting QB so a
    season-ending injury is remembered after the backup has started enough
    games to look like the usual starter. A baseline only changes when the
    baseline QB is healthy but benched or gone — never while the depth chart
    lists him out. Initialized from the QB with the most starts over the last 10 games
    (spanning the season boundary, so a starter who got hurt early this
    season is still recognized), preferring a QB with 2+ of those starts
    who is currently out."""
    from datetime import datetime, timezone

    from backend.injuries import OUT_ABBRS

    now = datetime.now(timezone.utc).isoformat()
    teams = [r["team"] for r in conn.execute("SELECT DISTINCT team FROM qb_starters WHERE season = ?", (season,)).fetchall()]
    for team in teams:
        starts = conn.execute(
            """SELECT season, week, player_name FROM qb_starters
               WHERE team = ? AND season >= ? ORDER BY season DESC, week DESC LIMIT 10""",
            (team, season - 1),
        ).fetchall()[::-1]
        if not starts or starts[-1]["season"] != season:
            continue
        counts: dict = {}
        names: dict = {}
        for r in starts:
            k = _normalize_name(r["player_name"])
            counts[k] = counts.get(k, 0) + 1
            names[k] = r["player_name"]
        out_keys = {
            _normalize_name(r["player_name"])
            for r in conn.execute(
                "SELECT player_name, injury_status FROM depth_chart WHERE team = ? AND position = 'QB'", (team,)
            ).fetchall()
            if r["injury_status"] in OUT_ABBRS
        }
        current = conn.execute("SELECT player_name FROM qb_baseline WHERE team = ?", (team,)).fetchone()
        current_key = _normalize_name(current["player_name"]) if current else None

        if current_key is None:
            injured = [k for k in counts if counts[k] >= 2 and k in out_keys]
            pool = injured or list(counts)
            new_key = max(pool, key=lambda k: counts[k])
        else:
            last_two = [_normalize_name(r["player_name"]) for r in starts[-2:]]
            new_key = current_key
            if len(last_two) == 2 and last_two[0] == last_two[1] and last_two[0] != current_key and current_key not in out_keys:
                new_key = last_two[0]
        if new_key != current_key:
            conn.execute(
                """INSERT INTO qb_baseline (team, season, player_name, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT (team) DO UPDATE SET season = excluded.season, player_name = excluded.player_name,
                   updated_at = excluded.updated_at""",
                (team, season, names[new_key], now),
            )


def qb_starter_lost(conn, team: str, season: int, week: int, qb_info: dict):
    """The team's baseline starter (qb_baseline, falling back to the
    leading passer of the last 3 games) when the live depth chart shows him
    out — even after ESPN has promoted a healthy backup to QB1, which makes
    the depth-chart-only check in backend/injuries.py go quiet. Returns
    {"established", "status", "replacement"} or None."""
    from backend.injuries import OUT_ABBRS

    row = conn.execute("SELECT player_name FROM qb_baseline WHERE team = ?", (team,)).fetchone()
    if row:
        established_key = _normalize_name(row["player_name"])
    else:
        rows = conn.execute(
            """
            SELECT player_name FROM qb_starters
            WHERE team = ? AND (season < ? OR (season = ? AND week < ?))
            ORDER BY season DESC, week DESC LIMIT ?
            """,
            (team, season, season, week, 3),
        ).fetchall()
        if len(rows) < 2:
            return None
        counts: dict = {}
        for r in rows:
            key = _normalize_name(r["player_name"])
            counts[key] = counts.get(key, 0) + 1
        established_key, n = max(counts.items(), key=lambda kv: kv[1])
        if n < 2:
            return None

    likely = qb_info.get("likely_starter")
    if not likely or _normalize_name(likely["player_name"]) == established_key:
        return None
    for p in qb_info.get("depth", []):
        if _normalize_name(p["player_name"]) == established_key and p["injury_status"] in OUT_ABBRS:
            return {"established": p["player_name"], "status": p["injury_status"], "replacement": likely["player_name"]}
    return None
