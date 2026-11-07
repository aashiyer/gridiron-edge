"""League-level stats that only exist because this group picks together:
closing line value, rivalries, who fades the room, lone-wolf wins, each
person's specialties, and the weekly recap.

Everything reads graded picks once (memoized) and is computed in Python on
light rows, so a page view costs a few hundred KB at most and usually nothing.
"""
from datetime import datetime, timezone

from backend.routers.records import WIN_UNITS, _splits
from backend.ttl_cache import ttl_memo

MIN_PICKS = 20
MIN_WEEK_DECIDED = 6
MIN_SPLIT_N = 12
DECIDED = ("win", "loss", "push")


def _rec(results) -> dict:
    results = list(results)
    w, l, p = results.count("win"), results.count("loss"), results.count("push")
    return {"wins": w, "losses": l, "pushes": p, "win_pct": round(w / (w + l) * 100, 1) if w + l else None}


def _units(results) -> float:
    return round(sum(WIN_UNITS if r == "win" else -1.0 if r == "loss" else 0.0 for r in results), 2)


def _fade_units(results) -> float:
    return round(sum(WIN_UNITS if r == "loss" else -1.0 if r == "win" else 0.0 for r in results), 2)


@ttl_memo("insights_rows", 600)
def load_rows(conn, sport: str) -> list:
    rows = conn.execute(
        """
        SELECT p.user_id, p.game_id, p.pick_type, p.selection, p.result, p.line_at_pick_time, p.graded_line, p.created_at,
               g.season, g.week, g.kickoff_time, g.home_team, g.away_team, g.home_spread_close, g.div_game,
               g.final_home_score AS fh, g.final_away_score AS fa
        FROM picks p JOIN games g ON g.game_id = p.game_id
        WHERE g.sport = ? AND p.result IN ('win', 'loss', 'push')
        """,
        (sport,),
    ).fetchall()
    return [dict(r) for r in rows]


@ttl_memo("insights_weeks", 600)
def complete_weeks(conn, sport: str) -> set:
    rows = conn.execute(
        "SELECT season, week, COUNT(*) AS n, SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS f FROM games WHERE sport = ? GROUP BY season, week",
        (sport,),
    ).fetchall()
    return {(r["season"], r["week"]) for r in rows if r["n"] == r["f"]}


def _people(conn, rows) -> dict:
    counts: dict = {}
    for r in rows:
        counts[r["user_id"]] = counts.get(r["user_id"], 0) + 1
    ids = [u for u, n in counts.items() if n >= MIN_PICKS]
    if not ids:
        return {}
    ph = ",".join("?" for _ in ids)
    users = conn.execute(f"SELECT user_id, display_name, avatar_version FROM users WHERE user_id IN ({ph})", tuple(ids)).fetchall()
    return {u["user_id"]: {"user_id": u["user_id"], "display_name": u["display_name"], "avatar_version": u["avatar_version"]} for u in users}


def _utc(iso):
    if not iso:
        return None
    try:
        if iso.endswith("Z"):
            return datetime.strptime(iso, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        d = datetime.fromisoformat(iso)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _clv(row):
    """Points of line value versus the close: positive means you beat the market."""
    pick, close = row["line_at_pick_time"], row["graded_line"]
    if pick is None or close is None:
        return None
    if row["pick_type"] == "ats":
        return pick - close
    if row["pick_type"] == "total":
        return (close - pick) if row["selection"] == "over" else (pick - close)
    return None


def _clv_block(rows, people):
    valid = {r["season"] for r in rows if r["pick_type"] in ("ats", "total") and r["line_at_pick_time"] is not None
             and r["graded_line"] is not None and r["line_at_pick_time"] != r["graded_line"]}
    out = []
    for uid, person in people.items():
        mine = [r for r in rows if r["user_id"] == uid and r["season"] in valid]
        entry = {**person}
        for market in ("ats", "total"):
            picks = [(r, _clv(r)) for r in mine if r["pick_type"] == market]
            picks = [(r, c) for r, c in picks if c is not None]
            if len(picks) < 5:
                entry[market] = None
                continue
            vals = [c for _, c in picks]
            entry[market] = {
                "n": len(vals), "avg": round(sum(vals) / len(vals), 2),
                "beat_pct": round(sum(1 for v in vals if v > 0) / len(vals) * 100, 1),
                "worse_pct": round(sum(1 for v in vals if v < 0) / len(vals) * 100, 1),
                "win_pct": _rec(r["result"] for r, _ in picks)["win_pct"], "units": _units(r["result"] for r, _ in picks),
            }
        hours = []
        for r in mine:
            created, kick = _utc(r["created_at"]), _utc(r["kickoff_time"])
            if created and kick and created < kick:
                hours.append((kick - created).total_seconds() / 3600)
        entry["avg_hours_early"] = round(sum(hours) / len(hours), 1) if len(hours) >= 5 else None
        entry["last_minute_pct"] = round(sum(1 for h in hours if h < 1) / len(hours) * 100, 1) if len(hours) >= 5 else None
        if entry["ats"] or entry["total"]:
            out.append(entry)
    out.sort(key=lambda e: -((e["ats"] or {}).get("avg", -99)))
    return {"seasons": sorted(valid), "people": out}


def _crowd_block(rows, people, season):
    use = [r for r in rows if r["user_id"] in people and (season is None or r["season"] == season)]
    groups: dict = {}
    for r in use:
        groups.setdefault((r["game_id"], r["pick_type"]), []).append(r)
    stats = {uid: {m: {"follow": [], "fade": []} for m in ("ats", "straight_up", "total")} for uid in people}
    wolves = {uid: [] for uid in people}
    wolf_recent = []
    for (_, market), grp in groups.items():
        if len(grp) < 3:
            continue
        for r in grp:
            others = [o["selection"] for o in grp if o is not r]
            top = max(set(others), key=others.count)
            if others.count(top) * 2 > len(others):
                stats[r["user_id"]][market]["follow" if r["selection"] == top else "fade"].append(r["result"])
            if len(set(others)) == 1 and r["selection"] != others[0] and len(others) >= 2 and market != "total":
                wolves[r["user_id"]].append(r["result"])
                if r["result"] == "win":
                    wolf_recent.append(r)
    out = []
    for uid, person in people.items():
        entry = {**person, "markets": {}}
        for m, d in stats[uid].items():
            n = len(d["follow"]) + len(d["fade"])
            entry["markets"][m] = {
                "n": n, "fade_pct": round(len(d["fade"]) / n * 100, 1) if n else None,
                "fade_record": _rec(d["fade"]), "follow_record": _rec(d["follow"]),
            }
        entry["lone_wolf"] = _rec(wolves[uid])
        out.append(entry)
    wolf_recent.sort(key=lambda r: r["kickoff_time"] or "", reverse=True)
    recent = [{"user_id": r["user_id"], "game_id": r["game_id"], "season": r["season"], "week": r["week"], "market": r["pick_type"],
               "selection": r["selection"], "matchup": f'{r["away_team"]} @ {r["home_team"]}'} for r in wolf_recent[:10]]
    return {"people": out, "lone_wolf_recent": recent}


def _tail_block(rows, people, season):
    out = []
    for uid, person in people.items():
        res = [r["result"] for r in rows if r["user_id"] == uid and r["pick_type"] == "ats" and (season is None or r["season"] == season)]
        if len(res) < 10:
            continue
        out.append({**person, "n": len(res), "tail_units": _units(res), "fade_units": _fade_units(res), "ats": _rec(res)})
    out.sort(key=lambda e: -e["tail_units"])
    return out


def _specialties(rows, people, sport, season):
    out = []
    for uid, person in people.items():
        mine = [dict(r, line=r["graded_line"] if r["graded_line"] is not None else r["line_at_pick_time"], div_game=r["div_game"])
                for r in rows if r["user_id"] == uid and r["pick_type"] == "ats" and (season is None or r["season"] == season)]
        if len(mine) < 30:
            continue
        cands = []
        for group in _splits(mine, sport):
            for item in group["items"]:
                n = item["record"]["wins"] + item["record"]["losses"]
                if n >= MIN_SPLIT_N and item["record"]["win_pct"] is not None:
                    cands.append({"group": group["title"], "label": item["label"], "record": item["record"], "n": n})
        if len(cands) >= 2:
            best = max(cands, key=lambda c: (c["record"]["win_pct"], c["n"]))
            worst = min(cands, key=lambda c: (c["record"]["win_pct"], -c["n"]))
            out.append({**person, "best": best, "worst": worst})
    return out


def _rivalries(rows, people, done):
    ats_weeks: dict = {}
    for r in rows:
        if r["pick_type"] == "ats" and r["user_id"] in people and (r["season"], r["week"]) in done:
            ats_weeks.setdefault((r["user_id"], r["season"], r["week"]), []).append(r["result"])
    week_pct = {}
    for (uid, s, w), res in ats_weeks.items():
        rec = _rec(res)
        if rec["wins"] + rec["losses"] >= MIN_WEEK_DECIDED:
            week_pct[(uid, s, w)] = rec["wins"] / (rec["wins"] + rec["losses"])

    ids = sorted(people)
    pairs = {}

    def pair(a, b):
        key = (a, b)
        if key not in pairs:
            pairs[key] = {"a": a, "b": b, "weeks": {"a": 0, "b": 0, "t": 0}, "duels": {"ats": {"a": 0, "b": 0}, "straight_up": {"a": 0, "b": 0}},
                          "by_season": {}, "recent": []}
        return pairs[key]

    def season_slot(p, s):
        return p["by_season"].setdefault(s, {"weeks": {"a": 0, "b": 0, "t": 0}, "duels": {"ats": {"a": 0, "b": 0}, "straight_up": {"a": 0, "b": 0}}})

    weeks_seen = {(s, w) for (_, s, w) in week_pct}
    for s, w in sorted(weeks_seen):
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                pa, pb = week_pct.get((a, s, w)), week_pct.get((b, s, w))
                if pa is None or pb is None:
                    continue
                k = "a" if pa > pb else "b" if pb > pa else "t"
                p = pair(a, b)
                p["weeks"][k] += 1
                season_slot(p, s)["weeks"][k] += 1

    groups: dict = {}
    for r in rows:
        if r["user_id"] in people and r["pick_type"] in ("ats", "straight_up"):
            groups.setdefault((r["game_id"], r["pick_type"]), []).append(r)
    duels = []
    for (_, market), grp in groups.items():
        for i, x in enumerate(grp):
            for y in grp[i + 1:]:
                if x["selection"] == y["selection"] or x["user_id"] == y["user_id"]:
                    continue
                xw, yw = x["result"] == "win", y["result"] == "win"
                if xw == yw:
                    continue
                a, b = sorted((x, y), key=lambda r: r["user_id"])
                winner = "a" if a["result"] == "win" else "b"
                p = pair(a["user_id"], b["user_id"])
                p["duels"][market][winner] += 1
                season_slot(p, a["season"])["duels"][market][winner] += 1
                duels.append((p, a, b, market, winner))
    duels.sort(key=lambda d: d[1]["kickoff_time"] or "", reverse=True)
    for p, a, b, market, winner in duels:
        if len(p["recent"]) < 8:
            p["recent"].append({"game_id": a["game_id"], "season": a["season"], "week": a["week"], "market": market,
                                "matchup": f'{a["away_team"]} @ {a["home_team"]}', "a_pick": a["selection"], "b_pick": b["selection"], "winner": winner})
    out = []
    for p in pairs.values():
        p["by_season"] = [{"season": s, **v} for s, v in sorted(p["by_season"].items(), reverse=True)]
        out.append(p)
    return out


def _model_vs_people(conn, rows, people, season):
    from backend.model_stats import model_report

    rep = model_report(conn, 0, season)
    model_weeks = {(w["season"], w["week"]): w for w in rep["weeks"] if w["complete"]}
    beats = {uid: {"beat": 0, "lost": 0, "tied": 0} for uid in people}
    per: dict = {}
    for r in rows:
        if r["pick_type"] == "ats" and r["user_id"] in people and (r["season"], r["week"]) in model_weeks:
            per.setdefault((r["user_id"], r["season"], r["week"]), []).append(r["result"])
    for (uid, s, w), res in per.items():
        rec = _rec(res)
        m = model_weeks[(s, w)]["ats"]
        if rec["wins"] + rec["losses"] < MIN_WEEK_DECIDED or m["win_pct"] is None or (m["wins"] + m["losses"]) < MIN_WEEK_DECIDED:
            continue
        k = "beat" if rec["win_pct"] > m["win_pct"] else "lost" if rec["win_pct"] < m["win_pct"] else "tied"
        beats[uid][k] += 1
    return {"model": {"su": rep["scorecard"]["su"]["record"], "ats": rep["scorecard"]["ats"]["record"], "total": rep["scorecard"]["total"]["record"],
                      "ats_units": rep["scorecard"]["ats"]["units"], "games_called": rep["games_called"]},
            "weeks_vs_model": [{**people[u], **b} for u, b in beats.items() if sum(b.values())]}


def league(conn, sport: str, season):
    rows = load_rows(conn, sport)
    people = _people(conn, rows)
    done = complete_weeks(conn, sport)
    seasons = sorted({r["season"] for r in rows}, reverse=True)
    out = {
        "sport": sport, "season": season, "seasons": seasons, "people": list(people.values()),
        "clv": _clv_block(rows, people), "crowd": _crowd_block(rows, people, season), "tail": _tail_block(rows, people, season),
        "specialties": _specialties(rows, people, sport, season), "rivalries": _rivalries(rows, people, done),
        "model": None, "weeks_vs_model": [],
    }
    if sport == "nfl":
        out.update(_model_vs_people(conn, rows, people, season))
    return out


@ttl_memo("insights_league", 300)
def league_cached(conn, sport: str, season):
    return league(conn, sport, season)


# ---- weekly recap -----------------------------------------------------------

def recap(conn, sport: str, season: int, week: int):
    rows = load_rows(conn, sport)
    people = _people(conn, rows)
    done = complete_weeks(conn, sport)
    wk = [r for r in rows if r["season"] == season and r["week"] == week and r["user_id"] in people]
    if not wk:
        return None
    per = {}
    for uid in people:
        mine = [r for r in wk if r["user_id"] == uid]
        if not mine:
            continue
        per[uid] = {**people[uid], "ats": _rec(r["result"] for r in mine if r["pick_type"] == "ats"),
                    "su": _rec(r["result"] for r in mine if r["pick_type"] == "straight_up"),
                    "total": _rec(r["result"] for r in mine if r["pick_type"] == "total")}
    ranked = sorted(per.values(), key=lambda p: (-(p["ats"]["win_pct"] or -1), -(p["ats"]["wins"] + p["ats"]["losses"])))
    eligible = [p for p in ranked if p["ats"]["wins"] + p["ats"]["losses"] >= MIN_WEEK_DECIDED]
    winners = [p for p in eligible if p["ats"]["win_pct"] == eligible[0]["ats"]["win_pct"]] if eligible else []
    worst = eligible[-1] if len(eligible) > 1 else None

    streak = 0
    if winners:
        w0 = {p["user_id"] for p in winners}
        for prev in range(week - 1, 0, -1):
            if (season, prev) not in done:
                break
            res = {}
            for r in rows:
                if r["season"] == season and r["week"] == prev and r["pick_type"] == "ats" and r["user_id"] in people:
                    res.setdefault(r["user_id"], []).append(r["result"])
            pct = {u: _rec(v)["win_pct"] for u, v in res.items() if _rec(v)["wins"] + _rec(v)["losses"] >= MIN_WEEK_DECIDED}
            if not pct:
                break
            best = max(pct.values())
            if w0 & {u for u, v in pct.items() if v == best}:
                streak += 1
            else:
                break

    upset = None
    best = None
    for r in wk:
        if r["pick_type"] != "straight_up" or r["result"] != "win" or r["home_spread_close"] is None:
            continue
        line = r["home_spread_close"] if r["selection"] == r["home_team"] else -r["home_spread_close"]
        if line > 0 and (best is None or line > best[0]):
            best = (line, r)
    if best:
        g = best[1]
        names = sorted({people[r["user_id"]]["display_name"] for r in wk
                        if r["game_id"] == g["game_id"] and r["pick_type"] == "straight_up" and r["selection"] == g["selection"] and r["result"] == "win"})
        upset = {"line": best[0], "team": g["selection"], "matchup": f'{g["away_team"]} @ {g["home_team"]}', "users": names}

    crowd = _crowd_block([r for r in rows if r["season"] == season and r["week"] == week], people, season)
    wolves = [{"name": people[w["user_id"]]["display_name"], "team": w["selection"], "matchup": w["matchup"], "market": w["market"]} for w in crowd["lone_wolf_recent"]]

    model = None
    if sport == "nfl":
        from backend.model_stats import model_report

        rep = model_report(conn, 0, season)
        mw = next((w for w in rep["weeks"] if w["season"] == season and w["week"] == week), None)
        if mw:
            model = {"su": mw["su"], "ats": mw["ats"], "total": mw["total"],
                     "beat_by": [p["display_name"] for p in eligible if mw["ats"]["win_pct"] is not None and p["ats"]["win_pct"] > mw["ats"]["win_pct"]]}

    season_res: dict = {}
    for r in rows:
        if r["season"] == season and r["week"] <= week and r["pick_type"] == "ats" and r["user_id"] in people:
            season_res.setdefault(r["user_id"], []).append(r["result"])
    table = sorted(({**people[u], "ats": _rec(v)} for u, v in season_res.items() if len(v) >= 10), key=lambda p: -(p["ats"]["win_pct"] or -1))[:3]
    return {"sport": sport, "season": season, "week": week, "complete": (season, week) in done, "people": ranked, "winners": winners,
            "winner_streak": streak, "worst": worst, "upset": upset, "lone_wolves": wolves[:3], "model": model, "season_top": table}
