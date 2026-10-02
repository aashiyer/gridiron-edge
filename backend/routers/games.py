import threading

from fastapi import APIRouter
from typing import Optional

from backend.database import db_session
from backend.teams import team_meta
from backend.analysis import cached_recommendation, cached_recommendations_batch

router = APIRouter(prefix="/api/games", tags=["games"])

_warming: set = set()
_warm_lock = threading.Lock()


def _warm_in_background(game_ids: list):
    """Fill cold recommendation cache entries off-request.

    Deliberately ONE thread working through them sequentially, not one per
    game: the whole reason picks got slow was ~16 recommendations computing
    at once and taking the connection pool with them. This holds at most one
    pooled connection at a time, so the other nine stay available for actual
    user requests no matter how many entries are cold. The precompute tick
    (ingestion/tick.py's `recs` job) normally keeps these warm anyway — this
    just covers a newly-added game before the next tick reaches it."""
    with _warm_lock:
        todo = [g for g in game_ids if g not in _warming]
        if not todo:
            return
        _warming.update(todo)

    def run():
        try:
            for game_id in todo:
                try:
                    cached_recommendation(game_id)
                except Exception as e:
                    print(f"background recommendation warm failed for {game_id}: {e}")
        finally:
            with _warm_lock:
                _warming.difference_update(todo)

    threading.Thread(target=run, daemon=True).start()


def _serialize_game(row) -> dict:
    d = {k.lower(): v for k, v in dict(row).items()}
    d["home"] = team_meta(d["home_team"])
    d["away"] = team_meta(d["away_team"])
    return d


@router.get("")
def list_games(season: Optional[int] = None, week: Optional[int] = None, team: Optional[str] = None):
    query = """
        SELECT g.*,
               CASE WHEN g.status = 'final' THEN g.home_spread_close ELSE latest.home_spread END AS current_spread,
               CASE WHEN g.status = 'final' THEN g.total_close ELSE latest.total END AS current_total,
               CASE WHEN g.status = 'final' THEN g.home_ml_close ELSE latest.home_ml END AS current_home_ml,
               CASE WHEN g.status = 'final' THEN g.away_ml_close ELSE latest.away_ml END AS current_away_ml,
               latest.captured_at AS odds_updated_at
        FROM games g
        LEFT JOIN (
            -- ORDER BY id as a tiebreaker on captured_at matters: a single
            -- poll can insert several provider rows sharing one timestamp
            -- (see ingestion/espn_odds.py's record_odds_snapshot), and
            -- without it this join fans a game out into one row per tied
            -- provider — permanently, for any game whose last-ever poll
            -- (e.g. the closing snapshot right as it goes final) had
            -- multiple providers report at once.
            SELECT * FROM (
                SELECT o.*, ROW_NUMBER() OVER (
                    PARTITION BY game_id ORDER BY captured_at DESC, id DESC
                ) AS rn
                FROM odds_snapshots o
            ) ranked WHERE rn = 1
        ) latest ON latest.game_id = g.game_id
        WHERE 1=1
    """
    params = []
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    if week is not None:
        query += " AND g.week = ?"
        params.append(week)
    if team is not None:
        query += " AND (g.home_team = ? OR g.away_team = ?)"
        params.extend([team.upper(), team.upper()])
    query += " ORDER BY g.kickoff_time ASC"

    with db_session() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_serialize_game(r) for r in rows]


@router.get("/recommendations")
def get_recommendations(season: int, week: int):
    """Every recommendation for one week, in a single request.

    The Picker page renders a card per game, and each card used to fetch its
    own recommendation — 16+ separate HTTP requests per page load, each one
    potentially running the full ~25-query model engine on a cache miss.
    That storm is what made picks unusable: it saturated both the browser's
    per-origin connection limit and the backend's connection pool, so a pick
    save fired during a page load queued behind all of it (measured: 71s).

    This serves whatever is cached immediately and never blocks on a cold
    entry — a missing recommendation comes back absent from the map and the
    UI just shows its loading state for that card until the precompute tick
    (ingestion/tick.py's `recs` job) fills it in. Being a few minutes late
    with an insight panel is fine; making someone wait to place a pick is
    not."""
    with db_session() as conn:
        rows = conn.execute(
            "SELECT game_id FROM games WHERE season = ? AND week = ?", (season, week)
        ).fetchall()

    game_ids = [r["game_id"] for r in rows]
    out = cached_recommendations_batch(game_ids)
    missing = [g for g in game_ids if g not in out]
    if missing:
        _warm_in_background(missing)
    return out


def _resolve_power_ranking_week(conn, season: int, week: Optional[int]) -> int:
    """`week` defaults to the latest week this season has any final game
    for (mirrors the frontend's own "current week" convention — the
    earliest week with a game still not final, or the last week once the
    whole season is final — but computed against what's actually in the
    games table rather than duplicating that logic client-side)."""
    if week is not None:
        return week
    row = conn.execute("SELECT MIN(week) AS w FROM games WHERE season = ? AND status != 'final'", (season,)).fetchone()
    if row and row["w"] is not None:
        return row["w"]
    row = conn.execute("SELECT MAX(week) AS w FROM games WHERE season = ?", (season,)).fetchone()
    return row["w"] if row and row["w"] is not None else 1


@router.get("/power-rankings")
def power_rankings(season: int, week: Optional[int] = None):
    """The full league table for the Gridiron Efficiency Index — see
    backend/power_ranking.py for the methodology."""
    from backend.power_ranking import gei_power_ranking

    with db_session() as conn:
        week = _resolve_power_ranking_week(conn, season, week)
        ratings = gei_power_ranking(conn, season, week)

    entries = [{"team": team, "gei": d["gei"], "rank": d["rank"]} for team, d in ratings.items()]
    entries.sort(key=lambda e: e["rank"])
    return {"season": season, "week": week, "entries": entries}


@router.get("/power-rankings/{team}")
def power_ranking_breakdown(team: str, season: int, week: Optional[int] = None):
    """Every input behind one team's GEI number — game-by-game composite
    margins and opponents' own ratings, the QB term, and the prior-season
    blend. The "why" for a single rank, not just the final float."""
    from backend.power_ranking import gei_breakdown
    from backend.teams import normalize_abbr

    with db_session() as conn:
        week = _resolve_power_ranking_week(conn, season, week)
        return gei_breakdown(conn, normalize_abbr(team), season, week)


@router.get("/{game_id}")
def get_game(game_id: str):
    with db_session() as conn:
        game = conn.execute("SELECT * FROM games WHERE game_id = ?", (game_id,)).fetchone()
        if not game:
            return {"error": "not found"}
        history = conn.execute(
            "SELECT * FROM odds_snapshots WHERE game_id = ? ORDER BY captured_at ASC", (game_id,)
        ).fetchall()
    result = _serialize_game(game)
    result["odds_history"] = [dict(h) for h in history]
    return result


@router.get("/{game_id}/recommendation")
def get_recommendation(game_id: str):
    return cached_recommendation(game_id)


def _depth_chart_for(conn, team: str) -> dict:
    """Full depth chart for one team, grouped by position -> ordered list of
    {depth_rank, player_name, injury_status}. Unlike injuries.py's
    qb_availability/starters_out (which only surface what's needed for the
    live scoring signal — QB1, and depth_rank==1 for everything else), this
    is every rostered slot at every depth, for an actual depth-chart view."""
    rows = conn.execute(
        "SELECT position, depth_rank, player_name, injury_status FROM depth_chart WHERE team = ? ORDER BY position, depth_rank",
        (team,),
    ).fetchall()
    out: dict = {}
    for r in rows:
        out.setdefault(r["position"], []).append(
            {"depth_rank": r["depth_rank"], "player_name": r["player_name"], "injury_status": r["injury_status"]}
        )
    return out


@router.get("/{game_id}/detail")
def get_game_detail(game_id: str):
    """Everything a single-game detail view needs in one request: the game
    itself, its full odds line movement, the same Edge recommendation the
    Picker cards show (cached — this never triggers its own ~25-query
    compute), and a full depth chart for both teams. Composed from data
    every other endpoint already assembles rather than recomputing any of
    it fresh."""
    with db_session() as conn:
        game = conn.execute("SELECT * FROM games WHERE game_id = ?", (game_id,)).fetchone()
        if not game:
            return {"error": "not found"}
        odds_history = conn.execute(
            "SELECT * FROM odds_snapshots WHERE game_id = ? ORDER BY captured_at ASC", (game_id,)
        ).fetchall()
        home_depth_chart = _depth_chart_for(conn, game["home_team"])
        away_depth_chart = _depth_chart_for(conn, game["away_team"])

    result = _serialize_game(game)
    result["odds_history"] = [dict(h) for h in odds_history]
    result["home_depth_chart"] = home_depth_chart
    result["away_depth_chart"] = away_depth_chart
    result["recommendation"] = cached_recommendation(game_id)
    return result


@router.get("/meta/seasons")
def list_seasons():
    with db_session() as conn:
        rows = conn.execute("SELECT DISTINCT season FROM games ORDER BY season DESC").fetchall()
    return [r["season"] for r in rows]
