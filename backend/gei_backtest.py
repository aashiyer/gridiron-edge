import argparse
import math
import sqlite3

from backend import power_ranking as pr
from backend.ttl_cache import _CACHES

TABLES = ["games", "team_stats", "ngs_team_stats", "qb_starters"]
EVAL_SEASONS = [2022, 2023, 2024, 2025]
FIRST_WEEK, LAST_WEEK = 3, 18
EARLY_MAX_WEEK = 6


def load_local() -> sqlite3.Connection:
    import os

    local = os.environ.get("GEI_LOCAL_DB")
    if local:
        mem = sqlite3.connect(":memory:")
        sqlite3.connect(local).backup(mem)
        mem.row_factory = sqlite3.Row
        return mem

    from backend.database import db_session

    mem = sqlite3.connect(":memory:")
    mem.row_factory = sqlite3.Row
    mem.executescript(open("db/schema.sql").read())
    with db_session() as src:
        for table in TABLES:
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                continue
            cols = list(rows[0].keys())
            mem.executemany(
                f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                [tuple(r[c] for c in cols) for r in rows],
            )
    mem.commit()
    return mem


def clear_caches():
    pr._RATINGS_CACHE.clear()
    for cache in _CACHES.values():
        cache.clear()


def collect(conn, seasons=EVAL_SEASONS):
    clear_caches()
    out = []
    for season in seasons:
        for week in range(FIRST_WEEK, LAST_WEEK + 1):
            ratings = pr.gei_power_ranking(conn, season, week - 1)
            games = conn.execute(
                """SELECT home_team, away_team, final_home_score, final_away_score, home_spread_close
                   FROM games WHERE season = ? AND week = ? AND status = 'final'""",
                (season, week),
            ).fetchall()
            for g in games:
                h, a = ratings.get(g["home_team"]), ratings.get(g["away_team"])
                if not h or not a or g["home_spread_close"] is None:
                    continue
                out.append(
                    {
                        "season": season,
                        "week": week,
                        "x": h["gei"] - a["gei"],
                        "margin": g["final_home_score"] - g["final_away_score"],
                        "market": -g["home_spread_close"],
                    }
                )
    return out


def _fit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    return slope, my - slope * mx


def _rmse(errs):
    return math.sqrt(sum(e * e for e in errs) / len(errs))


def _spearman_free_corr(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy) if sxx and syy else 0.0


def score(rows) -> dict:
    xs = [r["x"] for r in rows]
    ys = [r["margin"] for r in rows]
    slope, intercept = _fit(xs, ys)
    pred = [slope * x + intercept for x in xs]
    result = {"games": len(rows), "rmse": _rmse([p - y for p, y in zip(pred, ys)]), "slope": slope, "intercept": intercept}
    early = [(p, r) for p, r in zip(pred, rows) if r["week"] <= EARLY_MAX_WEEK]
    result["rmse_early"] = _rmse([p - r["margin"] for p, r in early])
    result["market_rmse"] = _rmse([r["market"] - r["margin"] for r in rows])
    result["corr_market"] = _spearman_free_corr(pred, [r["market"] for r in rows])

    wins = losses = 0
    for p, r in zip(pred, rows):
        edge = p - r["market"]
        cover = r["margin"] - r["market"]
        if edge == 0 or cover == 0:
            continue
        if (edge > 0) == (cover > 0):
            wins += 1
        else:
            losses += 1
    result["ats"] = wins / (wins + losses) if wins + losses else 0.0

    market = [r["market"] for r in rows]
    design_rmse = _two_feature_rmse(xs, market, ys)
    result["rmse_with_market"] = design_rmse[0]
    result["rmse_market_only"] = design_rmse[1]
    return result


def _two_feature_rmse(xs, ms, ys):
    n = len(ys)
    mx, mm, my = sum(xs) / n, sum(ms) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    smm = sum((m - mm) ** 2 for m in ms)
    sxm = sum((x - mx) * (m - mm) for x, m in zip(xs, ms))
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    smy = sum((m - mm) * (y - my) for m, y in zip(ms, ys))
    det = sxx * smm - sxm * sxm
    bx = (sxy * smm - smy * sxm) / det if det else 0.0
    bm = (smy * sxx - sxy * sxm) / det if det else 0.0
    c = my - bx * mx - bm * mm
    both = _rmse([bx * x + bm * m + c - y for x, m, y in zip(xs, ms, ys)])
    slope, intercept = _fit(ms, ys)
    only = _rmse([slope * m + intercept - y for m, y in zip(ms, ys)])
    return both, only


def report(label: str, s: dict):
    print(
        f"{label:<34} RMSE {s['rmse']:.3f} | early wks {s['rmse_early']:.3f} | corr w/ market {s['corr_market']:.3f} | "
        f"ATS {s['ats'] * 100:.1f}% | +GEI on market {s['rmse_market_only'] - s['rmse_with_market']:+.3f}"
    )


def apply_setting(name: str, value: str):
    if name.startswith("W."):
        pr.WEIGHTS[name[2:]] = float(value)
    elif value in ("True", "False"):
        setattr(pr, name, value == "True")
    else:
        setattr(pr, name, None if value == "None" else float(value))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="current")
    parser.add_argument("--set", action="append", default=[], help="CONSTANT=value, applied to power_ranking")
    parser.add_argument("--sweep", help="CONSTANT=v1,v2,... runs each value")
    args = parser.parse_args()
    conn = load_local()

    for assignment in args.set:
        name, value = assignment.split("=")
        apply_setting(name, value)

    if args.sweep:
        name, values = args.sweep.split("=")
        for value in values.split(","):
            apply_setting(name, value)
            s = score(collect(conn))
            report(f"{name}={value}", s)
        return

    s = score(collect(conn))
    print(f"{s['games']} games, market-only RMSE {s['market_rmse']:.3f} (the bar to beat is roughly this)")
    report(args.label, s)
    print(f"margin points per GEI unit: {s['slope']:.3f}; home-field intercept: {s['intercept']:.2f} pts")


if __name__ == "__main__":
    main()
