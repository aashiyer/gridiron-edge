import argparse
from datetime import datetime, timedelta, timezone

import openpyxl

from backend.database import db_session
from backend.routers.picks import _grade_pick, grade_pending_picks
from backend.teams import TEAMS

NICKNAMES = {info["name"].split(" ")[-1]: abbr for abbr, info in TEAMS.items()}
PEOPLE = ["Jake", "Aashrith", "Shraavan", "Chetan"]


def _picks_sheet(workbook):
    for ws in workbook.worksheets:
        if ws.title.strip().lower().endswith("picks"):
            return ws
    raise ValueError("no sheet whose name ends in 'Picks'")


def read_sheet(path: str):
    ws = _picks_sheet(openpyxl.load_workbook(path, data_only=True))
    rows = ws.iter_rows(values_only=True)
    header = {str(h).strip(): i for i, h in reversed(list(enumerate(next(rows)))) if h}
    away_col, home_col, spread_col = header["Away Team"], header["Home Team"], header.get("Spread")
    people = {}
    for name in PEOPLE:
        if f"{name} Winner" in header:
            people[name] = (header[f"{name} Winner"], header.get(f"{name} Cover"))
    week = None
    for r in rows:
        first = r[away_col]
        if isinstance(first, str) and first.startswith("Week"):
            week = int(first.split()[1])
            continue
        if first not in NICKNAMES or r[home_col] not in NICKNAMES:
            continue
        yield {
            "week": week,
            "away": NICKNAMES[first],
            "home": NICKNAMES[r[home_col]],
            "spread": r[spread_col] if spread_col is not None else None,
            "picks": {name: (r[w], r[c] if c is not None else None) for name, (w, c) in people.items()},
        }


def plan_import(conn, rows, season: int, name: str, user_id: int):
    season_games = conn.execute("SELECT * FROM games WHERE season = ? ORDER BY kickoff_time", (season,)).fetchall()
    games = {(g["week"], g["away_team"], g["home_team"]): g for g in season_games}
    by_pair: dict = {}
    for g in season_games:
        by_pair.setdefault(frozenset((g["away_team"], g["home_team"])), []).append(g)
    seen: dict = {}
    playoffs: dict = {}
    for g in games.values():
        if g["game_type"] != "REG":
            playoffs.setdefault(frozenset((g["away_team"], g["home_team"])), []).append(g)
    existing = {
        (p["game_id"], p["pick_type"])
        for p in conn.execute("SELECT game_id, pick_type FROM picks WHERE user_id = ?", (user_id,)).fetchall()
    }
    inserts, skipped, unmatched = [], 0, 0
    for row in rows:
        pair = frozenset((row["away"], row["home"]))
        occurrence = seen.get(pair, 0)
        seen[pair] = occurrence + 1
        if row["week"] is None:
            meetings = by_pair.get(pair, [])
            game = meetings[occurrence] if occurrence < len(meetings) else None
        else:
            game = games.get((row["week"], row["away"], row["home"]))
            if not game:
                candidates = playoffs.get(pair, [])
                game = candidates[0] if len(candidates) == 1 else None
        if not game:
            unmatched += 1
            continue
        winner, cover = row["picks"][name]
        for pick_type, nickname in (("straight_up", winner), ("ats", cover)):
            team = NICKNAMES.get(nickname)
            if not team:
                continue
            if (game["game_id"], pick_type) in existing:
                skipped += 1
                continue
            line = None
            if pick_type == "ats":
                if row["spread"] is None:
                    continue
                line = row["spread"] if team == row["home"] else -row["spread"]
            kickoff = game["kickoff_time"]
            try:
                created = (datetime.strptime(kickoff, "%Y-%m-%dT%H:%MZ") - timedelta(hours=1)).replace(tzinfo=timezone.utc).isoformat()
            except (TypeError, ValueError):
                created = datetime.now(timezone.utc).isoformat()
            result = _grade_pick({"pick_type": pick_type, "selection": team, "line_at_pick_time": line}, game, line) or "pending"
            inserts.append((user_id, game["game_id"], pick_type, team, line, created, result))
    return inserts, skipped, unmatched


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--user", action="append", required=True, help="SheetName=email")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    rows = list(read_sheet(args.file))
    with db_session() as conn:
        for spec in args.user:
            name, email = spec.split("=", 1)
            user = conn.execute("SELECT user_id FROM users WHERE email = ?", (email.lower(),)).fetchone()
            if not user:
                print(f"{name}: no account for {email}, skipped")
                continue
            inserts, skipped, unmatched = plan_import(conn, rows, args.season, name, user["user_id"])
            print(f"{name}: {len(inserts)} to add, {skipped} already in app (kept), {unmatched} sheet rows unmatched")
            if args.apply:
                for user_id, game_id, pick_type, team, line, created, result in inserts:
                    conn.execute(
                        """INSERT INTO picks (user_id, game_id, pick_type, selection, line_at_pick_time, graded_line, result, notes, created_at, model_result)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'Imported from picks sheet', ?, 'n_a')
                           ON CONFLICT(user_id, game_id, pick_type) DO NOTHING""",
                        (user_id, game_id, pick_type, team, line, line, result, created),
                    )
                conn.commit()
    if args.apply:
        print("graded:", grade_pending_picks()["count"])


if __name__ == "__main__":
    main()
