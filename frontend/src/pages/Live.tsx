import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useSport } from "../lib/SportContext";
import { useTeams } from "../lib/useTeams";
import { usePolling } from "../lib/usePolling";
import type { LiveGameSummary, LivePick, LiveScoreboard } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";
import { LivePill, PickChip, statusText } from "../components/LiveBits";

const EASTERN = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const ymd = (d: Date) => EASTERN.format(d).replace(/-/g, "");

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

function dayText(day: string): string {
  return new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function groupNames(picks: LivePick[], market: string, statuses: string[]) {
  return Array.from(new Set(picks.filter((p) => p.market === market && statuses.includes(p.status)).map((p) => p.name)));
}

function GameCard({ g, sport, meId }: { g: LiveGameSummary; sport: string; meId: number }) {
  const meta = useTeams(sport as "nfl" | "nba");
  const mine = g.picks.filter((p) => p.user_id === meId);
  const others = g.picks.filter((p) => p.user_id !== meId);
  const away = meta(g.away.abbr);
  const home = meta(g.home.abbr);
  const leading = g.away.score !== null && g.home.score !== null ? (g.away.score > g.home.score ? "away" : g.home.score > g.away.score ? "home" : null) : null;

  const row = (side: "away" | "home", t: typeof away, s: LiveGameSummary["away"]) => {
    const dim = g.state === "post" && leading && leading !== side;
    return (
      <div className={`flex items-center gap-3 ${dim ? "opacity-55" : ""}`}>
        <TeamLogo team={t} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
            {t.name.split(" ").slice(-1)[0]}
            {g.situation?.possession === s.abbr && <span title="Has the ball" className="text-[10px]">🏈</span>}
          </div>
          <div className="text-[11px] text-[var(--text-faint)]">{s.record ?? ""}</div>
        </div>
        <div className={`font-display text-2xl tabular-nums ${leading === side ? "font-bold text-[var(--text)]" : "text-[var(--text-muted)]"}`}>{s.score ?? ""}</div>
      </div>
    );
  };

  const covering = groupNames(others, "ats", ["winning", "win"]);
  const notCovering = groupNames(others, "ats", ["losing", "loss"]);

  return (
    <Link to={`/live/${g.game_id}`} className="block rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 hover:border-[var(--accent)]/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <LivePill state={g.state}>{statusText(g, sport)}</LivePill>
        <span className="text-[11px] text-[var(--text-faint)]">{g.tv.join(" · ")}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {row("away", away, g.away)}
        {row("home", home, g.home)}
      </div>
      {g.state === "in" && g.situation && (g.situation.down_distance || g.situation.last_play) && (
        <div className="mt-3 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)]">
          {g.situation.down_distance && <span className={`font-semibold ${g.situation.red_zone ? "text-rose-500" : "text-[var(--text)]"}`}>{g.situation.down_distance}</span>}
          {g.situation.last_play && <div className="truncate mt-0.5 text-[11px] text-[var(--text-faint)]">{g.situation.last_play}</div>}
        </div>
      )}
      {g.odds && (g.odds.details || g.odds.over_under) && g.state !== "post" && (
        <div className="mt-2.5 text-[11px] text-[var(--text-faint)]">
          {g.odds.details}
          {g.odds.over_under ? ` · O/U ${g.odds.over_under}` : ""}
        </div>
      )}
      {(mine.length > 0 || others.length > 0) && (
        <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-col gap-1.5">
          {mine.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mr-1">You</span>
              {mine
                .sort((a, b) => ["straight_up", "ats", "total"].indexOf(a.market) - ["straight_up", "ats", "total"].indexOf(b.market))
                .map((p) => (
                  <PickChip key={p.market} p={p} />
                ))}
            </div>
          )}
          {(covering.length > 0 || notCovering.length > 0) && (
            <div className="text-[11px] text-[var(--text-muted)]">
              {covering.length > 0 && (
                <span>
                  <b className="text-emerald-500">Covering:</b> {covering.join(", ")}
                </span>
              )}
              {covering.length > 0 && notCovering.length > 0 && <span className="mx-1.5 text-[var(--border)]">|</span>}
              {notCovering.length > 0 && (
                <span>
                  <b className="text-rose-500">Not:</b> {notCovering.join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Link>
  );
}

export function LivePage() {
  const { user } = useAuth();
  const { sport } = useSport();
  const isNba = sport === "nba";
  const [day, setDay] = useState<string>(() => ymd(new Date()));
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [data, setData] = useState<LiveScoreboard | null>(null);
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState<number>(0);
  const [, tick] = useState(0);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const r = await api.liveScoreboard(isNba ? { date: day } : { week });
      if (id !== requestId.current) return;
      setData(r);
      setError(false);
      setUpdated(Date.now());
      if (!isNba && week === undefined && r.week) setWeek(r.week);
    } catch {
      if (id === requestId.current) setError(true);
    }
  }, [isNba, day, week]);

  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNba, day, week, sport]);

  usePolling(load, data?.live ? 15000 : 60000);
  usePolling(() => tick((n) => n + 1), 5000);

  const games = data?.games ?? [];
  const liveCount = games.filter((g) => g.state === "in").length;
  const ago = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  const sections = useMemo(
    () => [
      { title: "Live now", list: games.filter((g) => g.state === "in") },
      { title: "Upcoming", list: games.filter((g) => g.state === "pre") },
      { title: "Final", list: games.filter((g) => g.state === "post") },
    ].filter((s) => s.list.length),
    [games]
  );

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => (isNba ? setDay(shiftDay(day, -1)) : setWeek((w) => (w && w > 1 ? w - 1 : w)))}
            className="h-9 w-9 grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
            aria-label="Previous"
          >
            ‹
          </button>
          <div className="px-3 text-center leading-tight">
            <div className="font-display text-lg sm:text-xl font-bold text-[var(--text)]">{isNba ? dayText(day) : data?.week ? `Week ${data.week}` : "Live"}</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              {liveCount > 0 ? `${liveCount} live · ` : ""}
              {games.length} game{games.length === 1 ? "" : "s"}
              {ago !== null ? ` · updated ${ago < 5 ? "just now" : `${ago}s ago`}` : ""}
            </div>
          </div>
          <button
            onClick={() => (isNba ? setDay(shiftDay(day, 1)) : setWeek((w) => (w ? w + 1 : w)))}
            className="h-9 w-9 grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
            aria-label="Next"
          >
            ›
          </button>
        </div>
        {isNba && day !== ymd(new Date()) && (
          <button onClick={() => setDay(ymd(new Date()))} className="text-sm font-medium text-[var(--accent)]">
            Today
          </button>
        )}
        {!isNba && data?.week && week !== undefined && week !== data.week && (
          <button onClick={() => setWeek(undefined)} className="text-sm font-medium text-[var(--accent)]">
            Current week
          </button>
        )}
      </div>

      {error && !data && <div className="text-sm text-[var(--text-muted)]">Live scores are unavailable right now. Trying again shortly.</div>}
      {!data && !error && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
      {data && games.length === 0 && <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--text-muted)]">No games on this {isNba ? "day" : "week"}.</div>}

      {sections.map((s) => (
        <section key={s.title}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">{s.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {s.list.map((g) => (
              <GameCard key={g.game_id} g={g} sport={sport} meId={user?.user_id ?? 0} />
            ))}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-[var(--text-faint)]">Scores come from ESPN and can run 10 to 30 seconds behind the broadcast. They refresh on their own while games are live.</p>
    </div>
  );
}
