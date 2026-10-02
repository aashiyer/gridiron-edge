import type {
  Game,
  Pick,
  DashboardSummary,
  Recommendation,
  GameDetail,
  TeamMeta,
  VsModelSummary,
  LeaderboardResponse,
  User,
  AuthResponse,
  PowerRankingEntry,
  AdminUser,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE || "/api";
const TOKEN_KEY = "gridiron_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 40_000;

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      ...options,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(0, "The server is taking longer than expected to respond (it may be waking up from idle). Please try again.");
    }
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
    }
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export { ApiError };

export const api = {
  signup: (payload: { email: string; password: string; display_name: string }) =>
    req<AuthResponse>(`/auth/signup`, { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    req<AuthResponse>(`/auth/login`, { method: "POST", body: JSON.stringify(payload) }),
  me: () => req<User>(`/auth/me`),
  setFavoriteTeams: (teams: string[]) =>
    req<{ teams: string[] }>(`/auth/favorite-teams`, { method: "PUT", body: JSON.stringify({ teams }) }),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    req<{ status: string }>(`/auth/password`, { method: "POST", body: JSON.stringify(payload) }),
  changeDisplayName: (display_name: string) =>
    req<{ display_name: string }>(`/auth/display-name`, { method: "POST", body: JSON.stringify({ display_name }) }),

  games: (params: { season?: number; week?: number; team?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.season) qs.set("season", String(params.season));
    if (params.week) qs.set("week", String(params.week));
    if (params.team) qs.set("team", params.team);
    return req<Game[]>(`/games?${qs.toString()}`);
  },
  game: (gameId: string) => req<Game>(`/games/${gameId}`),
  recommendation: (gameId: string) => req<Recommendation>(`/games/${gameId}/recommendation`),
  gameDetail: (gameId: string) => req<GameDetail>(`/games/${gameId}/detail`),
  recommendations: (params: { season: number; week: number }) =>
    req<Record<string, Recommendation>>(`/games/recommendations?season=${params.season}&week=${params.week}`),
  seasons: () => req<number[]>(`/games/meta/seasons`),
  powerRankings: (params: { season: number; week?: number }) => {
    const qs = new URLSearchParams({ season: String(params.season) });
    if (params.week) qs.set("week", String(params.week));
    return req<{ season: number; week: number; entries: PowerRankingEntry[] }>(`/games/power-rankings?${qs.toString()}`);
  },

  picks: (params: { result?: string; pick_type?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.result) qs.set("result", params.result);
    if (params.pick_type) qs.set("pick_type", params.pick_type);
    return req<Pick[]>(`/picks?${qs.toString()}`);
  },
  createPick: (pick: {
    game_id: string;
    pick_type: string;
    selection: string;
    line_at_pick_time?: number | null;
    stake?: number | null;
    notes?: string | null;
  }) => req<Pick>(`/picks`, { method: "POST", body: JSON.stringify(pick) }),
  updatePick: (
    pickId: number,
    update: { selection?: string; line_at_pick_time?: number | null; stake?: number | null; notes?: string | null }
  ) => req<Pick>(`/picks/${pickId}`, { method: "PATCH", body: JSON.stringify(update) }),
  setPick: (body: { game_id: string; pick_type: string; selection: string | null; line_at_pick_time?: number | null }) =>
    req<Pick | { selection: null }>(`/picks/set`, { method: "PUT", body: JSON.stringify(body) }),
  deletePick: (pickId: number) => req<{ deleted: number }>(`/picks/${pickId}`, { method: "DELETE" }),

  dashboard: () => req<DashboardSummary>(`/dashboard`),
  vsModel: () => req<VsModelSummary>(`/dashboard/vs-model`),
  leaderboard: (params: { season?: number; week?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.season) qs.set("season", String(params.season));
    if (params.week) qs.set("week", String(params.week));
    return req<LeaderboardResponse>(`/dashboard/leaderboard?${qs.toString()}`);
  },
  teams: () => req<TeamMeta[]>(`/teams`),

  adminUsers: () => req<AdminUser[]>(`/admin/users`),
};
