"""Player and team season stats for NFL and NBA, from ESPN's stats feeds.

Like the live module, nothing is stored: each feed is fetched, cut down to the
columns the app shows, and cached in memory for twenty minutes. A table is
therefore a few tens of KB however many people open it, and the database is
never touched.
"""
import csv
import io

import requests

from backend.database import db_session
from backend.live import PATHS, _cached, _fetch
from backend.teams import normalize_abbr

WEB = "https://site.web.api.espn.com/apis/common/v3/sports"
TTL = 1200

# ------------------------------------------------------------------ players
# (category, stat) pairs per view; labels and descriptions come from ESPN.
NBA_PLAYER_VIEWS = {
    "avg": ("Per game", "offensive.avgPoints", [
        ("general", "gamesPlayed"), ("general", "avgMinutes"), ("offensive", "avgPoints"), ("general", "avgRebounds"), ("offensive", "avgAssists"),
        ("defensive", "avgSteals"), ("defensive", "avgBlocks"), ("offensive", "avgTurnovers"), ("offensive", "fieldGoalPct"),
        ("offensive", "threePointFieldGoalPct"), ("offensive", "freeThrowPct"), ("offensive", "avgThreePointFieldGoalsMade"),
        ("offensive", "avgFieldGoalsAttempted"), ("general", "avgFouls")]),
    "advanced": ("Advanced", "advanced", []),
    "totals": ("Totals", "offensive.points", [
        ("general", "gamesPlayed"), ("general", "minutes"), ("offensive", "points"), ("general", "rebounds"), ("offensive", "assists"),
        ("defensive", "steals"), ("defensive", "blocks"), ("offensive", "turnovers"), ("offensive", "fieldGoalsMade"),
        ("offensive", "fieldGoalsAttempted"), ("offensive", "threePointFieldGoalsMade"), ("offensive", "freeThrowsMade"),
        ("general", "doubleDouble"), ("general", "tripleDouble")]),
}
NFL_PLAYER_VIEWS = {
    "passing": ("Passing", "passing.passingYards", [
        ("general", "gamesPlayed"), ("passing", "completions"), ("passing", "passingAttempts"), ("passing", "completionPct"), ("passing", "passingYards"),
        ("passing", "passingYardsPerGame"), ("passing", "yardsPerPassAttempt"), ("passing", "passingTouchdowns"), ("passing", "interceptions"),
        ("passing", "sacks"), ("passing", "QBRating"), ("passing", "QBR")]),
    "rushing": ("Rushing", "rushing.rushingYards", [
        ("general", "gamesPlayed"), ("rushing", "rushingAttempts"), ("rushing", "rushingYards"), ("rushing", "rushingYardsPerGame"),
        ("rushing", "yardsPerRushAttempt"), ("rushing", "rushingTouchdowns"), ("rushing", "longRushing"), ("rushing", "rushingFumbles"),
        ("rushing", "rushingFirstDowns")]),
    "receiving": ("Receiving", "receiving.receivingYards", [
        ("general", "gamesPlayed"), ("receiving", "receptions"), ("receiving", "receivingTargets"), ("receiving", "receivingYards"),
        ("receiving", "receivingYardsPerGame"), ("receiving", "yardsPerReception"), ("receiving", "receivingTouchdowns"), ("receiving", "longReception"),
        ("receiving", "receivingYardsAfterCatch"), ("receiving", "receivingFirstDowns")]),
    "defense": ("Defense", "defensive.totalTackles", [
        ("general", "gamesPlayed"), ("defensive", "totalTackles"), ("defensive", "soloTackles"), ("defensive", "assistTackles"), ("defensive", "sacks"),
        ("defensive", "tacklesForLoss"), ("defensive", "passesDefended"), ("defensiveinterceptions", "interceptions"),
        ("defensiveinterceptions", "interceptionYards"), ("defensiveinterceptions", "interceptionTouchdowns")]),
    "scoring": ("Scoring", "scoring.totalPoints", [
        ("general", "gamesPlayed"), ("scoring", "totalTouchdowns"), ("scoring", "rushingTouchdowns"), ("scoring", "receivingTouchdowns"),
        ("scoring", "returnTouchdowns"), ("scoring", "fieldGoals"), ("scoring", "kickExtraPoints"), ("scoring", "totalTwoPointConvs"),
        ("scoring", "totalPoints"), ("scoring", "totalPointsPerGame")]),
    "kicking": ("Kicking", "kicking.fieldGoalsMade", [
        ("general", "gamesPlayed"), ("kicking", "fieldGoalsMade"), ("kicking", "fieldGoalAttempts"), ("kicking", "fieldGoalPct"),
        ("kicking", "longFieldGoalMade"), ("kicking", "fieldGoalsMade40_49"), ("kicking", "fieldGoalsMade50"), ("kicking", "extraPointsMade"),
        ("kicking", "extraPointAttempts"), ("kicking", "extraPointPct")]),
    "punting": ("Punting", "punting.punts", [
        ("general", "gamesPlayed"), ("punting", "punts"), ("punting", "puntYards"), ("punting", "grossAvgPuntYards"), ("punting", "netAvgPuntYards"),
        ("punting", "longPunt"), ("punting", "puntsInside20"), ("punting", "puntsBlocked"), ("punting", "touchbacks")]),
    "returns": ("Returns", "returning.kickReturnYards", [
        ("general", "gamesPlayed"), ("returning", "kickReturns"), ("returning", "kickReturnYards"), ("returning", "yardsPerKickReturn"),
        ("returning", "kickReturnTouchdowns"), ("returning", "puntReturns"), ("returning", "puntReturnYards"), ("returning", "yardsPerPuntReturn"),
        ("returning", "puntReturnTouchdowns")]),
}
NFL_PLAYER_VIEWS.update({
    "adv_pass": ("Adv passing", "adv_pass", []),
    "adv_rush": ("Adv rushing", "adv_rush", []),
    "adv_rec": ("Adv receiving", "adv_rec", []),
})
PLAYER_VIEWS = {"nba": NBA_PLAYER_VIEWS, "nfl": NFL_PLAYER_VIEWS}

# Opposing teams only count a player once he has meaningful volume in the view's main stat.
LIMITS = {"nba": 600, "nfl": 250}


def _team_abbr(sport: str, abbr: str) -> str:
    return normalize_abbr(abbr) if sport == "nfl" else abbr


def season_options(sport: str) -> list:
    def go():
        d = _fetch(f"{WEB}/{PATHS[sport]}/statistics/byathlete", {"limit": 1, "page": 1, "sort": "general.gamesPlayed:desc", "seasontype": 2})
        cur = d["currentSeason"]["year"]
        out = []
        for y in (cur, cur - 1, cur - 2):
            label = f"{y - 1}-{str(y)[2:]}" if sport == "nba" else str(y)
            out.append({"year": y, "label": label})
        return {"current": cur, "seasons": out}

    return _cached(("stats-seasons", sport), 3600, go)


def _players_raw(sport: str, view: str, season: int, qualified: bool):
    label, sort_key, cols = PLAYER_VIEWS[sport][view]
    params = {"region": "us", "lang": "en", "contentorigin": "espn", "isqualified": str(qualified).lower(), "page": 1,
              "limit": LIMITS[sport], "sort": f"{sort_key}:desc", "season": season, "seasontype": 2}
    d = _fetch(f"{WEB}/{PATHS[sport]}/statistics/byathlete", params)
    names, labels, descs = {}, {}, {}
    for c in d.get("categories", []):
        for i, n in enumerate(c["names"]):
            key = (c["name"], n)
            if key not in names:
                names[key] = i
                labels[key] = c["labels"][i]
                descs[key] = (c.get("displayNames") or [""] * len(c["names"]))[i]
    columns = [{"key": f"{c}.{s}", "label": labels[(c, s)], "desc": descs[(c, s)]} for c, s in cols if (c, s) in names]
    usable = [(c, s) for c, s in cols if (c, s) in names]
    main_cat, main_stat = sort_key.split(".")
    rows = []
    for a in d.get("athletes", []):
        ath = a["athlete"]
        by_cat = {c["name"]: c["values"] for c in a.get("categories", [])}
        vals = []
        for c, s in usable:
            arr = by_cat.get(c)
            i = names[(c, s)]
            v = arr[i] if arr is not None and i < len(arr) else None
            vals.append(None if v is None else round(float(v), 2))
        main_idx = next((i for i, (c, s) in enumerate(usable) if (c, s) == (main_cat, main_stat)), None)
        if main_idx is not None and not vals[main_idx]:
            continue
        team = (ath.get("teams") or [{}])[0].get("abbreviation") or ath.get("teamShortName") or ""
        rows.append({
            "id": ath["id"], "name": ath.get("displayName"), "pos": (ath.get("position") or {}).get("abbreviation"),
            "team": _team_abbr(sport, team), "age": ath.get("age"), "headshot": (ath.get("headshot") or {}).get("href"), "v": vals,
        })
    return {"columns": columns, "rows": rows, "sort": sort_key, "count": (d.get("pagination") or {}).get("count")}


def players(sport: str, view: str, season: int | None, qualified: bool) -> dict:
    opts = season_options(sport)
    season = season or opts["current"]
    if view not in PLAYER_VIEWS[sport]:
        view = next(iter(PLAYER_VIEWS[sport]))

    def fetch(q):
        if view == "advanced":
            return _nba_advanced_players(season, q)
        if view.startswith("adv_"):
            return _nfl_advanced_players(season, view, q)
        return _players_raw(sport, view, season, q)

    def go():
        data = fetch(qualified)
        used = qualified
        if qualified and len(data["rows"]) < 12:
            data = fetch(False)
            used = False
        return {**data, "qualified": used}

    data = _cached(("players", sport, view, season, qualified), TTL, go)
    return {
        "sport": sport, "season": season, "seasons": opts["seasons"], "view": view,
        "views": [{"id": k, "label": v[0]} for k, v in PLAYER_VIEWS[sport].items()], "linkable": not view.startswith("adv_"), **data,
    }


# -------------------------------------------------------------------- teams
# (side, category, stat, label, description, lower_is_better)
NBA_TEAM_VIEWS = {
    "offense": ("Offense", [
        ("own", "offensive", "avgPoints", "PTS", "Points per game", False), ("own", "offensive", "fieldGoalPct", "FG%", "Field goal %", False),
        ("own", "offensive", "threePointFieldGoalPct", "3P%", "3-point %", False), ("own", "offensive", "freeThrowPct", "FT%", "Free throw %", False),
        ("own", "offensive", "avgThreePointFieldGoalsMade", "3PM", "3-pointers made per game", False), ("own", "offensive", "avgFieldGoalsAttempted", "FGA", "Field goal attempts per game", False),
        ("own", "offensive", "avgAssists", "AST", "Assists per game", False), ("own", "offensive", "avgOffensiveRebounds", "OREB", "Offensive rebounds per game", False),
        ("own", "offensive", "avgTurnovers", "TO", "Turnovers per game", True)]),
    "defense": ("Defense", [
        ("opp", "offensive", "avgPoints", "OPP PTS", "Points allowed per game", True), ("opp", "offensive", "fieldGoalPct", "OPP FG%", "Opponent field goal %", True),
        ("opp", "offensive", "threePointFieldGoalPct", "OPP 3P%", "Opponent 3-point %", True), ("opp", "offensive", "avgTurnovers", "FORCED TO", "Turnovers forced per game", False),
        ("own", "defensive", "avgSteals", "STL", "Steals per game", False), ("own", "defensive", "avgBlocks", "BLK", "Blocks per game", False),
        ("own", "defensive", "avgDefensiveRebounds", "DREB", "Defensive rebounds per game", False), ("own", "general", "avgRebounds", "REB", "Rebounds per game", False)]),
    "overall": ("Overall", [
        ("own", "general", "gamesPlayed", "GP", "Games played", False), ("own", "differential", "avgPointsDifferential", "PT DIFF", "Point differential per game", False),
        ("own", "differential", "avgReboundsDifferential", "REB DIFF", "Rebound differential", False), ("own", "differential", "avgAssistsDifferential", "AST DIFF", "Assist differential", False),
        ("own", "differential", "avgTurnoversDifferential", "TO DIFF", "Turnover differential (lower is better)", True),
        ("own", "differential", "fieldGoalPctDifferential", "FG% DIFF", "Field goal % differential", False),
        ("own", "differential", "threePointFieldGoalPctDifferential", "3P% DIFF", "3-point % differential", False),
        ("own", "general", "avgFouls", "PF", "Fouls per game", True)]),
}
NBA_TEAM_VIEWS["advanced"] = ("Advanced", [
    ("calc", "adv", "ortg", "ORTG", "Offensive rating (points per 100 possessions)", False, 1),
    ("calc", "adv", "drtg", "DRTG", "Defensive rating (points allowed per 100 possessions)", True, 1),
    ("calc", "adv", "net", "NET", "Net rating", False, 1),
    ("calc", "adv", "pace", "PACE", "Possessions per game", False, 1),
    ("calc", "adv", "efg", "EFG%", "Effective field goal %", False, 1),
    ("calc", "adv", "ts", "TS%", "True shooting %", False, 1),
    ("calc", "adv", "tov", "TOV%", "Turnover % (per possession)", True, 1),
    ("calc", "adv", "orb", "ORB%", "Offensive rebound %", False, 1),
    ("calc", "adv", "drb", "DRB%", "Defensive rebound %", False, 1),
    ("calc", "adv", "ftr", "FTR", "Free throw rate (FTA per 100 FGA)", False, 1),
    ("calc", "adv", "tpar", "3PAR", "3-point attempt rate", False, 1),
    ("calc", "adv", "opp_efg", "OPP EFG%", "Opponent effective field goal %", True, 1),
    ("calc", "adv", "opp_tov", "OPP TOV%", "Opponent turnover % (forced)", False, 1),
    ("calc", "adv", "opp_ftr", "OPP FTR", "Opponent free throw rate", True, 1),
])
NFL_TEAM_VIEWS = {
    "offense": ("Offense", [
        ("own", "passing", "totalPointsPerGame", "PTS/G", "Points per game", False), ("own", "passing", "yardsPerGame", "YDS/G", "Total yards per game", False),
        ("own", "passing", "netPassingYardsPerGame", "PASS/G", "Net passing yards per game", False), ("own", "rushing", "rushingYardsPerGame", "RUSH/G", "Rushing yards per game", False),
        ("own", "passing", "yardsPerPassAttempt", "Y/A", "Yards per pass attempt", False), ("own", "rushing", "yardsPerRushAttempt", "Y/C", "Yards per carry", False),
        ("own", "passing", "passingTouchdowns", "PASS TD", "Passing touchdowns", False), ("own", "rushing", "rushingTouchdowns", "RUSH TD", "Rushing touchdowns", False),
        ("own", "passing", "interceptions", "INT", "Interceptions thrown", True), ("own", "passing", "sacks", "SACKED", "Sacks taken", True),
        ("own", "miscellaneous", "thirdDownConvPct", "3RD%", "Third down conversion %", False)]),
    "defense": ("Defense", [
        ("opp", "passing", "totalPointsPerGame", "PA/G", "Points allowed per game", True), ("opp", "passing", "yardsPerGame", "YDS/G", "Total yards allowed per game", True),
        ("opp", "passing", "netPassingYardsPerGame", "PASS/G", "Net passing yards allowed per game", True), ("opp", "rushing", "rushingYardsPerGame", "RUSH/G", "Rushing yards allowed per game", True),
        ("opp", "passing", "QBRating", "OPP RTG", "Opposing passer rating", True), ("opp", "passing", "sacks", "SACKS", "Sacks", False),
        ("opp", "passing", "interceptions", "INT", "Interceptions", False), ("opp", "miscellaneous", "thirdDownConvPct", "3RD% ALLOWED", "Third down % allowed", True),
        ("own", "miscellaneous", "totalTakeaways", "TAKEAWAYS", "Takeaways", False)]),
    "overall": ("Overall", [
        ("own", "general", "gamesPlayed", "GP", "Games played", False), ("own", "miscellaneous", "turnOverDifferential", "TO DIFF", "Turnover differential", False),
        ("own", "miscellaneous", "totalGiveaways", "GIVE", "Giveaways", True), ("own", "miscellaneous", "totalPenalties", "PEN", "Penalties", True),
        ("own", "miscellaneous", "totalPenaltyYards", "PEN YDS", "Penalty yards", True), ("own", "miscellaneous", "firstDowns", "1ST DOWNS", "First downs", False),
        ("own", "kicking", "fieldGoalPct", "FG%", "Field goal %", False), ("own", "punting", "netAvgPuntYards", "NET PUNT", "Net punt average", False)]),
}
NFL_TEAM_VIEWS["advanced"] = ("Advanced", [
    ("calc", "adv", "off_epa", "OFF EPA", "Offensive EPA per play", False, 3),
    ("calc", "adv", "def_epa", "DEF EPA", "EPA per play allowed (lower is better)", True, 3),
    ("calc", "adv", "epa_pass", "PASS EPA", "Offensive EPA per play on passes", False, 3),
    ("calc", "adv", "epa_rush", "RUSH EPA", "Offensive EPA per play on runs", False, 3),
    ("calc", "adv", "off_sr", "OFF SR%", "Offensive success rate", False, 1),
    ("calc", "adv", "def_sr", "DEF SR%", "Success rate allowed", True, 1),
    ("calc", "adv", "pass_rate", "PASS%", "Pass rate", False, 1),
    ("calc", "adv", "third", "3RD%", "Third down conversion %", False, 1),
    ("calc", "adv", "third_def", "3RD% ALLOWED", "Third down % allowed", True, 1),
    ("calc", "adv", "rz", "RZ TD%", "Red zone touchdown %", False, 1),
    ("calc", "adv", "rz_def", "RZ TD% ALLOWED", "Red zone touchdown % allowed", True, 1),
    ("calc", "adv", "tm", "TO MARGIN", "Turnover margin", False, 0),
])
TEAM_VIEWS = {"nba": NBA_TEAM_VIEWS, "nfl": NFL_TEAM_VIEWS}


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _num(stats: dict, key: str):
    v = stats.get(key)
    return float(v) if v is not None else None


def _nba_team_calc(stats: dict) -> dict:
    """Possession-based advanced team numbers, worked out from ESPN's season totals."""
    g = lambda k: _num(stats, k)
    side = lambda p: {k: g(f"{p}.offensive.{k}") for k in
                      ("points", "fieldGoalsMade", "fieldGoalsAttempted", "threePointFieldGoalsMade", "threePointFieldGoalsAttempted",
                       "freeThrowsMade", "freeThrowsAttempted", "offensiveRebounds", "turnovers")}
    own, opp = side("own"), side("opp")
    if any(v is None for v in list(own.values()) + list(opp.values())):
        return {}
    gp = g("own.general.gamesPlayed") or 0
    own_dreb, opp_dreb = g("own.defensive.defensiveRebounds"), g("opp.defensive.defensiveRebounds")
    poss = lambda t: t["fieldGoalsAttempted"] - t["offensiveRebounds"] + t["turnovers"] + 0.44 * t["freeThrowsAttempted"]
    po, pp = poss(own), poss(opp)
    if not po or not pp or not gp:
        return {}
    pct = lambda a, b: 100 * a / b if b else None
    out = {
        "ortg": 100 * own["points"] / po, "drtg": 100 * opp["points"] / pp, "pace": (po + pp) / 2 / gp,
        "efg": pct(own["fieldGoalsMade"] + 0.5 * own["threePointFieldGoalsMade"], own["fieldGoalsAttempted"]),
        "ts": pct(own["points"], 2 * (own["fieldGoalsAttempted"] + 0.44 * own["freeThrowsAttempted"])),
        "tov": pct(own["turnovers"], po), "ftr": pct(own["freeThrowsAttempted"], own["fieldGoalsAttempted"]),
        "tpar": pct(own["threePointFieldGoalsAttempted"], own["fieldGoalsAttempted"]),
        "opp_efg": pct(opp["fieldGoalsMade"] + 0.5 * opp["threePointFieldGoalsMade"], opp["fieldGoalsAttempted"]),
        "opp_tov": pct(opp["turnovers"], pp), "opp_ftr": pct(opp["freeThrowsAttempted"], opp["fieldGoalsAttempted"]),
    }
    out["net"] = out["ortg"] - out["drtg"]
    if own_dreb is not None and opp_dreb is not None:
        out["orb"] = pct(own["offensiveRebounds"], own["offensiveRebounds"] + opp_dreb)
        out["drb"] = pct(own_dreb, own_dreb + opp["offensiveRebounds"])
    return {f"calc.adv.{k}": v for k, v in out.items() if v is not None}


def _nfl_team_calc(season: int) -> dict:
    """Team EPA, success and situational rates from the app's own team_stats table (nflverse play-by-play)."""
    try:
        with db_session() as conn:
            rows = conn.execute(
                """
                SELECT team,
                       SUM(COALESCE(off_epa_clean, off_epa_play) * plays_offense) / NULLIF(SUM(plays_offense), 0) AS off_epa,
                       AVG(COALESCE(def_epa_clean, def_epa_play)) AS def_epa,
                       SUM(COALESCE(off_success_clean, off_success_rate) * plays_offense) / NULLIF(SUM(plays_offense), 0) AS off_sr,
                       AVG(COALESCE(def_success_clean, def_success_rate)) AS def_sr,
                       SUM(off_epa_pass * plays_offense) / NULLIF(SUM(plays_offense), 0) AS epa_pass,
                       SUM(off_epa_rush * plays_offense) / NULLIF(SUM(plays_offense), 0) AS epa_rush,
                       AVG(pass_rate) AS pass_rate, AVG(third_down_pct) AS third, AVG(third_down_pct_def) AS third_def,
                       AVG(red_zone_td_pct) AS rz, AVG(red_zone_td_pct_def) AS rz_def, SUM(turnover_margin) AS tm
                FROM team_stats WHERE season = ? GROUP BY team
                """,
                (season,),
            ).fetchall()
    except Exception:
        return {}
    out = {}
    for r in rows:
        scale = lambda v: None if v is None else (v * 100 if abs(v) <= 1.0 else v)
        vals = {"off_epa": r["off_epa"], "def_epa": r["def_epa"], "epa_pass": r["epa_pass"], "epa_rush": r["epa_rush"], "tm": r["tm"],
                "off_sr": scale(r["off_sr"]), "def_sr": scale(r["def_sr"]), "pass_rate": scale(r["pass_rate"]), "third": scale(r["third"]),
                "third_def": scale(r["third_def"]), "rz": scale(r["rz"]), "rz_def": scale(r["rz_def"])}
        out[_team_abbr("nfl", r["team"])] = {f"calc.adv.{k}": float(v) for k, v in vals.items() if v is not None}
    return out


def _teams_raw(sport: str, season: int):
    def go():
        d = _fetch(f"{WEB}/{PATHS[sport]}/statistics/byteam", {"region": "us", "lang": "en", "contentorigin": "espn", "season": season, "seasontype": 2})
        names_by_cat: dict = {}
        for c in d.get("categories", []):
            if c.get("names") and c["name"] not in names_by_cat:
                names_by_cat[c["name"]] = c["names"]
        nfl_calc = _nfl_team_calc(season) if sport == "nfl" else {}
        out_teams = []
        for t in d.get("teams", []):
            stats: dict = {}
            for c in t.get("categories", []):
                names = names_by_cat.get(c["name"], [])
                side = "opp" if str(c.get("displayName", "")).startswith("Opponent") else "own"
                for n, v in zip(names, c.get("values", [])):
                    stats.setdefault(f"{side}.{c['name']}.{n}", v)
            team = t["team"]
            abbr = _team_abbr(sport, team["abbreviation"])
            stats.update(_nba_team_calc(stats) if sport == "nba" else nfl_calc.get(abbr, {}))
            out_teams.append({"abbr": abbr, "name": team.get("displayName"),
                              "logo": next((l["href"] for l in team.get("logos", []) if "default" in l.get("rel", [])), None), "stats": stats})
        return out_teams

    return _cached(("teams-raw", sport, season), TTL, go)


def teams(sport: str, season: int | None) -> dict:
    opts = season_options(sport)
    season = season or opts["current"]
    out_teams = _teams_raw(sport, season)

    def build():
        views = []
        for vid, (vlabel, specs) in TEAM_VIEWS[sport].items():
            cols = []
            for spec in specs:
                sd, c, n, lab, desc, lower = spec[:6]
                col = {"key": f"{sd}.{c}.{n}", "label": lab, "desc": desc, "lower": lower}
                if len(spec) > 6:
                    col["dec"] = spec[6]
                cols.append(col)
            cols = [c for c in cols if any(c["key"] in t["stats"] for t in out_teams)]
            for col in cols:
                ranked = sorted((t for t in out_teams if col["key"] in t["stats"]), key=lambda t: t["stats"][col["key"]], reverse=not col["lower"])
                col["ranks"] = {t["abbr"]: i + 1 for i, t in enumerate(ranked)}
            if cols:
                views.append({"id": vid, "label": vlabel, "columns": cols})
        keys = {c["key"] for v in views for c in v["columns"]}
        rows = [{"abbr": t["abbr"], "name": t["name"], "logo": t["logo"], "v": {k: round(float(t["stats"][k]), 3) for k in keys if k in t["stats"]}} for t in out_teams]
        return {"views": views, "teams": rows}

    data = _cached(("teams", sport, season), TTL, build)
    return {"sport": sport, "season": season, "seasons": opts["seasons"], **data}


# ------------------------------------------------------------------- player
def player(sport: str, athlete_id: str) -> dict:
    def go():
        gl = _fetch(f"{WEB}/{PATHS[sport]}/athletes/{athlete_id}/gamelog", {})
        ov = _fetch(f"{WEB}/{PATHS[sport]}/athletes/{athlete_id}/overview", {})
        bio = _fetch(f"{WEB}/{PATHS[sport]}/athletes/{athlete_id}", {}).get("athlete", {})
        labels = gl.get("labels", [])
        cat_spans = []
        pos = 0
        for c in gl.get("categories", []):
            n = c.get("count", 0)
            cat_spans.append({"name": c.get("displayName") or c.get("name"), "start": pos, "end": pos + n})
            pos += n
        events = gl.get("events", {})
        games = []
        for st in gl.get("seasonTypes", [])[:1]:
            for cat in st.get("categories", []):
                for e in cat.get("events", []):
                    meta = events.get(e["eventId"], {})
                    games.append({
                        "id": e["eventId"], "date": (meta.get("gameDate") or "")[:10], "week": meta.get("week"), "home": meta.get("atVs") != "@",
                        "opp": _team_abbr(sport, (meta.get("opponent") or {}).get("abbreviation", "")), "result": meta.get("gameResult"),
                        "score": meta.get("score"), "stats": e.get("stats", []),
                    })
        games.sort(key=lambda g: g["date"], reverse=True)
        s = ov.get("statistics") or {}
        splits = [{"label": sp.get("displayName"), "stats": sp.get("stats", [])} for sp in s.get("splits", [])]
        team = bio.get("team") or {}
        profile = {
            "name": bio.get("displayName"), "team": _team_abbr(sport, team.get("abbreviation", "")) if team else None, "team_name": team.get("displayName"),
            "pos": (bio.get("position") or {}).get("abbreviation"), "jersey": bio.get("displayJersey"), "age": bio.get("age"),
            "height": bio.get("displayHeight"), "weight": bio.get("displayWeight"), "experience": bio.get("displayExperience"),
            "draft": bio.get("displayDraft"), "birthplace": bio.get("displayBirthPlace"), "headshot": (bio.get("headshot") or {}).get("href"),
            "status": (bio.get("status") or {}).get("name"),
        }
        return {"profile": profile, "labels": labels, "groups": cat_spans, "games": games[:25], "summary": {"labels": s.get("labels", []), "descs": s.get("displayNames", []), "splits": splits}}

    data = _cached(("player", sport, athlete_id), TTL, go)
    return {"sport": sport, "id": athlete_id, **data}


# ------------------------------------------------------ advanced players: NBA
_NBA_ADV_RAW = [
    ("general", "gamesPlayed"), ("general", "minutes"), ("general", "rebounds"), ("offensive", "points"), ("offensive", "fieldGoalsMade"),
    ("offensive", "fieldGoalsAttempted"), ("offensive", "threePointFieldGoalsMade"), ("offensive", "threePointFieldGoalsAttempted"),
    ("offensive", "freeThrowsAttempted"), ("offensive", "assists"), ("offensive", "turnovers"), ("defensive", "steals"), ("defensive", "blocks"),
]
_NBA_ADV_COLS = [
    ("gp", "GP", "Games played", 0), ("mpg", "MPG", "Minutes per game", 1), ("ts", "TS%", "True shooting %", 1), ("efg", "EFG%", "Effective field goal %", 1),
    ("usg", "USG%", "Usage: share of team possessions used while on the floor", 1), ("ast", "AST%", "Assist %: share of teammates' baskets assisted", 1),
    ("trb", "TRB%", "Total rebound %", 1), ("stl", "STL%", "Steal %", 1), ("blk", "BLK%", "Block %", 1), ("tov", "TOV%", "Turnovers per 100 plays used", 1),
    ("ftr", "FTR", "Free throw attempts per 100 shots", 1), ("tpar", "3PAR", "3-point attempt rate", 1), ("pts36", "PTS/36", "Points per 36 minutes", 1),
    ("reb36", "REB/36", "Rebounds per 36 minutes", 1), ("ast36", "AST/36", "Assists per 36 minutes", 1),
]


def _nba_advanced_players(season: int, qualified: bool) -> dict:
    teams_raw = {t["abbr"]: t["stats"] for t in _teams_raw("nba", season)}
    params = {"region": "us", "lang": "en", "contentorigin": "espn", "isqualified": str(qualified).lower(), "page": 1, "limit": LIMITS["nba"],
              "sort": "offensive.points:desc", "season": season, "seasontype": 2}
    d = _fetch(f"{WEB}/{PATHS['nba']}/statistics/byathlete", params)
    idx: dict = {}
    for c in d.get("categories", []):
        for i, n in enumerate(c["names"]):
            idx.setdefault((c["name"], n), i)
    rows = []
    for a in d.get("athletes", []):
        ath = a["athlete"]
        by_cat = {c["name"]: c["values"] for c in a.get("categories", [])}
        raw = {}
        for c, s in _NBA_ADV_RAW:
            arr, i = by_cat.get(c), idx.get((c, s))
            raw[s] = float(arr[i]) if arr is not None and i is not None and i < len(arr) and arr[i] is not None else 0.0
        team = _team_abbr("nba", (ath.get("teams") or [{}])[0].get("abbreviation") or ath.get("teamShortName") or "")
        t = teams_raw.get(team)
        mins = raw["minutes"]
        if not t or mins < 50:
            continue
        g = lambda k: _num(t, k) or 0.0
        tgp = g("own.general.gamesPlayed")
        tmin = tgp * 240
        tfga, tfgm, tfta, ttov = g("own.offensive.fieldGoalsAttempted"), g("own.offensive.fieldGoalsMade"), g("own.offensive.freeThrowsAttempted"), g("own.offensive.turnovers")
        treb, oreb_t = g("own.general.rebounds"), g("opp.general.rebounds")
        opp_poss = g("opp.offensive.fieldGoalsAttempted") - g("opp.offensive.offensiveRebounds") + g("opp.offensive.turnovers") + 0.44 * g("opp.offensive.freeThrowsAttempted")
        opp_2pa = g("opp.offensive.fieldGoalsAttempted") - g("opp.offensive.threePointFieldGoalsAttempted")
        fga, fta, tov, pts = raw["fieldGoalsAttempted"], raw["freeThrowsAttempted"], raw["turnovers"], raw["points"]
        plays = fga + 0.44 * fta + tov
        scale = (tmin / 5) / mins if mins else 0
        den = lambda x: x if x else None
        calc = {
            "gp": raw["gamesPlayed"], "mpg": mins / raw["gamesPlayed"] if raw["gamesPlayed"] else None,
            "ts": 100 * pts / (2 * (fga + 0.44 * fta)) if fga + fta else None,
            "efg": 100 * (raw["fieldGoalsMade"] + 0.5 * raw["threePointFieldGoalsMade"]) / fga if fga else None,
            "usg": 100 * plays * scale / den(tfga + 0.44 * tfta + ttov) if den(tfga + 0.44 * tfta + ttov) else None,
            "ast": 100 * raw["assists"] / den(raw["minutes"] / (tmin / 5) * tfgm - raw["fieldGoalsMade"]) if den(raw["minutes"] / (tmin / 5) * tfgm - raw["fieldGoalsMade"]) else None,
            "trb": 100 * raw["rebounds"] * (tmin / 5) / (mins * (treb + oreb_t)) if treb + oreb_t else None,
            "stl": 100 * raw["steals"] * (tmin / 5) / (mins * opp_poss) if opp_poss else None,
            "blk": 100 * raw["blocks"] * (tmin / 5) / (mins * opp_2pa) if opp_2pa else None,
            "tov": 100 * tov / plays if plays else None, "ftr": 100 * fta / fga if fga else None,
            "tpar": 100 * raw["threePointFieldGoalsAttempted"] / fga if fga else None,
            "pts36": pts * 36 / mins, "reb36": raw["rebounds"] * 36 / mins, "ast36": raw["assists"] * 36 / mins,
        }
        rows.append({
            "id": ath["id"], "name": ath.get("displayName"), "pos": (ath.get("position") or {}).get("abbreviation"), "team": team,
            "age": ath.get("age"), "headshot": (ath.get("headshot") or {}).get("href"),
            "v": [None if calc[k] is None else round(calc[k], 3) for k, *_ in _NBA_ADV_COLS],
        })
    columns = [{"key": f"adv.{k}", "label": lab, "desc": desc, "dec": dec} for k, lab, desc, dec in _NBA_ADV_COLS]
    return {"columns": columns, "rows": rows, "sort": "adv.usg", "count": len(rows)}


# ------------------------------------------------------ advanced players: NFL
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _nflverse_season(season: int) -> list:
    """Season totals per player from nflverse weekly player stats (regular season only)."""
    def go():
        resp = requests.get(NFLVERSE.format(season=season), timeout=60)
        resp.raise_for_status()
        agg: dict = {}
        for row in csv.DictReader(io.StringIO(resp.content.decode("utf-8"))):
            if row.get("season_type") != "REG":
                continue
            a = agg.setdefault(row["player_id"], {"name": row["player_display_name"], "pos": row["position"], "headshot": row["headshot_url"],
                                                  "team": row["team"], "week": 0, "rows": 0, "weeks_pass": 0, "weeks_rush": 0, "weeks_rec": 0,
                                                  "sum": {}, "cpoe_w": 0.0, "share": {"target_share": 0.0, "air_yards_share": 0.0, "wopr": 0.0}})
            if int(row["week"]) >= a["week"]:
                a["week"], a["team"] = int(row["week"]), row["team"]
            a["rows"] += 1
            att, car, tgt = _f(row["attempts"]), _f(row["carries"]), _f(row["targets"])
            a["weeks_pass"] += att > 0
            a["weeks_rush"] += car > 0
            a["weeks_rec"] += tgt > 0
            for k in ("completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered", "sack_yards_lost",
                      "passing_air_yards", "passing_yards_after_catch", "passing_first_downs", "passing_epa", "carries", "rushing_yards", "rushing_tds",
                      "rushing_first_downs", "rushing_epa", "rushing_fumbles_lost", "receptions", "targets", "receiving_yards", "receiving_tds",
                      "receiving_air_yards", "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa"):
                a["sum"][k] = a["sum"].get(k, 0.0) + _f(row[k])
            a["cpoe_w"] += _f(row["passing_cpoe"]) * att
            if tgt > 0:
                for k in a["share"]:
                    a["share"][k] += _f(row[k])
        return list(agg.values())

    return _cached(("nflverse", season), 3 * 3600, go)


_NFL_ADV = {
    "adv_pass": ("passing_epa_total", [
        ("gp", "GP", "Games with a pass attempt", 0), ("att", "ATT", "Pass attempts", 0), ("epa", "EPA", "Total passing EPA", 1),
        ("epa_db", "EPA/DB", "EPA per dropback (attempts + sacks)", 3), ("cpoe", "CPOE", "Completion % over expected", 1),
        ("anya", "ANY/A", "Adjusted net yards per attempt", 2), ("ypa", "Y/A", "Yards per attempt", 1), ("adot", "AIR/ATT", "Air yards per attempt", 1),
        ("pacr", "PACR", "Passing yards per air yard", 2), ("sack", "SACK%", "Sack rate", 1), ("td", "TD%", "Touchdown rate", 1), ("int", "INT%", "Interception rate", 1)]),
    "adv_rush": ("rushing_epa_total", [
        ("gp", "GP", "Games with a carry", 0), ("car", "CAR", "Carries", 0), ("yds", "YDS", "Rushing yards", 0), ("ypc", "Y/C", "Yards per carry", 1),
        ("epa", "EPA", "Total rushing EPA", 1), ("epa_car", "EPA/CAR", "EPA per carry", 3), ("fd", "1D%", "First down rate", 1), ("td", "TD", "Rushing touchdowns", 0),
        ("ypg", "YDS/G", "Rushing yards per game", 1), ("fum", "FUM LOST", "Fumbles lost", 0)]),
    "adv_rec": ("receiving_epa_total", [
        ("gp", "GP", "Games with a target", 0), ("tgt", "TGT", "Targets", 0), ("rec", "REC", "Receptions", 0), ("yds", "YDS", "Receiving yards", 0),
        ("catch", "CATCH%", "Catch rate", 1), ("ypt", "Y/TGT", "Yards per target", 1), ("epa", "EPA", "Total receiving EPA", 1), ("epa_tgt", "EPA/TGT", "EPA per target", 3),
        ("tshare", "TGT%", "Average target share", 1), ("ayshare", "AY%", "Average air yards share", 1), ("wopr", "WOPR", "Weighted opportunity rating", 2),
        ("adot", "ADOT", "Average depth of target", 1), ("yac", "YAC/REC", "Yards after catch per reception", 1), ("racr", "RACR", "Receiving yards per air yard", 2)]),
}


def _nfl_advanced_players(season: int, view: str, qualified: bool) -> dict:
    sort_key, cols = _NFL_ADV[view]
    rows = []
    div = lambda a, b, scale=1.0: None if not b else scale * a / b
    for a in _nflverse_season(season):
        s = a["sum"]
        if view == "adv_pass":
            att, sk = s.get("attempts", 0), s.get("sacks_suffered", 0)
            if att <= 0 or (qualified and att < 10 * a["weeks_pass"]):
                continue
            db = att + sk
            vals = {"gp": a["weeks_pass"], "att": att, "epa": s["passing_epa"], "epa_db": div(s["passing_epa"], db), "cpoe": div(a["cpoe_w"], att),
                    "anya": div(s["passing_yards"] + 20 * s["passing_tds"] - 45 * s["passing_interceptions"] + s["sack_yards_lost"], db),
                    "ypa": div(s["passing_yards"], att), "adot": div(s["passing_air_yards"], att), "pacr": div(s["passing_yards"], s["passing_air_yards"]),
                    "sack": div(sk, db, 100), "td": div(s["passing_tds"], att, 100), "int": div(s["passing_interceptions"], att, 100)}
            main = s["passing_epa"]
        elif view == "adv_rush":
            car = s.get("carries", 0)
            if car <= 0 or (qualified and car < 5 * a["weeks_rush"]):
                continue
            vals = {"gp": a["weeks_rush"], "car": car, "yds": s["rushing_yards"], "ypc": div(s["rushing_yards"], car), "epa": s["rushing_epa"],
                    "epa_car": div(s["rushing_epa"], car), "fd": div(s["rushing_first_downs"], car, 100), "td": s["rushing_tds"],
                    "ypg": div(s["rushing_yards"], a["weeks_rush"]), "fum": s["rushing_fumbles_lost"]}
            main = s["rushing_epa"]
        else:
            tgt = s.get("targets", 0)
            if tgt <= 0 or (qualified and tgt < 3 * a["weeks_rec"]):
                continue
            n = a["weeks_rec"]
            vals = {"gp": n, "tgt": tgt, "rec": s["receptions"], "yds": s["receiving_yards"], "catch": div(s["receptions"], tgt, 100),
                    "ypt": div(s["receiving_yards"], tgt), "epa": s["receiving_epa"], "epa_tgt": div(s["receiving_epa"], tgt),
                    "tshare": div(a["share"]["target_share"], n, 100), "ayshare": div(a["share"]["air_yards_share"], n, 100),
                    "wopr": div(a["share"]["wopr"], n), "adot": div(s["receiving_air_yards"], tgt), "yac": div(s["receiving_yards_after_catch"], s["receptions"]),
                    "racr": div(s["receiving_yards"], s["receiving_air_yards"])}
            main = s["receiving_epa"]
        rows.append({"id": f"{a['name']}-{a['team']}", "name": a["name"], "pos": a["pos"], "team": _team_abbr("nfl", a["team"]), "age": None,
                     "headshot": a["headshot"], "_main": main,
                     "v": [None if vals[k] is None else round(float(vals[k]), 3) for k, *_ in cols]})
    rows.sort(key=lambda r: r["_main"], reverse=True)
    for r in rows:
        r.pop("_main")
    columns = [{"key": f"{view}.{k}", "label": lab, "desc": desc, "dec": dec} for k, lab, desc, dec in cols]
    return {"columns": columns, "rows": rows[:300], "sort": f"{view}.epa", "count": len(rows)}
