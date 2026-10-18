import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { Game, DashboardSummary, VsModelSummary, Recommendation, Record as PickRecord } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";
import { useSport } from "../lib/SportContext";

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

function HomeNfl() {
  const { user } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [vsModel, setVsModel] = useState<VsModelSummary | null>(null);
  const [nextRec, setNextRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setSeason(latest);
      Promise.all([api.games({ season: latest }), api.dashboard({ season: latest }), api.vsModel()]).then(([g, d, v]) => {
        setGames(g);
        setDashboard(d);
        setVsModel(v);
        setLoading(false);
      });
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
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">The Numbers{season ? ` · ${season} Season` : ""}</h2>
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

export function Home() {
  const { sport } = useSport();
  return sport === "nba" ? <HomeNba /> : <HomeNfl />;
}

const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

function HomeNba() {
  const { user } = useAuth();
  const [season, setSeason] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.seasons().then(async (list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      if (cancelled) return;
      setSeason(latest);
      const [d, weeks] = await Promise.all([api.dashboard({ season: latest }), api.weeks(latest)]);
      const slate = weeks.current_week !== null ? await api.games({ season: latest, week: weeks.current_week }) : [];
      if (cancelled) return;
      setDashboard(d);
      setGames(slate);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = useMemo(() => {
    const open = games.filter((g) => g.status === "scheduled" && g.kickoff_time);
    const today = EASTERN_DAY.format(new Date());
    const dayOf = (g: Game) => EASTERN_DAY.format(new Date(g.kickoff_time!));
    const days = Array.from(new Set(open.map(dayOf))).sort();
    const next = days.find((d) => d >= today) ?? days[0];
    return next ? { day: next, games: open.filter((g) => dayOf(g) === next) } : null;
  }, [games]);

  const favorite = user?.favorite_nba_team ?? null;
  const favoriteGame = useMemo(() => {
    if (!favorite) return null;
    const mine = games.filter((g) => g.status === "scheduled" && g.kickoff_time && (g.home_team === favorite || g.away_team === favorite));
    if (!mine.length) return null;
    return mine.reduce((a, b) => (new Date(a.kickoff_time!) < new Date(b.kickoff_time!) ? a : b));
  }, [games, favorite]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-6 text-[var(--text-muted)] text-sm">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-10">
      {!favorite && (
        <Link to="/settings" className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors -mb-4">
          Pick a favorite NBA team to personalize this page →
        </Link>
      )}

      {favorite && favoriteGame && (
        <Link
          to="/picker"
          className="block rounded-2xl border border-[var(--accent)]/20 bg-gradient-to-br from-[var(--accent)]/[0.07] via-transparent to-[var(--accent)]/[0.08] shadow-sm p-6 md:p-8 hover:border-[var(--accent)]/40 transition-colors"
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">Your Team Next Up</span>
            {countdown(favoriteGame.kickoff_time) && (
              <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-3 py-1">
                Tips off in {countdown(favoriteGame.kickoff_time)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-center gap-6 md:gap-14 mb-6">
            <TeamHero team={favoriteGame.away} score={null} />
            <span className="font-display text-2xl text-[var(--text-faint)]">@</span>
            <TeamHero team={favoriteGame.home} score={null} />
          </div>
          <div className="text-center text-sm text-[var(--text-muted)] mb-3">{fmtKickoff(favoriteGame.kickoff_time)}</div>
          {(favoriteGame.current_spread ?? favoriteGame.home_spread_close) !== null && (
            <div className="flex justify-center">
              <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-hover)] border border-[var(--border)] rounded-full px-3 py-1.5">
                Line: {favoriteGame.home_team} {(favoriteGame.current_spread ?? favoriteGame.home_spread_close)! > 0 ? "+" : ""}
                {favoriteGame.current_spread ?? favoriteGame.home_spread_close}
              </span>
            </div>
          )}
        </Link>
      )}

      {favorite && !favoriteGame && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-6 text-center text-[var(--text-muted)] text-sm">
          No upcoming game for {favorite} on the current slate yet.
        </div>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
          Your NBA record{season ? ` · ${season}-${String(season + 1).slice(2)}` : ""}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Straight up" value={fmtRecord(dashboard?.straight_up)} sub={dashboard?.straight_up.win_pct != null ? `${dashboard.straight_up.win_pct}%` : undefined} accent="cyan" />
          <StatCard label="Against the spread" value={fmtRecord(dashboard?.ats)} sub={dashboard?.ats.win_pct != null ? `${dashboard.ats.win_pct}%` : undefined} accent="cyan" />
          <StatCard label="Over / under" value={fmtRecord(dashboard?.total)} sub={dashboard?.total.win_pct != null ? `${dashboard.total.win_pct}%` : undefined} accent="cyan" />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
            {upcoming ? `Games on ${new Date(`${upcoming.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}` : "Games"}
          </h2>
          <Link to="/picker" className="text-xs font-medium text-[var(--accent)]">
            Make your picks →
          </Link>
        </div>
        {!upcoming && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm">
            No upcoming NBA games yet{user ? "" : ""}. Check back once the schedule is posted.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {upcoming?.games.map((g) => {
            const spread = g.current_spread ?? g.home_spread_close;
            return (
              <Link
                key={g.game_id}
                to="/picker"
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 hover:border-[var(--accent)]/30 hover:bg-[var(--surface-hover)] transition-colors"
              >
                <TeamLogo team={g.away} size={26} />
                <span className="text-sm font-semibold text-[var(--text)]">{g.away.abbr}</span>
                <span className="text-[10px] text-[var(--text-faint)]">@</span>
                <TeamLogo team={g.home} size={26} />
                <span className="text-sm font-semibold text-[var(--text)]">{g.home.abbr}</span>
                <span className="ml-auto text-right text-[11px] text-[var(--text-muted)] leading-tight">
                  <span className="block">{new Date(g.kickoff_time!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                  {spread !== null && <span className="block">{g.home.abbr} {spread > 0 ? "+" : ""}{spread}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
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
