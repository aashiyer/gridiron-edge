"""Player and team season stats for NFL and NBA, from ESPN's stats feeds.

Like the live module, nothing is stored: each feed is fetched, cut down to the
columns the app shows, and cached in memory for twenty minutes. A table is
therefore a few tens of KB however many people open it, and the database is
never touched.
"""
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

    def go():
        data = _players_raw(sport, view, season, qualified)
        used = qualified
        if qualified and len(data["rows"]) < 12:
            data = _players_raw(sport, view, season, False)
            used = False
        return {**data, "qualified": used}

    data = _cached(("players", sport, view, season, qualified), TTL, go)
    return {
        "sport": sport, "season": season, "seasons": opts["seasons"], "view": view,
        "views": [{"id": k, "label": v[0]} for k, v in PLAYER_VIEWS[sport].items()], **data,
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
TEAM_VIEWS = {"nba": NBA_TEAM_VIEWS, "nfl": NFL_TEAM_VIEWS}


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def teams(sport: str, season: int | None) -> dict:
    opts = season_options(sport)
    season = season or opts["current"]

    def go():
        d = _fetch(f"{WEB}/{PATHS[sport]}/statistics/byteam", {"region": "us", "lang": "en", "contentorigin": "espn", "season": season, "seasontype": 2})
        names_by_cat: dict = {}
        for c in d.get("categories", []):
            if c.get("names") and c["name"] not in names_by_cat:
                names_by_cat[c["name"]] = c["names"]
        out_teams = []
        for t in d.get("teams", []):
            stats: dict = {}
            for c in t.get("categories", []):
                names = names_by_cat.get(c["name"], [])
                side = "opp" if str(c.get("displayName", "")).startswith("Opponent") else "own"
                for n, v in zip(names, c.get("values", [])):
                    stats.setdefault(f"{side}.{c['name']}.{n}", v)
            team = t["team"]
            out_teams.append({"abbr": _team_abbr(sport, team["abbreviation"]), "name": team.get("displayName"),
                              "logo": next((l["href"] for l in team.get("logos", []) if "default" in l.get("rel", [])), None), "stats": stats})
        views = []
        for vid, (vlabel, specs) in TEAM_VIEWS[sport].items():
            cols = [{"key": f"{s}.{c}.{n}", "label": lab, "desc": desc, "lower": lower} for s, c, n, lab, desc, lower in specs]
            for col in cols:
                ranked = sorted((t for t in out_teams if col["key"] in t["stats"]), key=lambda t: t["stats"][col["key"]], reverse=not col["lower"])
                col["ranks"] = {t["abbr"]: i + 1 for i, t in enumerate(ranked)}
            views.append({"id": vid, "label": vlabel, "columns": cols})
        keys = {c["key"] for v in views for c in v["columns"]}
        rows = [{"abbr": t["abbr"], "name": t["name"], "logo": t["logo"], "v": {k: round(float(t["stats"][k]), 2) for k in keys if k in t["stats"]}} for t in out_teams]
        return {"views": views, "teams": rows}

    data = _cached(("teams", sport, season), TTL, go)
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
