import base64
import math
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from backend.database import db_session
from backend.routers.leaderboard import week_board
from backend.teams import team_meta

MAX_PEOPLE = 4
GAMES_PER_SLIDE = 7
PAGE_WIDTH = 968
GAME_COLUMN = 282
_LOGOS: dict = {}
_RENDER_LOCK = threading.Lock()
_BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
_PALETTE = ["#6f8cff", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#a855f7"]


def _logo_uri(abbr: str) -> str:
    if abbr not in _LOGOS:
        try:
            r = requests.get(team_meta(abbr)["logo"], timeout=6)
            r.raise_for_status()
            _LOGOS[abbr] = "data:image/png;base64," + base64.b64encode(r.content).decode()
        except Exception:
            _LOGOS[abbr] = _BLANK_PNG
    return _LOGOS[abbr]


def _initials_uri(name: str, user_id: int) -> str:
    color = _PALETTE[user_id % len(_PALETTE)]
    letter = (name.strip()[:1] or "?").upper()
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%s"/>'
        '<text x="128" y="128" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="700" fill="#fff" '
        'text-anchor="middle" dominant-baseline="central">%s</text></svg>' % (color, letter)
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _avatar_uris(users: list) -> dict:
    ids = [u["user_id"] for u in users]
    with db_session() as conn:
        rows = conn.execute(
            "SELECT user_id, avatar FROM users WHERE user_id IN (%s)" % ",".join("?" * len(ids)), tuple(ids)
        ).fetchall()
    have = {r["user_id"]: bytes(r["avatar"]) for r in rows if r["avatar"] is not None}
    return {
        u["user_id"]: ("data:image/jpeg;base64," + base64.b64encode(have[u["user_id"]]).decode())
        if u["user_id"] in have
        else _initials_uri(u["display_name"], u["user_id"])
        for u in users
    }


def _readable_on(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return "#111111" if 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5 else "#ffffff"


def _fmt_rec(r: dict) -> str:
    return f"{r['wins']}-{r['losses']}" + (f"-{r['pushes']}" if r["pushes"] else "")


def _pct(r: dict) -> str:
    return f"{r['win_pct']:.0f}%" if r["win_pct"] is not None else "—"


def _line_label(game: dict) -> str:
    spread = game["current_spread"] if game["current_spread"] is not None else game["home_spread_close"]
    if spread is None:
        return ""
    if spread == 0:
        return "PK"
    return f"{game['home_team']} {spread:g}" if spread < 0 else f"{game['away_team']} {-spread:g}"


def _kickoff(iso) -> str:
    try:
        if iso.endswith("Z"):
            d = datetime.strptime(iso, "%Y-%m-%dT%H:%MZ").replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/New_York"))
        else:
            d = datetime.strptime(iso[:16], "%Y-%m-%dT%H:%M")
    except (TypeError, ValueError, AttributeError):
        return "TBD"
    return d.strftime("%a %-I:%M %p")


def _chip(pick, size: dict) -> str:
    if not pick or pick["missed"] or pick["selection"] is None:
        return '<span class="chip none">—</span>'
    meta = team_meta(pick["selection"])
    badge = {"win": '<i class="badge win">✓</i>', "loss": '<i class="badge loss">✗</i>', "push": '<i class="badge push">P</i>'}.get(pick["result"], "")
    return (
        f'<span class="chip" style="background:{meta["color"]};border-color:{meta["secondary"]};color:{_readable_on(meta["color"])}">'
        f'{pick["selection"]}{badge}</span>'
    )


def _css(n_people: int) -> str:
    col = (PAGE_WIDTH - GAME_COLUMN) / (2 * n_people)
    chip_w = max(54, min(100, col - 30))
    chip_font = max(15, min(25, chip_w * 0.29))
    return f"""
@page {{ size: 1080px 1350px; margin: 0 }}
* {{ box-sizing: border-box }}
body {{ margin: 0; background: #0d1017; color: #e8eaf0; font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif }}
.slide {{ width: 1080px; height: 1350px; padding: 64px 56px; position: relative; page-break-after: always; background: #0d1017; overflow: hidden }}
.brand {{ font-size: 22px; font-weight: 800; letter-spacing: 5px; color: #8d93a5 }} .brand em {{ color: #6f8cff; font-style: normal }}
.cover h1 {{ font-size: 150px; line-height: 0.95; letter-spacing: -5px; margin: 26px 0 18px; font-weight: 900 }}
.sub {{ font-size: 25px; color: #8d93a5; margin-bottom: 46px }}
.label {{ font-size: 17px; font-weight: 700; letter-spacing: 3.5px; text-transform: uppercase; color: #6f8cff; margin-bottom: 20px }}
.plist {{ display: flex; flex-direction: column; gap: {14 if n_people > 3 else 18}px }}
.prow {{ display: flex; align-items: center; gap: 28px; background: #151a24; border: 1px solid #232a38; border-radius: 28px; padding: {16 if n_people > 3 else 22}px 30px }}
.bigav {{ width: {104 if n_people > 3 else 124}px; height: {104 if n_people > 3 else 124}px; border-radius: 50%; border: 3px solid #2a3142 }}
.pinfo {{ flex: 1 }} .pname {{ font-size: 38px; font-weight: 800; margin-bottom: 8px }}
.stats {{ display: flex; gap: 52px }} .stat .sl {{ font-size: 16px; color: #8d93a5; margin-bottom: 2px }}
.stat .sv {{ font-size: 44px; font-weight: 900; letter-spacing: -1px; display: inline-block }} .stat .sp {{ display: inline-block; margin-left: 12px; font-size: 20px; color: #8d93a5 }}
.swipe {{ position: absolute; bottom: 46px; right: 56px; font-size: 21px; color: #8d93a5; letter-spacing: 1px }}
.top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px }} .pg {{ font-size: 17px; font-weight: 700; letter-spacing: 3px; color: #6f8cff }}
table {{ width: 100%; border-collapse: separate; border-spacing: 0; background: #151a24; border: 1px solid #232a38; border-radius: 26px; overflow: hidden }}
th {{ color: #8d93a5; text-align: center; border-bottom: 1px solid #232a38 }}
th.person {{ padding: 22px 4px 10px; border-left: 1px solid #232a38; color: #e8eaf0; font-size: {24 if n_people < 4 else 20}px; font-weight: 800 }}
th.person img {{ width: 74px; height: 74px; border-radius: 50%; border: 3px solid #2a3142; display: block; margin: 0 auto 7px }}
th.sub {{ font-size: 14px; letter-spacing: 2px; padding: 4px 0 14px }}
td {{ text-align: center; border-bottom: 1px solid #1d2330 }} tr:last-child td {{ border-bottom: 0 }}
td.pickcell {{ border-left: 1px solid #1d2330 }}
td.game {{ text-align: left; padding-left: 18px; width: {GAME_COLUMN}px; white-space: nowrap }}
tr.split td.game {{ box-shadow: inset 6px 0 0 #6f8cff }}
.teams {{ display: flex; align-items: center; gap: 7px; font-size: 26px }} .teams img {{ width: 36px; height: 36px }} .at {{ color: #5d6478; font-size: 16px }}
.meta {{ color: #8d93a5; font-size: 18px; margin-top: 8px; padding-left: 2px }}
.chip {{ display: inline-block; position: relative; min-width: {chip_w:.0f}px; padding: 15px 4px; border-radius: 15px; border: 4px solid; font-weight: 800; font-size: {chip_font:.0f}px; letter-spacing: 0.5px }}
.chip.none {{ border-color: #2a3142; color: #4d5468; background: transparent; font-weight: 500 }}
.badge {{ position: absolute; top: -13px; right: -13px; width: 28px; height: 28px; border-radius: 50%; font-style: normal; font-size: 15px; line-height: 28px; text-align: center; color: #fff; border: 3px solid #151a24 }}
.badge.win {{ background: #22c55e }} .badge.loss {{ background: #ef4444 }} .badge.push {{ background: #f59e0b }}
.legend {{ position: absolute; bottom: 46px; left: 56px; white-space: nowrap; font-size: 21px; color: #8d93a5; display: flex; align-items: center; gap: 12px }}
.legend .bar {{ flex: 0 0 6px; width: 6px; height: 26px; background: #6f8cff; display: inline-block; border-radius: 3px }}
"""


def _cover(week: int, users: list, avatars: dict, prev_records: dict | None, prev_week: int | None, season: int) -> str:
    rows = ""
    if prev_records:
        for u in users:
            r = prev_records[str(u["user_id"])]
            rows += (
                f'<div class="prow"><img class="bigav" src="{avatars[u["user_id"]]}"><div class="pinfo"><div class="pname">{u["display_name"]}</div>'
                f'<div class="stats"><div class="stat"><div class="sl">Straight up</div><div class="sv">{_fmt_rec(r["straight_up"])}</div><div class="sp">{_pct(r["straight_up"])}</div></div>'
                f'<div class="stat"><div class="sl">Against the spread</div><div class="sv">{_fmt_rec(r["ats"])}</div><div class="sp">{_pct(r["ats"])}</div></div></div></div></div>'
            )
    else:
        rows = "".join(
            f'<div class="prow"><img class="bigav" src="{avatars[u["user_id"]]}"><div class="pinfo"><div class="pname">{u["display_name"]}</div></div></div>'
            for u in users
        )
    label = f"How we finished Week {prev_week}" if prev_records else "This week's crew"
    names = " · ".join(u["display_name"] for u in users)
    return (
        f'<section class="slide cover"><div class="brand">PICK<em>SIX</em></div><h1>WEEK {week}<br>PICKS</h1>'
        f'<div class="sub">{season} NFL Season · {names}</div><div class="label">{label}</div><div class="plist">{rows}</div>'
        f'<div class="swipe">Swipe for the picks →</div></section>'
    )


def _ats_split(game: dict, board: dict, users: list) -> bool:
    picked = set()
    for u in users:
        pick = board["picks"].get(game["game_id"], {}).get(str(u["user_id"]), {}).get("ats")
        if pick and not pick["missed"] and pick["selection"]:
            picked.add(pick["selection"])
    return len(picked) > 1


def _picks_slide(chunk: list, idx: int, total: int, week: int, board: dict, users: list, avatars: dict, split_count: int, n_games: int) -> str:
    head = "".join(f'<th colspan="2" class="person"><img src="{avatars[u["user_id"]]}"><div>{u["display_name"]}</div></th>' for u in users)
    sub = "".join('<th class="sub">SU</th><th class="sub">ATS</th>' for _ in users)
    pad = 33 if len(chunk) >= 6 else 38
    rows = []
    for g in chunk:
        meta = f"Final {g['final_away_score']}–{g['final_home_score']}" if g["status"] == "final" else f"{_line_label(g)} · {_kickoff(g['kickoff_time'])}"
        cells = ""
        for u in users:
            picks = board["picks"].get(g["game_id"], {}).get(str(u["user_id"]), {})
            cells += (
                f'<td class="pickcell" style="padding:{pad}px 4px">{_chip(picks.get("straight_up"), {})}</td>'
                f'<td style="padding:{pad}px 4px">{_chip(picks.get("ats"), {})}</td>'
            )
        rows.append(
            f'<tr class="{"split" if _ats_split(g, board, users) else ""}"><td class="game" style="padding-top:{pad}px;padding-bottom:{pad}px">'
            f'<div class="teams"><img src="{_logo_uri(g["away_team"])}"><b>{g["away_team"]}</b><span class="at">@</span><img src="{_logo_uri(g["home_team"])}"><b>{g["home_team"]}</b></div>'
            f'<div class="meta">{meta}</div></td>{cells}</tr>'
        )
    foot = (
        f'<div class="legend"><span class="bar"></span> We split on the ATS pick in {split_count} of {n_games} games</div>'
        if idx == total
        else '<div class="swipe">Swipe for the rest →</div>'
    )
    return (
        f'<section class="slide picks"><div class="top"><div class="brand">PICK<em>SIX</em></div><div class="pg">WEEK {week} PICKS · {idx}/{total}</div></div>'
        f'<table><thead><tr><th class="left" rowspan="2"></th>{head}</tr><tr>{sub}</tr></thead><tbody>{"".join(rows)}</tbody></table>{foot}</section>'
    )


def render_week_slides(season: int, week: int, user_ids: list | None = None) -> list:
    me = {"user_id": 0}
    board = week_board(season, week, me)
    if not board["games"]:
        return []
    users = [u for u in board["users"] if not user_ids or u["user_id"] in user_ids][:MAX_PEOPLE]
    if not users:
        return []

    prev_records, prev_week = None, None
    if week > 1:
        prev = week_board(season, week - 1, me)
        if prev["games"] and all(str(u["user_id"]) in prev["records"] for u in users):
            prev_records, prev_week = prev["records"], week - 1

    avatars = _avatar_uris(users)
    games = board["games"]
    n_chunks = math.ceil(len(games) / GAMES_PER_SLIDE)
    size = math.ceil(len(games) / n_chunks)
    chunks = [games[i : i + size] for i in range(0, len(games), size)]
    split_count = sum(_ats_split(g, board, users) for g in games)

    sections = [_cover(week, users, avatars, prev_records, prev_week, season)]
    for i, chunk in enumerate(chunks, start=1):
        sections.append(_picks_slide(chunk, i, len(chunks), week, board, users, avatars, split_count, len(games)))
    html = f'<!doctype html><html><head><meta charset="utf-8"><style>{_css(len(users))}</style></head><body>{"".join(sections)}</body></html>'

    from weasyprint import HTML
    import pymupdf

    with _RENDER_LOCK:
        pdf = HTML(string=html).write_pdf()
        doc = pymupdf.open(stream=pdf, filetype="pdf")
        slides = []
        for i, page in enumerate(doc, start=1):
            png = page.get_pixmap(dpi=96).tobytes("png")
            slides.append({"filename": f"picksix_week{week}_slide{i}.png", "image": "data:image/png;base64," + base64.b64encode(png).decode()})
        doc.close()
    return slides
