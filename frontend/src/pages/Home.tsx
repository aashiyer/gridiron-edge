import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { Game, DashboardSummary, VsModelSummary, Recommendation, Record as PickRecord } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";

function fmtRecord(record?: PickRecord) {
  if (!record) return "—";
  return `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""}`;
}

function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  const diff = d - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function Home() {
  const { user } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [vsModel, setVsModel] = useState<VsModelSummary | null>(null);
  const [nextRec, setNextRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const season = new Date().getFullYear();
    Promise.all([api.games({ season }), api.dashboard(), api.vsModel()]).then(([g, d, v]) => {
      setGames(g);
      setDashboard(d);
      setVsModel(v);
      setLoading(false);
    });
  }, []);

  const favoriteTeams = useMemo(() => user?.favorite_teams ?? [], [user]);

  const nextGame = useMemo(() => {
    const upcoming = games.filter((g) => g.status === "scheduled" && g.kickoff_time);
    if (!upcoming.length) return null;
    const favoriteUpcoming = upcoming.filter(
      (g) => favoriteTeams.includes(g.home_team) || favoriteTeams.includes(g.away_team)
    );
    const pool = favoriteUpcoming.length ? favoriteUpcoming : upcoming;
    return pool.reduce((a, b) => (new Date(a.kickoff_time!) < new Date(b.kickoff_time!) ? a : b));
  }, [games, favoriteTeams]);

  const thisWeek = useMemo(() => {
    if (!nextGame) return [];
    return games
      .filter((g) => g.week === nextGame.week && g.status === "scheduled" && g.game_id !== nextGame.game_id)
      .sort((a, b) => new Date(a.kickoff_time ?? 0).getTime() - new Date(b.kickoff_time ?? 0).getTime())
      .slice(0, 6);
  }, [games, nextGame]);

  useEffect(() => {
    if (nextGame) api.recommendation(nextGame.game_id).then(setNextRec);
  }, [nextGame]);

  const heroIsFavorite = !!nextGame && (favoriteTeams.includes(nextGame.home_team) || favoriteTeams.includes(nextGame.away_team));

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6 text-[var(--text-muted)] text-sm">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-10">
      {!favoriteTeams.length && (
        <Link
          to="/settings"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors -mb-4"
        >
          Pick a favorite team to personalize this page →
        </Link>
      )}


      {nextGame ? (
        <Link
          to={`/games/${nextGame.game_id}`}
          className="block rounded-2xl border border-[var(--accent)]/20 bg-gradient-to-br from-[var(--accent)]/[0.07] via-transparent to-[var(--accent)]/[0.08] shadow-sm p-6 md:p-8 hover:border-[var(--accent)]/40 transition-colors"
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">
              {heroIsFavorite ? "Your Team Next Up" : "Next Up"} · Week {nextGame.week}
            </span>
            {countdown(nextGame.kickoff_time) && (
              <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-3 py-1">
                Kicks off in {countdown(nextGame.kickoff_time)}
              </span>
            )}
          </div>

          <div className="flex items-center justify-center gap-6 md:gap-14 mb-6">
            <TeamHero team={nextGame.away} score={null} />
            <span className="font-display text-2xl text-[var(--text-faint)]">@</span>
            <TeamHero team={nextGame.home} score={null} />
          </div>

          <div className="text-center text-sm text-[var(--text-muted)] mb-5">{fmtKickoff(nextGame.kickoff_time)}</div>

          {nextRec && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <EdgeBadge label="Straight Up" team={nextRec.lean_straight_up} />
              <EdgeBadge label="ATS" team={nextRec.lean_ats} />
              <EdgeBadge label="Total" team={nextRec.lean_total ? (nextRec.lean_total === "over" ? "Over" : "Under") : null} />
              {(nextGame.current_spread ?? nextGame.home_spread_close) !== null && (
                <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-hover)] border border-[var(--border)] rounded-full px-3 py-1.5">
                  Line: {nextGame.home_team} {(nextGame.current_spread ?? nextGame.home_spread_close)! > 0 ? "+" : ""}
                  {nextGame.current_spread ?? nextGame.home_spread_close}
                </span>
              )}
            </div>
          )}
        </Link>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)]">
          No upcoming games sourced yet.
        </div>
      )}


      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">The Numbers</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Your Record · SU"
            value={fmtRecord(dashboard?.straight_up)}
            sub={dashboard?.straight_up.win_pct != null ? `${dashboard.straight_up.win_pct}%` : undefined}
            accent="cyan"
          />
          <StatCard
            label="Your Record · ATS"
            value={fmtRecord(dashboard?.ats)}
            sub={dashboard?.ats.win_pct != null ? `${dashboard.ats.win_pct}%` : undefined}
            accent="cyan"
          />
          <StatCard
            label="Your Record · O/U"
            value={fmtRecord(dashboard?.total)}
            sub={dashboard?.total.win_pct != null ? `${dashboard.total.win_pct}%` : undefined}
            accent="cyan"
          />
          <StatCard
            label="Model's Record · SU"
            value={vsModel && vsModel.comparable_picks > 0 ? fmtRecord(vsModel.model_record_su) : "—"}
            sub={vsModel?.model_record_su.win_pct != null ? `${vsModel.model_record_su.win_pct}%` : undefined}
            accent="violet"
          />
          <StatCard
            label="Model's Record · ATS"
            value={vsModel && vsModel.comparable_picks > 0 ? fmtRecord(vsModel.model_record_ats) : "—"}
            sub={vsModel?.model_record_ats.win_pct != null ? `${vsModel.model_record_ats.win_pct}%` : undefined}
            accent="violet"
          />
          <StatCard
            label="Model's Record · O/U"
            value={vsModel && vsModel.comparable_picks > 0 ? fmtRecord(vsModel.model_record_total) : "—"}
            sub={vsModel?.model_record_total.win_pct != null ? `${vsModel.model_record_total.win_pct}%` : undefined}
            accent="violet"
          />
          <StatCard
            label="Backtested Accuracy"
            value={nextRec?.model_prediction ? `${(nextRec.model_prediction.test_acc * 100).toFixed(1)}%` : "—"}
            sub={nextRec?.model_prediction ? `ATS, ${nextRec.model_prediction.test_season} season` : undefined}
            accent="sky"
          />
          <StatCard
            label="You vs. Model Agreement"
            value={vsModel?.agreement_pct != null ? `${vsModel.agreement_pct}%` : "—"}
            sub={vsModel ? `${vsModel.agree_count} of ${vsModel.comparable_picks} picks` : undefined}
            accent="cyan"
          />
        </div>
      </section>


      {thisWeek.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">Rest of Week {nextGame?.week}</h2>
            <Link to="/picker" className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent)]">
              Full slate →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {thisWeek.map((g) => (
              <Link
                key={g.game_id}
                to="/picker"
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 hover:border-[var(--accent)]/30 hover:bg-[var(--surface-hover)] transition-colors"
              >
                <TeamLogo team={g.away} size={22} />
                <span className="text-xs text-[var(--text-muted)] font-medium">{g.away.abbr}</span>
                <span className="text-[10px] text-[var(--text-faint)]">@</span>
                <TeamLogo team={g.home} size={22} />
                <span className="text-xs text-[var(--text-muted)] font-medium">{g.home.abbr}</span>
                <span className="ml-auto text-[10px] text-[var(--text-faint)]">
                  {new Date(g.kickoff_time ?? "").toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TeamHero({ team, score }: { team: Game["home"]; score: number | null }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <TeamLogo team={team} size={72} />
      <span className="font-display text-lg font-bold text-[var(--text)]">{team.abbr}</span>
      {score !== null && <span className="text-sm text-[var(--text-muted)]">{score}</span>}
    </div>
  );
}

function EdgeBadge({ label, team }: { label: string; team: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm bg-[var(--surface-hover)] border border-[var(--border)] rounded-full px-3 py-1.5">
      <span className="text-[var(--text-faint)] text-xs">{label}</span>
      <span className="font-semibold text-emerald-400">{team ?? "No edge"}</span>
    </div>
  );
}

const ACCENT_STYLES: Record<string, string> = {
  cyan: "text-[var(--accent)]",
  violet: "text-[var(--accent)]",
  sky: "text-sky-400",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
      <span className={`font-display text-2xl font-bold ${ACCENT_STYLES[accent] ?? "text-[var(--text)]"}`}>{value}</span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}
