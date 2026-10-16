import argparse
from datetime import datetime, timedelta, timezone

import openpyxl

from backend.database import db_session
from backend.routers.picks import _grade_pick, grade_pending_picks
from backend.teams import TEAMS

NICKNAMES = {info["name"].split(" ")[-1]: abbr for abbr, info in TEAMS.items()}
PEOPLE = ["Jake", "Aashrith", "Shraavan", "Chetan"]


def read_sheet(path: str):
    ws = openpyxl.load_workbook(path, data_only=True)["Picks"]
    week = None
    for r in ws.iter_rows(min_row=2, values_only=True):
        first = r[0]
        if isinstance(first, str) and first.startswith("Week"):
            week = int(first.split()[1])
            continue
        if week is None or first not in NICKNAMES or r[2] not in NICKNAMES:
            continue
        yield {
            "week": week,
            "away": NICKNAMES[first],
            "home": NICKNAMES[r[2]],
            "spread": r[4],
            "picks": {name: (r[7 + 2 * i], r[8 + 2 * i]) for i, name in enumerate(PEOPLE)},
        }


def plan_import(conn, rows, season: int, name: str, user_id: int):
    games = {
        (g["week"], g["away_team"], g["home_team"]): g
        for g in conn.execute("SELECT * FROM games WHERE season = ?", (season,)).fetchall()
    }
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
        game = games.get((row["week"], row["away"], row["home"]))
        if not game:
            candidates = playoffs.get(frozenset((row["away"], row["home"])), [])
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
            if pick_type == "ats" and row["spread"] is not None:
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
