"""The model's own track record, on every game it called (not just the ones
someone picked), plus how each person stacks up against it.

Each frozen recommendation is copied into one compact `model_calls` row when
it's frozen; everything here is computed from those rows, so the egress is a
few KB per game no matter how big the snapshots are. Grading uses the closing
line, same as picks.
"""
import json
from datetime import datetime, timezone

from backend.routers.records import WIN_UNITS, _eastern, _slot
from backend.ttl_cache import ttl_memo

MARKETS = ("su", "ats", "total")
ROLLING = 25
MIN_WEEK = 6


def store_model_call(conn, game_id: str, rec: dict):
    pred = rec.get("model_prediction") or {}
    conn.execute(
        """INSERT INTO model_calls (game_id, lean_su, conf_su, lean_ats, conf_ats, lean_total, conf_total, line, total_line,
                                    prob_home_covers, home_gei, away_gei, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id) DO UPDATE SET lean_su = excluded.lean_su, conf_su = excluded.conf_su, lean_ats = excluded.lean_ats,
               conf_ats = excluded.conf_ats, lean_total = excluded.lean_total, conf_total = excluded.conf_total, line = excluded.line,
               total_line = excluded.total_line, prob_home_covers = excluded.prob_home_covers, home_gei = excluded.home_gei,
               away_gei = excluded.away_gei, frozen_at = excluded.frozen_at""",
        (game_id, rec.get("lean_straight_up"), rec.get("confidence_straight_up"), rec.get("lean_ats"), rec.get("confidence_ats"),
         rec.get("lean_total"), rec.get("confidence_total"), rec.get("current_line"), rec.get("current_total"),
         pred.get("prob_home_covers"), (rec.get("home_gei") or {}).get("gei"), (rec.get("away_gei") or {}).get("gei"),
         datetime.now(timezone.utc).isoformat()),
    )


def backfill_model_calls(conn) -> int:
    rows = conn.execute(
        """SELECT s.game_id, s.payload FROM recommendation_snapshots s
           WHERE NOT EXISTS (SELECT 1 FROM model_calls m WHERE m.game_id = s.game_id)"""
    ).fetchall()
    n = 0
    for r in rows:
        try:
            store_model_call(conn, r["game_id"], json.loads(r["payload"]))
            n += 1
        except (ValueError, KeyError):
            continue
    return n


def _grade_side(margin_for_side):
    return "win" if margin_for_side > 0 else "loss" if margin_for_side < 0 else "push"


def _grade(row: dict) -> dict:
    """Result of each of the model's three calls for a final game."""
    out = {"su": None, "ats": None, "total": None}
    if row["status"] != "final" or row["fh"] is None or row["fa"] is None:
        return out
    margin = row["fh"] - row["fa"]
    if row["lean_su"]:
        side = margin if row["lean_su"] == row["home_team"] else -margin
        out["su"] = _grade_side(side)
    spread = row["sc"] if row["sc"] is not None else row["line"]
    if row["lean_ats"] and spread is not None:
        side = margin + spread if row["lean_ats"] == row["home_team"] else -margin - spread
        out["ats"] = _grade_side(side)
    total_line = row["tc"] if row["tc"] is not None else row["total_line"]
    if row["lean_total"] and total_line is not None:
        diff = row["fh"] + row["fa"] - total_line
        out["total"] = _grade_side(diff if row["lean_total"] == "over" else -diff)
    return out


def _rec(results) -> dict:
    results = [r for r in results if r]
    w, l, p = results.count("win"), results.count("loss"), results.count("push")
    return {"wins": w, "losses": l, "pushes": p, "win_pct": round(w / (w + l) * 100, 1) if w + l else None}


def _units(results) -> float:
    return round(sum(WIN_UNITS if r == "win" else -1.0 if r == "loss" else 0.0 for r in results if r), 2)


def _streaks(results):
    seq = [r for r in results if r in ("win", "loss")]
    cur, best_w, best_l, run, prev = None, 0, 0, 0, None
    for r in seq:
        run = run + 1 if r == prev else 1
        prev = r
        if r == "win":
            best_w = max(best_w, run)
        else:
            best_l = max(best_l, run)
    if seq:
        n = 0
        for r in reversed(seq):
            if r != seq[-1]:
                break
            n += 1
        cur = {"kind": "W" if seq[-1] == "win" else "L", "length": n}
    return {"current": cur, "longest_win": best_w, "longest_loss": best_l}


def _team_line(row: dict, team: str):
    spread = row["sc"] if row["sc"] is not None else row["line"]
    if spread is None:
        return None
    return spread if team == row["home_team"] else -spread


def _bucket_edges(values, n=4):
    s = sorted(values)
    return [s[int(len(s) * i / n)] for i in range(1, n)] if len(s) >= n * 3 else []


def _calibration(rows, market):
    conf_key = {"su": "conf_su", "ats": "conf_ats", "total": "conf_total"}[market]
    graded = [r for r in rows if r["res"][market] in ("win", "loss") and r[conf_key] is not None]
    edges = _bucket_edges([r[conf_key] for r in graded])
    if not edges:
        return []
    groups = [[] for _ in range(len(edges) + 1)]
    for r in graded:
        groups[sum(1 for e in edges if r[conf_key] >= e)].append(r)
    out = []
    for g in groups:
        if not g:
            continue
        lo, hi = min(r[conf_key] for r in g), max(r[conf_key] for r in g)
        out.append({"label": f"{lo:.0f}–{hi:.0f}", "n": len(g), "avg_conf": round(sum(r[conf_key] for r in g) / len(g), 1),
                    "record": _rec([r["res"][market] for r in g])})
    return out


def _splits(rows, market):
    def lean(r):
        return {"su": r["lean_su"], "ats": r["lean_ats"]}.get(market)

    def buckets(r):
        out = []
        team = lean(r)
        if market == "total":
            out.append(("Over or under", "Leaned over" if r["lean_total"] == "over" else "Leaned under"))
        elif team:
            line = _team_line(r, team)
            if line:
                out.append(("Favorite or underdog", "Favorites" if line < 0 else "Underdogs"))
            out.append(("Home or road", "Home team" if team == r["home_team"] else "Road team"))
        if r["div_game"] is not None:
            out.append(("Division games", "Division games" if r["div_game"] else "Non-division games"))
        slot = _slot(r["kickoff_time"])
        if slot:
            out.append(("Time slot", slot))
        w = r["week"]
        out.append(("Part of the season", "Early (wk 1-6)" if w <= 6 else "Middle (wk 7-12)" if w <= 12 else "Late (wk 13-18)" if w <= 18 else "Playoffs"))
        spread = r["sc"] if r["sc"] is not None else r["line"]
        if spread is not None:
            size = abs(spread)
            out.append(("Spread size", "Up to 3" if size <= 3 else "3.5 to 6.5" if size <= 6.5 else "7 to 9.5" if size <= 9.5 else "10 or more"))
        total = r["tc"] if r["tc"] is not None else r["total_line"]
        if total is not None:
            out.append(("Total size", "Under 41" if total < 41 else "41 to 45.5" if total <= 45.5 else "46 to 49.5" if total <= 49.5 else "50 or more"))
        if r["roof"]:
            if r["roof"] == "dome":
                out.append(("Conditions", "Dome"))
            elif r["wind"] is not None:
                out.append(("Conditions", "Windy (15+ mph)" if r["wind"] >= 15 else "Outdoors, calm"))
        if market != "total" and r["lean_su"] and r["lean_ats"]:
            out.append(("SU and ATS calls", "Same team" if r["lean_su"] == r["lean_ats"] else "Split call"))
        if market != "total":
            conf = r["conf_su"] if market == "su" else r["conf_ats"]
            if conf is not None:
                out.append(("Confidence", "High (top third)" if conf >= r["_hi"][market] else "Low (bottom third)" if conf <= r["_lo"][market] else "Medium"))
        return out

    grouped: dict = {}
    for r in rows:
        if r["res"][market] is None:
            continue
        for title, label in buckets(r):
            grouped.setdefault(title, {}).setdefault(label, []).append(r["res"][market])
    order = ["Over or under", "Favorite or underdog", "Home or road", "Confidence", "SU and ATS calls", "Division games", "Time slot",
             "Part of the season", "Spread size", "Total size", "Conditions"]
    return [{"title": t, "items": [{"label": l, "record": _rec(v)} for l, v in grouped[t].items()]} for t in order if t in grouped]


def _by_team(rows, market):
    out: dict = {}
    for r in rows:
        res = r["res"][market]
        if res is None:
            continue
        if market == "total":
            for t in (r["home_team"], r["away_team"]):
                out.setdefault(t, {"for": [], "against": []})["for"].append(res)
            continue
        team = r["lean_su"] if market == "su" else r["lean_ats"]
        opp = r["away_team"] if team == r["home_team"] else r["home_team"]
        out.setdefault(team, {"for": [], "against": []})["for"].append(res)
        out.setdefault(opp, {"for": [], "against": []})["against"].append(res)
    return {t: {"for": _rec(v["for"]), "against": _rec(v["against"])} for t, v in out.items()}


def _extremes(rows, market):
    key = {"su": "conf_su", "ats": "conf_ats", "total": "conf_total"}[market]
    graded = [r for r in rows if r["res"][market] in ("win", "loss") and r[key] is not None]

    def card(r):
        lean = {"su": r["lean_su"], "ats": r["lean_ats"], "total": r["lean_total"]}[market]
        return {"game_id": r["game_id"], "label": f'{r["away_team"]} @ {r["home_team"]}', "season": r["season"], "week": r["week"],
                "lean": lean, "confidence": round(r[key], 1), "result": r["res"][market], "score": f'{r["fa"]}-{r["fh"]}'}

    top = sorted(graded, key=lambda r: -r[key])
    return {"hits": [card(r) for r in top if r["res"][market] == "win"][:5], "misses": [card(r) for r in top if r["res"][market] == "loss"][:5]}


def _trend(rows, market):
    by_week: dict = {}
    for r in rows:
        if r["res"][market]:
            by_week.setdefault((r["season"], r["week"]), []).append(r["res"][market])
    points, units, diff, window = [], 0.0, 0, []
    for key in sorted(by_week):
        res = by_week[key]
        units += _units(res)
        diff += res.count("win") - res.count("loss")
        window = (window + [x for x in res if x in ("win", "loss")])[-ROLLING:]
        rolling = round(window.count("win") / len(window) * 100, 1) if len(window) >= 10 else None
        points.append({"season": key[0], "week": key[1], "label": f"{key[0]} W{key[1]}", "cumulative_units": round(units, 2),
                       "rolling_ats_pct": rolling, "su_wins_over_500": diff, "rolling_su_pct": rolling,
                       "ats": _rec(res), "straight_up": _rec(res)})
    return points


def _weeks(rows):
    by_week: dict = {}
    for r in rows:
        by_week.setdefault((r["season"], r["week"]), []).append(r)
    out = []
    for (s, w), rs in sorted(by_week.items()):
        out.append({"season": s, "week": w, "label": f"{s} W{w}", "games": len(rs),
                    **{m: _rec([r["res"][m] for r in rs]) for m in MARKETS}, "ats_units": _units([r["res"]["ats"] for r in rs]),
                    "complete": all(r["status"] == "final" for r in rs)})
    return out


def _week_marks(weeks, market):
    marks = []
    for w in weeks:
        rec = w[market]
        n = rec["wins"] + rec["losses"]
        if w["complete"] and n >= MIN_WEEK:
            marks.append({"label": w["label"], "wins": rec["wins"], "losses": rec["losses"], "pushes": rec["pushes"],
                          "win_pct": round(rec["wins"] / n * 100, 1)})
    best = max(marks, key=lambda m: (m["win_pct"], m["wins"]), default=None)
    worst = min(marks, key=lambda m: (m["win_pct"], -m["losses"]), default=None)
    return best, worst


def _baselines(rows):
    su, home, over, under = [], [], [], []
    for r in rows:
        if r["status"] != "final" or r["fh"] is None:
            continue
        spread = r["sc"] if r["sc"] is not None else r["line"]
        margin = r["fh"] - r["fa"]
        if spread is not None and spread != 0:
            fav_home = spread < 0
            su.append("win" if (margin > 0) == fav_home and margin != 0 else "loss" if margin != 0 else "push")
            home.append(_grade_side(margin + spread))
        total = r["tc"] if r["tc"] is not None else r["total_line"]
        if total is not None:
            diff = r["fh"] + r["fa"] - total
            over.append(_grade_side(diff))
            under.append(_grade_side(-diff))
    return {"always_favorite_su": _rec(su), "always_home_ats": _rec(home), "always_over": _rec(over), "always_under": _rec(under)}


@ttl_memo("model_report", 300)
def model_report(conn, user_id: int, season):
    query = """
        SELECT m.*, g.season, g.week, g.kickoff_time, g.home_team, g.away_team, g.final_home_score AS fh, g.final_away_score AS fa,
               g.status, g.home_spread_close AS sc, g.total_close AS tc, g.div_game, g.roof, g.wind
        FROM model_calls m JOIN games g ON g.game_id = m.game_id
        WHERE g.sport = 'nfl'
    """
    params: list = []
    if season is not None:
        query += " AND g.season = ?"
        params.append(season)
    query += " ORDER BY g.kickoff_time"
    rows = [dict(r) for r in conn.execute(query, params).fetchall()]
    for r in rows:
        r["res"] = _grade(r)
    # confidence thresholds for the high/low split
    for key, col in (("su", "conf_su"), ("ats", "conf_ats")):
        vals = sorted(r[col] for r in rows if r[col] is not None and r["res"][key])
        for r in rows:
            r.setdefault("_hi", {})[key] = vals[int(len(vals) * 2 / 3)] if len(vals) >= 6 else float("inf")
            r.setdefault("_lo", {})[key] = vals[int(len(vals) / 3)] if len(vals) >= 6 else float("-inf")

    all_seasons = [r["season"] for r in conn.execute(
        "SELECT DISTINCT g.season FROM model_calls m JOIN games g ON g.game_id = m.game_id WHERE g.sport = 'nfl' ORDER BY g.season DESC"
    ).fetchall()]

    weeks = _weeks(rows)
    scorecard = {}
    for m in MARKETS:
        results = [r["res"][m] for r in rows]
        best, worst = _week_marks(weeks, m)
        scorecard[m] = {"record": _rec(results), "units": _units(results) if m != "su" else None, "streaks": _streaks(results),
                        "best_week": best, "worst_week": worst, "pending": sum(1 for r in rows if r["res"][m] is None and
                                                                               {"su": r["lean_su"], "ats": r["lean_ats"], "total": r["lean_total"]}[m])}

    # --- people vs the model --------------------------------------------------
    pick_q = """
        SELECT p.user_id, p.pick_type, p.selection, p.result, p.game_id FROM picks p
        JOIN model_calls m ON m.game_id = p.game_id JOIN games g ON g.game_id = p.game_id
        WHERE g.sport = 'nfl' AND p.pick_type IN ('straight_up', 'ats', 'total')
    """
    pparams: list = []
    if season is not None:
        pick_q += " AND g.season = ?"
        pparams.append(season)
    picks = conn.execute(pick_q, pparams).fetchall()
    by_game = {r["game_id"]: r for r in rows}
    mkey = {"straight_up": "su", "ats": "ats", "total": "total"}
    lean_of = lambda r, m: {"su": r["lean_su"], "ats": r["lean_ats"], "total": r["lean_total"]}[m]

    people: dict = {}
    consensus: dict = {}
    for p in picks:
        r = by_game.get(p["game_id"])
        m = mkey[p["pick_type"]]
        if not r:
            continue
        consensus.setdefault((p["game_id"], m), []).append(p["selection"])
        if p["result"] not in ("win", "loss", "push") or r["res"][m] is None or not lean_of(r, m):
            continue
        d = people.setdefault(p["user_id"], {}).setdefault(m, {"you": [], "model": [], "agree": 0, "n": 0, "you_right": 0, "model_right": 0, "both_wrong": 0})
        d["you"].append(p["result"])
        d["model"].append(r["res"][m])
        d["n"] += 1
        if p["selection"] == lean_of(r, m):
            d["agree"] += 1
        else:
            d["you_right"] += p["result"] == "win"
            d["model_right"] += r["res"][m] == "win"
            d["both_wrong"] += p["result"] != "win" and r["res"][m] != "win"

    names = {}
    if people:
        ids = list(people)
        ph = ",".join("?" for _ in ids)
        for u in conn.execute(f"SELECT user_id, display_name, avatar_version FROM users WHERE user_id IN ({ph})", tuple(ids)).fetchall():
            names[u["user_id"]] = (u["display_name"], u["avatar_version"])
    people_out = []
    for uid, markets in people.items():
        entry = {"user_id": uid, "display_name": names.get(uid, ("?", 0))[0], "avatar_version": names.get(uid, ("?", 0))[1], "markets": {}}
        for m, d in markets.items():
            entry["markets"][m] = {"n": d["n"], "you": _rec(d["you"]), "model": _rec(d["model"]),
                                   "agree_pct": round(d["agree"] / d["n"] * 100, 1) if d["n"] else None,
                                   "disagree": d["n"] - d["agree"], "you_right": d["you_right"], "model_right": d["model_right"], "both_wrong": d["both_wrong"]}
        people_out.append(entry)
    people_out.sort(key=lambda e: e["display_name"].lower())

    crowd = {m: {"crowd": [], "model": []} for m in MARKETS}
    for (gid, m), sels in consensus.items():
        if len(sels) < 2:
            continue
        r = by_game[gid]
        top = max(set(sels), key=sels.count)
        if sels.count(top) * 2 <= len(sels) or not lean_of(r, m) or r["res"][m] is None:
            continue
        # grade the crowd's side with the same helpers the model uses
        probe = dict(r, lean_su=top, lean_ats=top, lean_total=top)
        crowd[m]["crowd"].append(_grade(probe)[m])
        crowd[m]["model"].append(r["res"][m])
    crowd_out = {m: {"crowd": _rec(v["crowd"]), "model": _rec(v["model"]), "games": len(v["crowd"])} for m, v in crowd.items()}

    # selected person's disagreements
    mine = []
    for p in picks:
        if p["user_id"] != user_id:
            continue
        r = by_game.get(p["game_id"])
        m = mkey[p["pick_type"]]
        if not r or not lean_of(r, m) or p["selection"] == lean_of(r, m) or p["result"] not in ("win", "loss", "push") or r["res"][m] is None:
            continue
        mine.append({"game_id": p["game_id"], "season": r["season"], "week": r["week"], "matchup": f'{r["away_team"]} @ {r["home_team"]}',
                     "market": m, "your_pick": p["selection"], "model_pick": lean_of(r, m), "your_result": p["result"],
                     "model_result": r["res"][m], "score": f'{r["away_team"]} {r["fa"]} - {r["fh"]} {r["home_team"]}', "kickoff": r["kickoff_time"]})
    mine.sort(key=lambda x: x["kickoff"] or "", reverse=True)

    latest = conn.execute("SELECT payload FROM recommendation_snapshots ORDER BY frozen_at DESC LIMIT 1").fetchone()
    validation = None
    if latest:
        try:
            mp = json.loads(latest["payload"]).get("model_prediction") or {}
            validation = {"test_season": mp.get("test_season"), "test_acc": round(mp["test_acc"] * 100, 1) if mp.get("test_acc") else None}
        except (ValueError, KeyError):
            pass

    teams_involved = {t for r in rows for t in (r["home_team"], r["away_team"])}
    return {
        "games_called": len(rows), "graded_games": sum(1 for r in rows if r["res"]["su"] or r["res"]["ats"] or r["res"]["total"]),
        "available_seasons": all_seasons, "scorecard": scorecard, "baselines": _baselines(rows), "validation": validation,
        "trend": {m: _trend(rows, m) for m in MARKETS}, "weeks": weeks,
        "calibration": {m: _calibration(rows, m) for m in MARKETS}, "splits": {m: _splits(rows, m) for m in MARKETS},
        "teams": {m: _by_team(rows, m) for m in MARKETS}, "extremes": {m: _extremes(rows, m) for m in MARKETS},
        "people": people_out, "crowd": crowd_out, "disagreements": mine[:40], "teams_seen": sorted(teams_involved),
    }
