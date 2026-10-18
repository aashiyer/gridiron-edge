"""Team-level matchup cards for an NBA game view.

Everything is aggregated in SQL and returned as one small block per team, so
opening a game costs a few KB of egress no matter how deep into the season it
is, and the result is memoized so repeat views cost nothing.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from backend.ttl_cache import ttl_memo

EASTERN = ZoneInfo("America/New_York")

_RESULTS_SQL = """
SELECT team, COUNT(*) AS gp,
       SUM(CASE WHEN own > opp THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN own < opp THEN 1 ELSE 0 END) AS l,
       SUM(CASE WHEN is_home = 1 AND own > opp THEN 1 ELSE 0 END) AS home_w,
       SUM(CASE WHEN is_home = 1 AND own < opp THEN 1 ELSE 0 END) AS home_l,
       SUM(CASE WHEN is_home = 0 AND own > opp THEN 1 ELSE 0 END) AS away_w,
       SUM(CASE WHEN is_home = 0 AND own < opp THEN 1 ELSE 0 END) AS away_l,
       SUM(CASE WHEN cover_x > 0 THEN 1 ELSE 0 END) AS ats_w,
       SUM(CASE WHEN cover_x < 0 THEN 1 ELSE 0 END) AS ats_l,
       SUM(CASE WHEN total_x > 0 THEN 1 ELSE 0 END) AS overs,
       SUM(CASE WHEN total_x < 0 THEN 1 ELSE 0 END) AS unders
FROM (
    SELECT home_team AS team, 1 AS is_home, final_home_score AS own, final_away_score AS opp,
           (final_home_score - final_away_score + home_spread_close) AS cover_x,
           (final_home_score + final_away_score - total_close) AS total_x
    FROM games WHERE sport = 'nba' AND season = ? AND status = 'final' AND kickoff_time < ? AND home_team IN (?, ?)
    UNION ALL
    SELECT away_team AS team, 0 AS is_home, final_away_score AS own, final_home_score AS opp,
           (final_away_score - final_home_score - home_spread_close) AS cover_x,
           (final_home_score + final_away_score - total_close) AS total_x
    FROM games WHERE sport = 'nba' AND season = ? AND status = 'final' AND kickoff_time < ? AND away_team IN (?, ?)
) t GROUP BY team
"""

_BOX_SQL = """
SELECT n.team, COUNT(*) AS gp, SUM(n.pts) AS pts, SUM(n.opp_pts) AS opp_pts,
       SUM(n.fgm) AS fgm, SUM(n.fga) AS fga, SUM(n.tpm) AS tpm, SUM(n.tpa) AS tpa, SUM(n.ftm) AS ftm, SUM(n.fta) AS fta,
       SUM(n.reb) AS reb, SUM(n.oreb) AS oreb, SUM(n.ast) AS ast, SUM(n.stl) AS stl, SUM(n.blk) AS blk, SUM(n.tov) AS tov,
       SUM(n.paint) AS paint, SUM(n.fastbreak) AS fastbreak,
       SUM(o.fgm) AS o_fgm, SUM(o.fga) AS o_fga, SUM(o.tpm) AS o_tpm, SUM(o.fta) AS o_fta, SUM(o.oreb) AS o_oreb, SUM(o.tov) AS o_tov
FROM nba_team_games n
JOIN nba_team_games o ON o.game_id = n.game_id AND o.team = n.opp
JOIN games g ON g.game_id = n.game_id
WHERE n.team IN (?, ?) AND g.season = ? AND g.kickoff_time < ?
GROUP BY n.team
"""


def _ratio(a, b, scale=1.0, digits=1):
    if not b or a is None:
        return None
    return round(a / b * scale, digits)


def _poss(fga, oreb, tov, fta):
    return (fga or 0) - (oreb or 0) + (tov or 0) + 0.44 * (fta or 0)


def _box_block(r):
    gp = r["gp"]
    poss = _poss(r["fga"], r["oreb"], r["tov"], r["fta"])
    o_poss = _poss(r["o_fga"], r["o_oreb"], r["o_tov"], r["o_fta"])
    ortg = _ratio(r["pts"], poss, 100)
    drtg = _ratio(r["opp_pts"], o_poss, 100)
    return {
        "gp": gp,
        "ppg": _ratio(r["pts"], gp), "opp_ppg": _ratio(r["opp_pts"], gp),
        "net": _ratio((r["pts"] or 0) - (r["opp_pts"] or 0), gp),
        "ortg": ortg, "drtg": drtg,
        "net_rtg": round(ortg - drtg, 1) if ortg is not None and drtg is not None else None,
        "pace": _ratio(poss + o_poss, 2 * gp),
        "efg": _ratio((r["fgm"] or 0) + 0.5 * (r["tpm"] or 0), r["fga"], 100),
        "opp_efg": _ratio((r["o_fgm"] or 0) + 0.5 * (r["o_tpm"] or 0), r["o_fga"], 100),
        "fg_pct": _ratio(r["fgm"], r["fga"], 100), "tp_pct": _ratio(r["tpm"], r["tpa"], 100), "ft_pct": _ratio(r["ftm"], r["fta"], 100),
        "tpa": _ratio(r["tpa"], gp),
        "reb": _ratio(r["reb"], gp), "ast": _ratio(r["ast"], gp), "stl": _ratio(r["stl"], gp), "blk": _ratio(r["blk"], gp),
        "tov": _ratio(r["tov"], gp), "paint": _ratio(r["paint"], gp), "fastbreak": _ratio(r["fastbreak"], gp),
    }


def _eastern_day(iso):
    return datetime.strptime(iso, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc).astimezone(EASTERN).date()


def _recent(conn, team, season, before, this_day):
    rows = conn.execute(
        """SELECT home_team, away_team, kickoff_time, final_home_score AS hs, final_away_score AS aws, home_spread_close AS sp
           FROM games WHERE sport = 'nba' AND season = ? AND status = 'final' AND kickoff_time < ? AND (home_team = ? OR away_team = ?)
           ORDER BY kickoff_time DESC LIMIT 5""",
        (season, before, team, team),
    ).fetchall()
    last5 = []
    for r in rows:
        home = r["home_team"] == team
        own, opp = (r["hs"], r["aws"]) if home else (r["aws"], r["hs"])
        ats = None
        if r["sp"] is not None:
            x = own - opp + (r["sp"] if home else -r["sp"])
            ats = "W" if x > 0 else "L" if x < 0 else "P"
        last5.append({"opp": r["away_team"] if home else r["home_team"], "home": home, "result": "W" if own > opp else "L",
                      "score": f"{own}-{opp}", "ats": ats, "day": _eastern_day(r["kickoff_time"]).isoformat()})
    streak = None
    if last5:
        n = 0
        for g in last5:
            if g["result"] != last5[0]["result"]:
                break
            n += 1
        streak = f'{last5[0]["result"]}{n}'
    rest = None
    if rows:
        rest = max(0, (this_day - _eastern_day(rows[0]["kickoff_time"])).days - 1)
    return {"last5": last5, "streak": streak, "rest_days": rest}


@ttl_memo("nba_matchup", 600)
def nba_matchup(conn, game_id, season, kickoff, home, away):
    before = kickoff or "9999"
    this_day = _eastern_day(kickoff) if kickoff else datetime.now(EASTERN).date()
    teams = {home: {}, away: {}}
    for r in conn.execute(_RESULTS_SQL, (season, before, home, away, season, before, home, away)).fetchall():
        teams[r["team"]].update({
            "record": f'{r["w"]}-{r["l"]}', "home_record": f'{r["home_w"]}-{r["home_l"]}', "away_record": f'{r["away_w"]}-{r["away_l"]}',
            "ats": f'{r["ats_w"]}-{r["ats_l"]}', "ats_pct": _ratio(r["ats_w"], (r["ats_w"] or 0) + (r["ats_l"] or 0), 100, 0),
            "ou": f'{r["overs"]}-{r["unders"]}',
        })
    for r in conn.execute(_BOX_SQL, (home, away, season, before)).fetchall():
        teams[r["team"]]["stats"] = _box_block(r)
    for t in (home, away):
        teams[t].update(_recent(conn, t, season, before, this_day))
    h2h = conn.execute(
        """SELECT kickoff_time, home_team, away_team, final_home_score AS hs, final_away_score AS aws FROM games
           WHERE sport = 'nba' AND season = ? AND status = 'final' AND kickoff_time < ?
             AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?)) ORDER BY kickoff_time DESC LIMIT 4""",
        (season, before, home, away, away, home),
    ).fetchall()
    return {
        "home": teams[home], "away": teams[away],
        "h2h": [{"day": _eastern_day(r["kickoff_time"]).isoformat(), "home": r["home_team"], "away": r["away_team"], "home_score": r["hs"], "away_score": r["aws"]} for r in h2h],
    }
