import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Game, LeaderboardEntry } from "../lib/types";

function fmtRecord(r: { wins: number; losses: number; pushes: number }) {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}

function currentWeekFor(allGames: Game[]): number | null {
  if (!allGames.length) return null;
  const upcoming = allGames.filter((g) => g.status !== "final");
  if (upcoming.length) return Math.min(...upcoming.map((g) => g.week));
  return Math.max(...allGames.map((g) => g.week));
}

const RANK_STYLES: Record<number, string> = {
  1: "text-amber-400",
  2: "text-[var(--text-muted)]",
  3: "text-orange-400",
};

export function LeaderboardPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [weekResolved, setWeekResolved] = useState(false);
  const [autoWeek, setAutoWeek] = useState(true);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setCurrentSeason(latest);
      setSeason((s) => s ?? latest);
    });
  }, []);

  useEffect(() => {
    if (season === null) return;
    if (autoWeek) setWeekResolved(false);
    api.games({ season }).then((g) => {
      setGames(g);
      if (autoWeek) {
        const live = currentWeekFor(g);
        setWeek(live);
      }
      setWeekResolved(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    if (!weekResolved || season === null) return;
    const id = ++requestId.current;
    setEntries(null);
    api.leaderboard({ season, week: week ?? undefined }).then((r) => {
      if (id === requestId.current) setEntries(r.entries);
    });
  }, [season, week, weekResolved]);

  const availableWeeks = useMemo(() => Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b), [games]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Leaderboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Ranked by ATS win%. Straight-up shown separately.</p>
        </div>
        {currentSeason !== null && season !== null && (
          <div className="flex gap-2 items-center">
            <select
              value={season}
              onChange={(e) => {
                setAutoWeek(true);
                setSeason(Number(e.target.value));
              }}
              className="input"
            >
              {[currentSeason, currentSeason - 1, currentSeason - 2].map((s) => (
                <option key={s} value={s}>
                  {s} Season
                </option>
              ))}
            </select>
            <select
              value={week ?? "all"}
              onChange={(e) => {
                setAutoWeek(false);
                setWeek(e.target.value === "all" ? null : Number(e.target.value));
              }}
              className="input"
            >
              {availableWeeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
              <option value="all">All Time</option>
            </select>
            {(season !== currentSeason || !autoWeek) && (
              <button
                onClick={() => {
                  setAutoWeek(true);
                  if (season !== currentSeason) setSeason(currentSeason);
                  else setWeek(currentWeekFor(games));
                }}
                className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent)]/80 px-2 py-1.5"
              >
                ↻ Jump to current week
              </button>
            )}
          </div>
        )}
      </div>

      {entries === null && <div className="text-[var(--text-muted)] text-sm">Loading…</div>}

      {entries !== null && entries.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm">
          No graded picks {week !== null ? "for this week" : "yet"} — check back once games are final.
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <>

          <div className="hidden sm:block rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
            <div className="grid grid-cols-[2.5rem_1fr_5rem_4rem_5rem_4rem] gap-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)]">
              <span>#</span>
              <span>Player</span>
              <span className="text-right">SU</span>
              <span className="text-right">SU%</span>
              <span className="text-right">ATS</span>
              <span className="text-right">ATS%</span>
            </div>
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {entries.map((e) => (
                <div
                  key={e.user_id}
                  className={`grid grid-cols-[2.5rem_1fr_5rem_4rem_5rem_4rem] gap-2 px-4 py-3 items-center ${
                    e.is_you ? "bg-[var(--accent)]/[0.06]" : ""
                  }`}
                >
                  <span className={`font-display font-bold text-sm ${RANK_STYLES[e.rank] ?? "text-[var(--text-faint)]"}`}>{e.rank}</span>
                  <span className="text-sm font-medium text-[var(--text)] truncate flex items-center gap-2">
                    {e.display_name}
                    {e.is_you && <YouBadge />}
                  </span>
                  <span className="text-sm text-[var(--text-muted)] text-right tabular-nums">{fmtRecord(e.straight_up)}</span>
                  <span className="text-sm text-[var(--text-muted)] text-right tabular-nums">
                    {e.straight_up.win_pct != null ? `${e.straight_up.win_pct}%` : "—"}
                  </span>
                  <span className="text-sm text-[var(--text-muted)] text-right tabular-nums">{fmtRecord(e.ats)}</span>
                  <span className="text-sm font-semibold text-[var(--text)] text-right tabular-nums">
                    {e.ats.win_pct != null ? `${e.ats.win_pct}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>


          <div className="sm:hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden divide-y divide-[var(--border)]">
            {entries.map((e) => (
              <div key={e.user_id} className={`flex items-center gap-3 px-4 py-3 ${e.is_you ? "bg-[var(--accent)]/[0.06]" : ""}`}>
                <span className={`font-display font-bold text-sm w-5 shrink-0 text-center ${RANK_STYLES[e.rank] ?? "text-[var(--text-faint)]"}`}>
                  {e.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)] truncate">{e.display_name}</span>
                    {e.is_you && <YouBadge />}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5 tabular-nums">
                    SU {fmtRecord(e.straight_up)} ({e.straight_up.win_pct != null ? `${e.straight_up.win_pct}%` : "—"}) · ATS{" "}
                    {fmtRecord(e.ats)}
                  </div>
                </div>
                <span className="text-base font-semibold text-[var(--text)] text-right tabular-nums shrink-0">
                  {e.ats.win_pct != null ? `${e.ats.win_pct}%` : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function YouBadge() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-1.5 py-0.5 shrink-0">
      You
    </span>
  );
}
