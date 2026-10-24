export interface TeamMeta {
  abbr: string;
  name: string;
  logo: string;
  color: string;
  secondary: string;
}

export interface User {
  user_id: number;
  email: string;
  display_name: string;
  avatar_version: number;
  favorite_teams: string[];
  favorite_nba_team: string | null;
  is_admin: boolean;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, "favorite_teams" | "is_admin">;
}

export interface AdminUser {
  user_id: number;
  email: string;
  display_name: string;
  avatar_version: number;
  created_at: string;
  pick_count: number;
}

export interface Game {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  home_team: string;
  away_team: string;
  kickoff_time: string | null;
  status: "scheduled" | "in_progress" | "final";
  final_home_score: number | null;
  final_away_score: number | null;
  home_spread_close: number | null;
  total_close: number | null;
  home_ml_close: number | null;
  away_ml_close: number | null;
  source: string;
  current_spread: number | null;
  current_total: number | null;
  current_home_ml: number | null;
  current_away_ml: number | null;
  odds_updated_at: string | null;
  home: TeamMeta;
  away: TeamMeta;
}

export interface Pick {
  pick_id: number;
  game_id: string;
  pick_type: "straight_up" | "ats" | "total";
  selection: string;
  line_at_pick_time: number | null;
  graded_line: number | null;
  stake: number | null;
  result: "win" | "loss" | "push" | "pending";
  notes: string | null;
  created_at: string;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  kickoff_time: string | null;
  status: string;
  final_home_score: number | null;
  final_away_score: number | null;
  selection_meta: TeamMeta | null;
  model_lean: string | null;
  model_confidence: number | null;
  model_line: number | null;
  model_result: "win" | "loss" | "push" | "pending" | "n_a";
}

export interface Record {
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number | null;
}

export interface DashboardSummary {
  straight_up: Record;
  ats: Record;
  total: Record;
}

export interface Disagreement {
  pick_id: number;
  game_id: string;
  season: number;
  week: number;
  matchup: string;
  pick_type: string;
  your_pick: string;
  your_pick_meta: TeamMeta | null;
  model_pick: string;
  model_pick_meta: TeamMeta | null;
  your_result: string;
  model_result: string;
  final_score: string;
}

export type PickMarket = "straight_up" | "ats" | "total";

export interface PickCell {
  selection: string | null;
  line: number | null;
  result: "win" | "loss" | "push" | "pending";
  missed: boolean;
}

export interface WeekAward {
  week: number;
  win_pct: number;
  ats: Record;
}

export interface StandingsEntry {
  rank: number;
  user_id: number;
  display_name: string;
  avatar_version: number;
  is_you: boolean;
  straight_up: Record;
  ats: Record;
  total: Record;
  games_picked: number;
  games_available: number | null;
  best_week: WeekAward | null;
  worst_week: WeekAward | null;
  week_wins: number;
}

export interface StandingsResponse {
  season: number;
  weeks: { week: number; games: number; complete: boolean }[];
  current_week: number | null;
  entries: StandingsEntry[];
}

export interface WeekBoard {
  season: number;
  week: number;
  complete: boolean;
  users: { user_id: number; display_name: string; avatar_version: number; is_you: boolean }[];
  games: Game[];
  picks: { [gameId: string]: { [userId: string]: { [market: string]: PickCell } } };
  records: {
    [userId: string]: { straight_up: Record; ats: Record; total: Record; games_picked: number };
  };
}

export interface VsModelSummary {
  comparable_picks: number;
  pending_comparable: number;
  your_record_su: Record;
  your_record_ats: Record;
  your_record_total: Record;
  model_record_su: Record;
  model_record_ats: Record;
  model_record_total: Record;
  agreement_pct: number | null;
  agree_count: number;
  agree_and_won: number;
  agree_and_lost: number;
  disagree_count: number;
  you_right_on_disagree: number;
  model_right_on_disagree: number;
  both_wrong_on_disagree: number;
  disagreements: Disagreement[];
}

export interface Recommendation {
  game_id: string;
  home_team: string;
  away_team: string;
  lean_straight_up: string | null;
  confidence_straight_up: number;
  lean_ats: string | null;
  confidence_ats: number;
  lean_total: "over" | "under" | null;
  confidence_total: number;
  current_line: number | null;
  current_total: number | null;
  reasons: ReasonLine[];
  explanation: string;
  home_form: TeamForm;
  away_form: TeamForm;
  home_fpi: FpiRating;
  away_fpi: FpiRating;
  home_record: TeamRecord;
  away_record: TeamRecord;
  home_efficiency: TeamEfficiency | null;
  away_efficiency: TeamEfficiency | null;
  home_gei: GeiRating;
  away_gei: GeiRating;
  home_qb_status: QbStatus;
  away_qb_status: QbStatus;
  news_note: string | null;
  weather: WeatherInfo;
  model_prediction: ModelPrediction | null;
  model_prediction_total: ModelPredictionTotal | null;
  error?: string;
}

export interface ModelPrediction {
  prob_home_covers: number;
  test_season: number;
  test_acc: number;
}

export interface ModelPredictionTotal {
  prob_over: number;
  test_season: number;
  test_acc: number;
}

export interface ReasonLine {
  text: string;
  highlight: boolean;
}

export interface FpiRating {
  fpi: number | null;
  rank: number | null;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  ats_wins: number;
  ats_losses: number;
  ats_pushes: number;
}

export interface GeiRating {
  gei: number | null;
  rank: number | null;
}

export interface PowerRankingEntry {
  team: string;
  gei: number;
  rank: number;
}

export interface TeamForm {
  games_sampled: number;
  ats_covers: number;
  ats_decided: number;
  ats_pct: number | null;
  su_wins: number;
  su_decided: number;
  su_pct: number | null;
  avg_margin: number | null;
  streak_kind: "W" | "L" | null;
  streak_len: number;
}

export interface TeamEfficiency {
  games_sampled: number;
  off_epa_play: number | null;
  def_epa_play: number | null;
  off_success_rate: number | null;
  def_success_rate: number | null;
  third_down_pct: number | null;
  red_zone_td_pct: number | null;
  turnover_margin: number | null;
  pass_rate: number | null;
  cpoe: number | null;
  avg_separation: number | null;
  rush_yards_over_expected_per_att: number | null;
}

export interface QbStatus {
  starter_out: boolean;
  starter_questionable: boolean;
  starter: { player_name: string; injury_status: string | null } | null;
  likely_starter: { player_name: string; depth_rank: number; injury_status: string | null } | null;
}

export interface WeatherInfo {
  temp: number | null;
  wind: number | null;
  precip_pct: number | null;
  roof: string | null;
  bucket: string | null;
}

export interface DepthChartEntry {
  depth_rank: number;
  player_name: string;
  injury_status: string | null;
}

export type DepthChart = { [position: string]: DepthChartEntry[] };

export interface OddsSnapshot {
  id: number;
  game_id: string;
  provider: string;
  captured_at: string;
  home_spread: number | null;
  total: number | null;
  home_ml: number | null;
  away_ml: number | null;
}

export interface GameDetail {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  home_team: string;
  away_team: string;
  kickoff_time: string | null;
  status: string;
  final_home_score: number | null;
  final_away_score: number | null;
  home_spread_close: number | null;
  total_close: number | null;
  home_ml_close: number | null;
  away_ml_close: number | null;
  div_game: number | null;
  home_rest: number | null;
  away_rest: number | null;
  stadium: string | null;
  surface: string | null;
  roof: string | null;
  temp: number | null;
  wind: number | null;
  precip_pct: number | null;
  home: TeamMeta;
  away: TeamMeta;
  odds_history: OddsSnapshot[];
  home_depth_chart: DepthChart;
  away_depth_chart: DepthChart;
  recommendation: Recommendation | null;
  matchup?: NbaMatchup;
}

export interface NbaRecentGame {
  opp: string;
  home: boolean;
  result: "W" | "L";
  score: string;
  ats: "W" | "L" | "P" | null;
  day: string;
}

export interface NbaTeamStats {
  gp: number;
  ppg: number | null; opp_ppg: number | null; net: number | null;
  ortg: number | null; drtg: number | null; net_rtg: number | null; pace: number | null;
  efg: number | null; opp_efg: number | null; fg_pct: number | null; tp_pct: number | null; ft_pct: number | null; tpa: number | null;
  reb: number | null; ast: number | null; stl: number | null; blk: number | null; tov: number | null;
  paint: number | null; fastbreak: number | null;
}

export interface NbaTeamMatchup {
  record?: string;
  home_record?: string;
  away_record?: string;
  ats?: string;
  ats_pct?: number | null;
  ou?: string;
  stats?: NbaTeamStats;
  last5: NbaRecentGame[];
  streak: string | null;
  rest_days: number | null;
}

export interface NbaMatchup {
  home: NbaTeamMatchup;
  away: NbaTeamMatchup;
  h2h: { day: string; home: string; away: string; home_score: number; away_score: number }[];
}

export interface KalshiGame {
  win?: { home: number; away: number };
  spread?: { home: { [strike: string]: number }; away: { [strike: string]: number } };
  total?: { [strike: string]: number };
}

export interface ExportSlide {
  filename: string;
  image: string;
}

export interface RecordsPerson {
  user_id: number;
  display_name: string;
  avatar_version: number;
}

export interface WeekMark {
  season: number;
  week: number;
  label: string;
  win_pct: number;
  wins: number;
  losses: number;
  pushes: number;
}

export interface TrendPoint {
  season: number;
  week: number;
  label: string;
  cumulative_units: number;
  rolling_ats_pct: number | null;
  su_wins_over_500: number;
  rolling_su_pct: number | null;
  ats: Record;
  straight_up: Record;
}

export interface SeasonRow {
  season: number;
  ats: Record;
  ats_units: number;
  straight_up: Record;
  rank_ats: { rank: number; of: number } | null;
  rank_su: { rank: number; of: number } | null;
}

export interface SplitGroup {
  title: string;
  items: { label: string; record: Record }[];
}

export interface RecordsResponse {
  user: RecordsPerson;
  is_you: boolean;
  season: number | null;
  available_seasons: number[];
  people: RecordsPerson[];
  scorecard: {
    ats: Record;
    ats_units: number;
    straight_up: Record;
    decided_picks: number;
    rank_ats: { rank: number; of: number } | null;
    rank_su: { rank: number; of: number } | null;
    best_week_ats: WeekMark | null;
    worst_week_ats: WeekMark | null;
    best_week_su: WeekMark | null;
    worst_week_su: WeekMark | null;
  };
  trend: TrendPoint[];
  season_rows: SeasonRow[];
  splits: { ats: SplitGroup[]; straight_up: SplitGroup[] };
  teams: { ats: { [team: string]: Record }; straight_up: { [team: string]: Record } };
  team_meta: { [team: string]: TeamMeta };
}

export interface WeeksResponse {
  season: number;
  weeks: { week: number; games: number; complete: boolean; first_kickoff: string | null }[];
  current_week: number | null;
}

export interface EspnPlayer {
  name: string | null; short: string | null; jersey: string | null; position: string | null; headshot: string | null;
}

export interface NbaEspn {
  venue: { name: string | null; city: string | null; state: string | null; image: string | null; indoor: boolean } | null;
  attendance: number | null;
  officials: { name: string; role: string }[];
  broadcasts: string[];
  leaders: { [abbr: string]: (EspnPlayer & { category: string; value: string })[] };
  leaders_kind: "game" | "season";
  injuries: { [abbr: string]: (EspnPlayer & { status: string; detail: string | null; note: string | null; date: string | null })[] };
  standings: { [abbr: string]: { group: string; stats: { [name: string]: string } } };
  ats: { [abbr: string]: { label: string; record: string }[] };
  series: { summary: string; title: string }[];
  box: { [abbr: string]: { labels: string[]; players: (EspnPlayer & { starter: boolean; stats: { [label: string]: string } })[] } };
  odds: {
    provider: string | null; details: string | null; over_under: number | null; over_odds: number | null; under_odds: number | null;
    away_ml: number | null; home_ml: number | null; away_spread_odds: number | null; home_spread_odds: number | null;
  } | null;
}

export interface ModelWeekMark { label: string; wins: number; losses: number; pushes: number; win_pct: number }
export interface ModelSplitGroup { title: string; items: { label: string; record: Record }[] }
export interface ModelCall { game_id: string; label: string; season: number; week: number; lean: string; confidence: number; result: string; score: string }
export interface ModelPersonMarket {
  n: number; you: Record; model: Record; agree_pct: number | null; disagree: number; you_right: number; model_right: number; both_wrong: number;
}

export interface ModelStats {
  games_called: number;
  graded_games: number;
  available_seasons: number[];
  scorecard: {
    [m in "su" | "ats" | "total"]: {
      record: Record; units: number | null; pending: number;
      streaks: { current: { kind: string; length: number } | null; longest_win: number; longest_loss: number };
      best_week: ModelWeekMark | null; worst_week: ModelWeekMark | null;
    };
  };
  baselines: { always_favorite_su: Record; always_home_ats: Record; always_over: Record; always_under: Record };
  validation: { test_season: number | null; test_acc: number | null } | null;
  trend: { [m: string]: TrendPoint[] };
  weeks: { season: number; week: number; label: string; games: number; su: Record; ats: Record; total: Record; ats_units: number; complete: boolean }[];
  calibration: { [m: string]: { label: string; n: number; avg_conf: number; record: Record }[] };
  splits: { [m: string]: ModelSplitGroup[] };
  teams: { [m: string]: { [team: string]: { for: Record; against: Record } } };
  extremes: { [m: string]: { hits: ModelCall[]; misses: ModelCall[] } };
  people: { user_id: number; display_name: string; avatar_version: number; markets: { [m: string]: ModelPersonMarket } }[];
  crowd: { [m: string]: { crowd: Record; model: Record; games: number } };
  disagreements: {
    game_id: string; season: number; week: number; matchup: string; market: string; your_pick: string; model_pick: string;
    your_result: string; model_result: string; score: string;
  }[];
  you: number;
  user_id: number;
  team_meta: { [team: string]: TeamMeta };
}
