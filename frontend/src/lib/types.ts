export interface TeamMeta {
  abbr: string;
  name: string;
  logo: string;
  color: string;
}

export interface User {
  user_id: number;
  email: string;
  display_name: string;
  favorite_teams: string[];
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
  pending_count: number;
  by_team: Record_<string, Record>;
  by_week: Record_<string, { straight_up: Record; ats: Record }>;
  break_even_pct: number;
}

type Record_<K extends string, V> = { [key in K]: V };

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

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  display_name: string;
  is_you: boolean;
  straight_up: Record;
  ats: Record;
  decided_count: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
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
}
