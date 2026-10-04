-- NFL betting tracker schema (SQLite)

CREATE TABLE IF NOT EXISTS games (
    game_id             TEXT PRIMARY KEY,
    season              INTEGER NOT NULL,
    week                INTEGER NOT NULL,
    game_type           TEXT NOT NULL DEFAULT 'REG',   -- REG / POST
    home_team           TEXT NOT NULL,
    away_team           TEXT NOT NULL,
    kickoff_time        TEXT,                          -- ISO8601
    status              TEXT NOT NULL DEFAULT 'scheduled', -- scheduled / in_progress / final
    final_home_score    INTEGER,
    final_away_score    INTEGER,
    home_spread_close   REAL,   -- home team spread at close (negative = home favored)
    total_close         REAL,
    home_ml_close       INTEGER,
    away_ml_close       INTEGER,
    source              TEXT NOT NULL DEFAULT 'espn',   -- nflverse / espn
    stadium_id          TEXT,
    stadium             TEXT,
    roof                TEXT,    -- outdoors / dome / closed / open
    surface             TEXT,    -- grass / turf variants
    home_rest           INTEGER, -- days since each team's previous game
    away_rest           INTEGER,
    div_game            INTEGER, -- 1 if divisional matchup
    temp                REAL,    -- game-time temperature, Fahrenheit (recorded for past games, forecast for upcoming)
    wind                REAL,    -- game-time wind speed, mph
    precip_pct          REAL     -- forecast precipitation probability, % (upcoming games only)
);

CREATE INDEX IF NOT EXISTS idx_games_season_week ON games(season, week);

CREATE TABLE IF NOT EXISTS odds_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      TEXT NOT NULL REFERENCES games(game_id),
    provider     TEXT NOT NULL,
    captured_at  TEXT NOT NULL,   -- ISO8601
    home_spread  REAL,
    total        REAL,
    home_ml      INTEGER,
    away_ml      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_odds_game ON odds_snapshots(game_id);
CREATE INDEX IF NOT EXISTS idx_odds_captured ON odds_snapshots(captured_at);

CREATE TABLE IF NOT EXISTS fpi_ratings (
    team          TEXT PRIMARY KEY,
    season        INTEGER NOT NULL,
    fpi           REAL,     -- ESPN Football Power Index: expected point margin vs an average opponent on a neutral field
    fpi_rank      INTEGER,
    off_epa       REAL,
    def_epa       REAL,
    st_epa        REAL,     -- special teams
    wins          INTEGER,
    losses        INTEGER,
    updated_at    TEXT NOT NULL
);

-- Team-week NextGen Stats, aggregated (volume-weighted) from nflverse's
-- player-level NGS feeds (ingestion/ngs_stats.py). Tracking-data quality
-- signals EPA alone doesn't capture: pass rush pressure proxy (time to
-- throw), qb aggressiveness/accuracy above expectation, receiver separation,
-- rush efficiency above expectation.
CREATE TABLE IF NOT EXISTS ngs_team_stats (
    season                  INTEGER NOT NULL,
    week                    INTEGER NOT NULL,
    team                    TEXT NOT NULL,
    avg_time_to_throw       REAL,
    aggressiveness          REAL,
    cpoe                    REAL,   -- completion % above expectation
    avg_separation          REAL,
    avg_cushion             REAL,
    yac_above_expectation   REAL,
    rush_efficiency         REAL,
    rush_yards_over_expected_per_att REAL,
    updated_at              TEXT,
    PRIMARY KEY (season, week, team)
);

-- Team's leading passer (by attempts) each week, from actual usage
-- (ingestion/qb_starters.py) — more reliable for backtesting than a
-- historical depth chart (which doesn't exist as a free data source): who
-- actually took the QB snaps that week is ground truth, not a guess.
CREATE TABLE IF NOT EXISTS qb_starters (
    season          INTEGER NOT NULL,
    week            INTEGER NOT NULL,
    team            TEXT NOT NULL,
    player_id       TEXT,
    player_name     TEXT NOT NULL,
    attempts        INTEGER NOT NULL,
    -- Efficiency of that week's leading passer specifically (not the team
    -- blended) — feeds the Gridiron Efficiency Index's QB ranking component.
    dropbacks       INTEGER,   -- pass attempts + sacks taken
    epa_dropback    REAL,      -- EPA per dropback
    cpoe            REAL,      -- completion % over expected
    yards_per_att   REAL,
    success_rate    REAL,      -- share of dropbacks graded "successful" (nflverse's own definition)
    updated_at      TEXT,
    PRIMARY KEY (season, week, team)
);

-- Official weekly injury report counts per team, from nflverse
-- (ingestion/historical_injuries.py) — used to backtest the "banged up"
-- signal the live model gets from the current depth chart/injury report.
CREATE TABLE IF NOT EXISTS historical_injury_counts (
    season            INTEGER NOT NULL,
    week              INTEGER NOT NULL,
    team              TEXT NOT NULL,
    impact_out_count  INTEGER NOT NULL,  -- impact-position players listed Out/Doubtful
    qb_listed_out     INTEGER NOT NULL,  -- 1 if any rostered QB was listed Out/Doubtful
    updated_at        TEXT,
    PRIMARY KEY (season, week, team)
);

-- One row per player who was on a team's active roster in a season. Used to
-- compute roster continuity (how much of a team's current roster overlaps
-- with a past season) so historical form can be weighted by "does this
-- history still reflect who's actually on the team" rather than flat recency.
CREATE TABLE IF NOT EXISTS rosters (
    season      INTEGER NOT NULL,
    team        TEXT NOT NULL,
    player_id   TEXT NOT NULL,
    position    TEXT,
    PRIMARY KEY (season, team, player_id)
);

CREATE INDEX IF NOT EXISTS idx_rosters_team_season ON rosters(team, season);

-- True positional depth chart (starter, 2nd string, 3rd string...), scraped
-- from ESPN's team depth chart page (the JSON REST endpoints don't expose
-- this — checked several variants, all empty/404 — but the page embeds it
-- as server-rendered JSON). This is what lets injury signals be scoped to
-- "does this affect the starter" instead of any rostered player.
CREATE TABLE IF NOT EXISTS depth_chart (
    team           TEXT NOT NULL,
    position       TEXT NOT NULL,   -- e.g. QB, RB, LT, LDE, FS — offense/defense/ST slot, not the generic roster position
    depth_rank     INTEGER NOT NULL, -- 1 = starter, 2 = backup, ...
    player_id      TEXT,
    player_name    TEXT NOT NULL,
    injury_status  TEXT,            -- abbreviation embedded alongside depth (O/Q/IR/SUS/PUP/D), NULL if healthy
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (team, position, depth_rank)
);

CREATE INDEX IF NOT EXISTS idx_depth_chart_team ON depth_chart(team);

-- Team-week efficiency stats aggregated from nflverse play-by-play
-- (ingestion/pbp_stats.py). epa/success/wpa here are nflverse's own
-- precomputed per-play values (their published EP/WP models) — we aggregate,
-- we don't refit those models ourselves.
-- Cached OpenAI-generated qualitative note per game, built from real ESPN
-- news headlines (practice reports, beat-writer notes) that structured data
-- (depth chart, injury status) doesn't capture — e.g. "coach hinted X will
-- play limited snaps." Cached so repeat page views don't re-spend credits;
-- see backend/news.py.
-- Cached build_recommendation() output, keyed by game. Computing one is
-- expensive (15-20+ queries plus, for scheduled games, a model inference
-- call) and the underlying signals (odds, injuries, FPI) only actually
-- change on the ingestion ticks' own cadence (15min-6h), so recomputing on
-- every single page view was pure waste. See backend/routers/games.py.
CREATE TABLE IF NOT EXISTS recommendation_cache (
    game_id       TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,   -- JSON-serialized recommendation dict
    generated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_notes (
    game_id       TEXT PRIMARY KEY,
    note          TEXT,     -- NULL means "checked, nothing notable" (still cached)
    generated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_stats (
    season              INTEGER NOT NULL,
    week                INTEGER NOT NULL,
    team                TEXT NOT NULL,
    plays_offense       INTEGER,
    off_epa_play        REAL,   -- offensive EPA per play
    off_epa_pass        REAL,
    off_epa_rush        REAL,
    off_success_rate    REAL,
    off_yards_play       REAL,  -- offensive yards per scrimmage play
    pass_rate           REAL,   -- share of offensive scrimmage plays that were passes
    def_epa_play        REAL,   -- EPA per play allowed
    def_success_rate    REAL,   -- success rate allowed
    def_yards_play      REAL,   -- yards per scrimmage play allowed
    third_down_pct      REAL,   -- offense: 3rd-down conversion rate
    third_down_pct_def  REAL,   -- defense: 3rd-down conversion rate allowed
    red_zone_td_pct     REAL,   -- offense: % of red-zone drives ending in a TD
    red_zone_td_pct_def REAL,   -- defense: same, allowed
    turnovers_lost      INTEGER,
    turnovers_forced    INTEGER,
    turnover_margin     INTEGER,
    points_for          INTEGER,
    points_against      INTEGER,
    updated_at          TEXT,
    PRIMARY KEY (season, week, team)
);

CREATE TABLE IF NOT EXISTS users (
    user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT NOT NULL,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_favorite_teams (
    user_id     INTEGER NOT NULL REFERENCES users(user_id),
    team        TEXT NOT NULL,
    PRIMARY KEY (user_id, team)
);

CREATE TABLE IF NOT EXISTS picks (
    pick_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER REFERENCES users(user_id),
    game_id            TEXT NOT NULL REFERENCES games(game_id),
    pick_type          TEXT NOT NULL,   -- straight_up / ats / total
    selection           TEXT NOT NULL,   -- team abbreviation, or 'over'/'under' for total picks
    line_at_pick_time  REAL,
    stake              REAL,
    result             TEXT NOT NULL DEFAULT 'pending',  -- win / loss / push / pending
    notes              TEXT,
    created_at         TEXT NOT NULL,
    -- Snapshot of the model's own call at the moment this pick was made, so
    -- the comparison doesn't drift as later signals (injuries, odds, FPI)
    -- change the live recommendation. NULL for 'total' picks (model doesn't
    -- predict those) or if the recommendation engine failed at pick time.
    model_lean         TEXT,     -- team abbreviation the model favored
    model_confidence   REAL,
    model_line         REAL,     -- spread used for the model's ATS grading
    model_result       TEXT NOT NULL DEFAULT 'pending'  -- win / loss / push / pending / n_a
);

CREATE INDEX IF NOT EXISTS idx_picks_game ON picks(game_id);
-- The one-pick-per-user/game/market unique index is created in
-- database.py's _migrate() instead of here: on an existing table with
-- duplicate rows already in it (the bug this fixes), creating it here as
-- part of the plain executescript would fail outright and break init_db()
-- for every future run. _migrate() dedupes first, then creates it.
CREATE INDEX IF NOT EXISTS idx_picks_result ON picks(result);

CREATE TABLE IF NOT EXISTS qb_baseline (
    team         TEXT PRIMARY KEY,
    season       INTEGER NOT NULL,
    player_name  TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
