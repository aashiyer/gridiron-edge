"""Shared feature extraction for the trained regression models (ATS and
Over/Under) — reuses the same signal functions the live heuristic ("Edge"
panel) is built on, so each model trains on exactly what the app already
computes, evaluated as of just before each historical game's kickoff (no
leakage).
"""
from backend.analysis import (
    _team_form,
    _continuity_weighted_form,
    _head_to_head,
    _team_total_form,
    _head_to_head_totals,
)
from backend.team_efficiency import recent_efficiency_form
from backend.power_ranking import gei_for_game
from backend.historical_injury_signal import qb_stability, recent_injury_load, qb_experience_for_game

FEATURE_NAMES = [
    "ats_pct_diff",
    "su_pct_diff",
    "margin_diff",
    "streak_diff",
    "home_split_ats_pct",
    "away_split_ats_pct",
    "continuity_ats_diff",
    "continuity_margin_diff",
    "h2h_home_cover_pct",
    "rest_diff",
    "div_game",
    "closing_spread",
    "epa_net_diff",
    "turnover_margin_diff",
    "gei_diff",
    "cpoe_diff",
    "separation_diff",
    "rush_yoe_diff",
    "qb_experience_diff",
    "third_down_pct_diff",
    "red_zone_td_pct_diff",
]


def _signed_streak(form: dict) -> float:
    if not form["streak_kind"] or form["streak_len"] < 2:
        return 0.0
    return form["streak_len"] if form["streak_kind"] == "W" else -form["streak_len"]


def extract_features(conn, game) -> dict:
    home, away = game["home_team"], game["away_team"]
    kickoff = game["kickoff_time"] or "9999"
    season = game["season"]

    home_form = _team_form(conn, home, kickoff)
    away_form = _team_form(conn, away, kickoff)
    home_split = _team_form(conn, home, kickoff, home_only=True)
    away_split = _team_form(conn, away, kickoff, away_only=True)
    home_cont = _continuity_weighted_form(conn, home, season, kickoff)
    away_cont = _continuity_weighted_form(conn, away, season, kickoff)
    h2h = _head_to_head(conn, home, away, kickoff)

    home_rest, away_rest = game["home_rest"], game["away_rest"]
    rest_diff = 0
    if home_rest is not None and away_rest is not None and home_rest <= 20 and away_rest <= 20:
        rest_diff = home_rest - away_rest

    closing_spread = game["home_spread_close"]
    if closing_spread is None:
        latest = conn.execute(
            "SELECT home_spread FROM odds_snapshots WHERE game_id = ? AND captured_at <= COALESCE((SELECT kickoff_time FROM games WHERE game_id = odds_snapshots.game_id), '9999') ORDER BY captured_at DESC LIMIT 1",
            (game["game_id"],),
        ).fetchone()
        closing_spread = (latest["home_spread"] if latest else None) or 0.0

    home_eff = recent_efficiency_form(conn, home, season, game["week"])
    away_eff = recent_efficiency_form(conn, away, season, game["week"])
    home_gei_rating, away_gei_rating = gei_for_game(conn, home, away, season, game["week"])
    home_gei = home_gei_rating["gei"] if home_gei_rating else None
    away_gei = away_gei_rating["gei"] if away_gei_rating else None

    epa_net_diff = 0.0
    turnover_margin_diff = 0.0
    cpoe_diff = 0.0
    separation_diff = 0.0
    rush_yoe_diff = 0.0
    third_down_pct_diff = 0.0
    red_zone_td_pct_diff = 0.0
    if home_eff and away_eff:
        if home_eff["off_epa_play"] is not None and away_eff["off_epa_play"] is not None:
            home_net = home_eff["off_epa_play"] - (home_eff["def_epa_play"] or 0)
            away_net = away_eff["off_epa_play"] - (away_eff["def_epa_play"] or 0)
            epa_net_diff = home_net - away_net
        if home_eff["turnover_margin"] is not None and away_eff["turnover_margin"] is not None:
            turnover_margin_diff = home_eff["turnover_margin"] - away_eff["turnover_margin"]
        if home_eff["cpoe"] is not None and away_eff["cpoe"] is not None:
            cpoe_diff = home_eff["cpoe"] - away_eff["cpoe"]
        if home_eff["avg_separation"] is not None and away_eff["avg_separation"] is not None:
            separation_diff = home_eff["avg_separation"] - away_eff["avg_separation"]
        if home_eff["rush_yards_over_expected_per_att"] is not None and away_eff["rush_yards_over_expected_per_att"] is not None:
            rush_yoe_diff = home_eff["rush_yards_over_expected_per_att"] - away_eff["rush_yards_over_expected_per_att"]
        if home_eff["third_down_pct"] is not None and away_eff["third_down_pct"] is not None:
            third_down_pct_diff = home_eff["third_down_pct"] - away_eff["third_down_pct"]
        if home_eff["red_zone_td_pct"] is not None and away_eff["red_zone_td_pct"] is not None:
            red_zone_td_pct_diff = home_eff["red_zone_td_pct"] - away_eff["red_zone_td_pct"]

    gei_diff = (home_gei - away_gei) if (home_gei is not None and away_gei is not None) else 0.0

    qb_stability_diff = qb_stability(conn, home, season, game["week"]) - qb_stability(conn, away, season, game["week"])
    qb_experience_diff = qb_experience_for_game(conn, home, season, game["week"]) - qb_experience_for_game(
        conn, away, season, game["week"]
    )
    home_inj = recent_injury_load(conn, home, season, game["week"])
    away_inj = recent_injury_load(conn, away, season, game["week"])
    injury_load_diff = 0.0
    if home_inj and away_inj:
        injury_load_diff = away_inj["avg_impact_out"] - home_inj["avg_impact_out"]

    return {
        "ats_pct_diff": (home_form["ats_pct"] or 50.0) - (away_form["ats_pct"] or 50.0),
        "su_pct_diff": (home_form["su_pct"] or 50.0) - (away_form["su_pct"] or 50.0),
        "margin_diff": (home_form["avg_margin"] or 0.0) - (away_form["avg_margin"] or 0.0),
        "streak_diff": _signed_streak(home_form) - _signed_streak(away_form),
        "home_split_ats_pct": home_split["ats_pct"] or 50.0,
        "away_split_ats_pct": away_split["ats_pct"] or 50.0,
        "continuity_ats_diff": ((home_cont or {}).get("ats_pct") or 50.0) - ((away_cont or {}).get("ats_pct") or 50.0),
        "continuity_margin_diff": ((home_cont or {}).get("avg_margin") or 0.0) - ((away_cont or {}).get("avg_margin") or 0.0),
        "h2h_home_cover_pct": (h2h["home_covers"] / h2h["decided"] * 100) if h2h["decided"] >= 2 else 50.0,
        "rest_diff": rest_diff,
        "div_game": game["div_game"] or 0,
        "closing_spread": closing_spread,
        "epa_net_diff": epa_net_diff,
        "turnover_margin_diff": turnover_margin_diff,
        "gei_diff": gei_diff,
        "cpoe_diff": cpoe_diff,
        "separation_diff": separation_diff,
        "rush_yoe_diff": rush_yoe_diff,
        "qb_experience_diff": qb_experience_diff,
        "third_down_pct_diff": third_down_pct_diff,
        "red_zone_td_pct_diff": red_zone_td_pct_diff,
        "qb_stability_diff": qb_stability_diff,
        "injury_load_diff": injury_load_diff,
    }


def ats_label(game) -> int | None:
    """1 if home covered, 0 if not, None if push (excluded from training)."""
    line = game["home_spread_close"]
    if line is None or game["final_home_score"] is None:
        return None
    margin = (game["final_home_score"] - game["final_away_score"]) + line
    if margin > 0:
        return 1
    if margin < 0:
        return 0
    return None


TOTAL_FEATURE_NAMES = [
    "home_over_pct",
    "away_over_pct",
    "expected_total_gap",
    "combined_off_epa",
    "combined_def_epa_allowed",
    "cpoe_sum",
    "h2h_over_pct",
    "div_game",
    "closing_total",
    "temp",
    "wind",
    "dome",
]


def extract_total_features(conn, game) -> dict:
    home, away = game["home_team"], game["away_team"]
    kickoff = game["kickoff_time"] or "9999"
    season = game["season"]

    home_total = _team_total_form(conn, home, kickoff)
    away_total = _team_total_form(conn, away, kickoff)
    h2h_totals = _head_to_head_totals(conn, home, away, kickoff)

    closing_total = game["total_close"]
    if closing_total is None:
        latest = conn.execute(
            "SELECT total FROM odds_snapshots WHERE game_id = ? AND captured_at <= COALESCE((SELECT kickoff_time FROM games WHERE game_id = odds_snapshots.game_id), '9999') ORDER BY captured_at DESC LIMIT 1",
            (game["game_id"],),
        ).fetchone()
        closing_total = (latest["total"] if latest else None) or 44.0

    expected_total_gap = 0.0
    if home_total["avg_combined"] is not None and away_total["avg_combined"] is not None:
        expected_total_gap = (home_total["avg_combined"] + away_total["avg_combined"]) / 2 - closing_total

    home_eff = recent_efficiency_form(conn, home, season, game["week"])
    away_eff = recent_efficiency_form(conn, away, season, game["week"])
    combined_off_epa = 0.0
    combined_def_epa_allowed = 0.0
    cpoe_sum = 0.0
    if home_eff and away_eff:
        if home_eff["off_epa_play"] is not None and away_eff["off_epa_play"] is not None:
            combined_off_epa = home_eff["off_epa_play"] + away_eff["off_epa_play"]
        if home_eff["def_epa_play"] is not None and away_eff["def_epa_play"] is not None:
            combined_def_epa_allowed = home_eff["def_epa_play"] + away_eff["def_epa_play"]
        if home_eff["cpoe"] is not None and away_eff["cpoe"] is not None:
            cpoe_sum = home_eff["cpoe"] + away_eff["cpoe"]

    return {
        "home_over_pct": home_total["over_pct"] if home_total["over_pct"] is not None else 50.0,
        "away_over_pct": away_total["over_pct"] if away_total["over_pct"] is not None else 50.0,
        "expected_total_gap": expected_total_gap,
        "combined_off_epa": combined_off_epa,
        "combined_def_epa_allowed": combined_def_epa_allowed,
        "cpoe_sum": cpoe_sum,
        "h2h_over_pct": (h2h_totals["overs"] / h2h_totals["decided"] * 100) if h2h_totals["decided"] >= 2 else 50.0,
        "div_game": game["div_game"] or 0,
        "closing_total": closing_total,
        "temp": game["temp"] if game["temp"] is not None else 60.0,
        "wind": game["wind"] if game["wind"] is not None else 0.0,
        "dome": 1 if game["roof"] == "dome" else 0,
    }


def total_label(game) -> int | None:
    """1 if the game went Over the closing total, 0 if Under, None if push
    (excluded from training)."""
    total = game["total_close"]
    if total is None or game["final_home_score"] is None:
        return None
    combined = game["final_home_score"] + game["final_away_score"]
    if combined > total:
        return 1
    if combined < total:
        return 0
    return None
