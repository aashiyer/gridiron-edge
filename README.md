# Pick Six — NFL Picks Tracker

A multi-user NFL picks tracker: make straight-up (SU), against-the-spread
(ATS), and over/under picks on every game, and track your record against
both the market and the app's own prediction model. The model's calls are
backed by two from-scratch systems:

- **GEI (Gridiron Efficiency Index)** — an opponent-adjusted power ranking
  (`backend/power_ranking.py`), built as a transparent, from-scratch
  alternative to ESPN FPI / Football Outsiders' DVOA (whose real methodology
  isn't public).
- **The recommendation engine** (`backend/analysis.py`) — a heuristic scorer
  for every game that blends recent form, GEI, injuries, weather, roster
  continuity, and a trained logistic regression into a lean on all three
  markets (SU / ATS / Total), with plain-English reasoning.

## Stack

- **Backend**: FastAPI (Python), Postgres (Supabase) in production, SQLite
  for local dev — `backend/`
- **Frontend**: React + TypeScript + Vite + Tailwind — `frontend/`
- **Ingestion**: `nfl_data_py` (nflverse) for historical/weekly stats, ESPN's
  unofficial API for live odds/scores/depth charts, Open-Meteo for weather —
  `ingestion/`
- **Scheduling**: GitHub Actions (`.github/workflows/cron.yml`) runs
  ingestion jobs directly against Postgres on a schedule — not routed
  through the backend
- **Hosting**: Render and/or Cloud Run (backend), Vercel (frontend),
  Supabase (database) — see `DEPLOYMENT.md`

## Quick start (local dev)

```bash
# backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.database                               # create the local SQLite schema

# one-time historical backfill (2021-2025 schedules, closing lines, results)
python -m ingestion.backfill_historical --start 2021 --end 2025
python -m ingestion.pbp_stats --start 2021 --end 2025     # play-by-play efficiency stats
python -m ingestion.ngs_stats --start 2021 --end 2025     # NextGen Stats
python -m ingestion.rosters --start 2021 --end 2025       # roster continuity
python -m ingestion.fpi                                   # current FPI ratings
python -m ingestion.qb_starters --start 2024 --end 2025   # recent QB usage

# frontend
cd frontend
npm install
```

Run both halves:

```bash
# terminal 1
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# terminal 2
cd frontend
npm run dev
```

Open the URL Vite prints — its dev server proxies `/api` to the backend
(see `frontend/vite.config.ts`), so no `VITE_API_BASE` is needed locally.

Keep odds/scores current while developing:

```bash
python -m ingestion.espn_odds              # one-off poll of this week's odds/scores
python -m ingestion.espn_odds --loop 900   # poll every 15 min, same as production
```

In production this (and every other recurring job) is scheduled by GitHub
Actions instead — see `.github/workflows/cron.yml` and `ingestion/tick.py`.

To train or retrain the prediction models:

```bash
python -m scripts.train_ats_model      # trains on <2025, backtests on 2025
python -m scripts.train_total_model    # same, for the Over/Under model
```

## Repository layout

### `backend/` — FastAPI app

| File | What it does |
|---|---|
| `main.py` | FastAPI app setup: CORS, router registration, startup DB init. |
| `database.py` | Connection handling — Postgres (`DATABASE_URL` set) or local SQLite. Owns `db_session()`, schema initialization, and SQLite's incremental column migrations. |
| `db_compat_pg.py` | Adapter so psycopg2 (Postgres) supports the same `row["col"]`-style access and `?`-placeholder SQL every query in this codebase is written with. Also batches bulk inserts via `execute_values`. |
| `auth.py` | Password hashing, JWT issuing/verification, the `get_current_user`/`require_admin` FastAPI dependencies. Admin access is identity-based (`ADMIN_EMAILS` env var), not a stored role. |
| `analysis.py` | The recommendation engine — scores every game on SU/ATS/Total independently from ~20 signals, returns a lean + plain-English reasons per market. See its module docstring for the full signal list. |
| `power_ranking.py` | GEI — the opponent-adjusted power ranking. See its module docstring for the full weighted-composite design. |
| `features.py` | Extracts the feature vector the trained models (`scripts/train_*.py`) are fit on, from the same signal functions `analysis.py` uses — so training never drifts from what the live heuristic actually computes. |
| `team_efficiency.py` | Recent-form efficiency aggregates (EPA/play, NextGen Stats) read by both `analysis.py` and `features.py`. |
| `roster_continuity.py` | Weights a past season's results by how much of the *current* roster was already on the team that year — discounts a rebuilt team's old history. |
| `historical_injury_signal.py` | Backtestable QB-stability/experience/injury-load signals, computed from real historical usage data (not live scraping) so they can be used as trained-model features. |
| `injuries.py` | Live QB/starter availability, scoped to the real depth chart (not just any rostered player). |
| `news.py` | Optional (`OPENAI_API_KEY`): real ESPN headlines for both teams, summarized into 1-2 sentences of qualitative context. |
| `stadiums.py` | Static lat/long per team's home stadium, for weather lookups. |
| `teams.py` | Static team metadata (abbreviation, name, ESPN logo, color) and `normalize_abbr` for nflverse/ESPN abbreviation mismatches. |
| `routers/auth.py` | `/api/auth/*` — signup, login, `/me`, password/display-name change, favorite teams. |
| `routers/games.py` | `/api/games/*` — game list/detail, recommendations, power rankings. Literal routes are registered before `/{game_id}` to avoid FastAPI's catch-all route-ordering trap. |
| `routers/picks.py` | `/api/picks/*` — create/update/delete picks, grading (win/loss/push) against closing lines. |
| `routers/dashboard.py` | `/api/dashboard/*` — the current user's SU/ATS/Total records, the leaderboard, and the vs-model comparison. |
| `routers/teams.py` | `/api/teams` — static team metadata list. |
| `routers/admin.py` | `/api/admin/*` — registered-user list, admin-only (`require_admin`). |
| `routers/tick.py` | HTTP-triggered equivalent of `python -m ingestion.tick`, kept for any ad-hoc/manual trigger over HTTP; the scheduled path is GitHub Actions running `ingestion/tick.py` directly. |

### `ingestion/` — data pipelines

| File | What it does |
|---|---|
| `tick.py` | Entry point for every scheduled job (`python -m ingestion.tick --job <name>`). `JOBS` dict maps a name to a function; see `.github/workflows/cron.yml` for the schedule. |
| `espn_odds.py` | Polls ESPN's unofficial API for the current week's live odds, scores, and status; auto-grades picks on games going final. |
| `backfill_historical.py` | One-time-per-range backfill of `games` (schedules, closing lines, results) from nflverse. |
| `pbp_stats.py` | Aggregates nflverse play-by-play into team-week efficiency stats (EPA/play, success rate, yards/play, 3rd-down%, red-zone%, turnovers). |
| `ngs_stats.py` | Aggregates nflverse NextGen Stats (tracking-chip data: time-to-throw, CPOE, separation, rush efficiency) to team-week level. |
| `qb_starters.py` | Identifies each team's actual starting QB per week from real usage (leading passer by attempts), with that week's own EPA/dropback and CPOE. |
| `rosters.py` | Backfills active-roster membership per team/season, used by `roster_continuity.py`. |
| `depth_chart.py` | Scrapes ESPN's team depth-chart pages (no JSON API exposes this) for live starter/backup status. |
| `historical_injuries.py` | Aggregates nflverse's official weekly injury reports, used to backtest the live injury signal. |
| `fpi.py` | Pulls ESPN's Football Power Index ratings. |
| `weather.py` | Fetches game-day forecasts for upcoming outdoor games via Open-Meteo. |

### `scripts/` — model training

| File | What it does |
|---|---|
| `train_ats_model.py` | Trains/backtests the logistic regression that predicts ATS cover probability. Saves `data/ats_model.joblib`, loaded by `analysis.py` if present. |
| `train_total_model.py` | Same, for Over/Under probability. Per its own docstring, this one is **not currently shipped** — it backtested below the "always pick Over" baseline and was deliberately not saved. |

### `db/` — schema

| File | What it does |
|---|---|
| `schema.sql` | SQLite schema (local dev). `database.py` also applies incremental `ALTER TABLE` migrations on top of this for columns added after initial release. |
| `schema_postgres.sql` | Postgres schema (production) — every column/index declared directly (no migration path needed; applied fresh via `CREATE TABLE IF NOT EXISTS`). |

### `frontend/src/`

| Path | What it does |
|---|---|
| `main.tsx` | React entry point. |
| `App.tsx` | Route table — maps every URL to its page component, wraps authenticated routes in `ProtectedRoute`. |
| `lib/api.ts` | The HTTP client — one function per backend endpoint, JWT attached automatically, 401s broadcast a logout event. |
| `lib/types.ts` | TypeScript types mirroring every backend response shape. |
| `lib/AuthContext.tsx` | Auth state (current user, login/signup/logout) via React context. |
| `lib/ThemeContext.tsx` | Light/dark theme state, persisted to `localStorage`. |
| `lib/usePickToggle.ts` | Shared pick-making logic (optimistic UI update, per-market request serialization) used by both the Picker and Game Detail pages. |
| `lib/teamAccent.ts` | Derives the app's accent color from the user's favorite team. |
| `lib/localTeams.ts` | Local fallback team metadata (used before the API's team list loads). |
| `components/Sidebar.tsx` | Desktop left rail + mobile bottom tab bar/"More" sheet navigation. |
| `components/GamePickCard.tsx` | The game card used on the Picker page — team records, SU/ATS/Total pick buttons, the "Edge" reasoning panel. |
| `components/TeamBadge.tsx` | Team logo rendering. |
| `components/RecordPill.tsx` | Small W-L(-T) record display chip, reused across several pages. |
| `components/ProtectedRoute.tsx` | Redirects to `/login` if not authenticated. |
| `components/TeamAccentSync.tsx` | Applies the favorite-team accent color to the document root. |
| `components/icons.tsx` | Hand-written SVG icon set (avoids an icon-library dependency). |
| `pages/Home.tsx` | Landing page — next game, this week's slate, SU/ATS/O-U record summary. |
| `pages/Picker.tsx` | Make picks for a given week; polls for recommendation-cache warmup on cold games. |
| `pages/MyPicks.tsx` | Full pick history, result-colored. |
| `pages/Games.tsx` | Full schedule/results list for a season/week. |
| `pages/GameDetail.tsx` | One game's full stats, odds history, and picks. |
| `pages/Record.tsx` | The current user's SU/ATS/Total record, by week and by team. |
| `pages/VsModel.tsx` | Side-by-side user-vs-model record, and every pick where they disagreed. |
| `pages/Leaderboard.tsx` | Every user's record, ranked by ATS win%. |
| `pages/PowerRankings.tsx` | The full GEI-ranked league table. |
| `pages/Settings.tsx` | Display name, favorite team, password change. |
| `pages/AdminUsers.tsx` | Registered-user list — admin-only, rendered only when `user.is_admin`. |
| `pages/Login.tsx` | Login/signup form. |

### Root

| File | What it does |
|---|---|
| `Dockerfile` | Builds the backend image; used by both Render and Cloud Run. Respects the `PORT` env var either host injects. |
| `render.yaml` | Render's Blueprint config — declares the backend service and its required env vars. |
| `requirements.txt` | Backend Python dependencies. |
| `DEPLOYMENT.md` | Full deploy walkthrough (Supabase, Render, Cloud Run, Vercel, GitHub Actions). |

## Tuning the model

See the "Pick Six Field Notes" doc (generated earlier, ask for a fresh copy
if needed) for a full walkthrough of every weight in GEI and the
recommendation engine, with exact file/line pointers for where to change
each one. Two rules worth repeating here:

1. Any change to `analysis.py`'s scoring needs `_RECOMMENDATION_SCHEMA_VERSION`
   bumped, or cached recommendations (6h TTL) keep serving the old math.
2. `features.py` imports GEI from `power_ranking.py` — a GEI weight change
   reaches the live Edge panel immediately, but the *trained* models stay
   blind to it until retrained (`python -m scripts.train_ats_model`).

## Known gaps

- `ingestion/pbp_stats.py` and `ingestion/ngs_stats.py` have no recurring
  scheduled job — `team_stats`/`ngs_team_stats` are backfilled for past
  seasons but nothing currently keeps the *current* season's rows updated
  week to week. Worth wiring into `ingestion/tick.py`'s `JOBS` and
  `.github/workflows/cron.yml` if GEI/efficiency signals start looking stale
  as a season progresses.
