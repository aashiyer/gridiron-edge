import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PowerRankingEntry } from "../lib/types";
import { team_meta_lookup } from "../lib/localTeams";

const RANK_STYLES: Record<number, string> = {
  1: "text-amber-400",
  2: "text-[var(--text-muted)]",
  3: "text-orange-400",
};

export function PowerRankingsPage() {
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [entries, setEntries] = useState<PowerRankingEntry[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setCurrentSeason(latest);
      setSeason(latest);
    });
  }, []);

  useEffect(() => {
    if (season === null) return;
    setEntries(null);
    api
      .powerRankings({ season })
      .then((r) => {
        setEntries(Array.isArray(r.entries) ? r.entries : []);
        setWeek(r.week ?? null);
      })
      .catch(() => setEntries([]));
  }, [season]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Gridiron Efficiency Index</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Our own power ranking — opponent-adjusted EPA/play, yards/play, scoring margin (road games and bad-weather
            games count more), plus the starting QB's efficiency. Mostly this season, with a small weighted look back
            at the last 3.
          </p>
        </div>
        {currentSeason !== null && season !== null && (
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className="input">
            {[currentSeason, currentSeason - 1, currentSeason - 2, currentSeason - 3].map((s) => (
              <option key={s} value={s}>
                {s} Season
              </option>
            ))}
          </select>
        )}
      </div>
      {week !== null && <p className="text-xs text-[var(--text-faint)] mb-6">Through week {week}.</p>}

      {entries === null && <div className="text-[var(--text-muted)] text-sm mt-6">Loading…</div>}

      {entries !== null && entries.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm">
          No games graded yet this season.
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden divide-y divide-[var(--border)]">
          {entries.map((e) => {
            const meta = team_meta_lookup(e.team);
            return (
              <div key={e.team} className="flex items-center gap-3 px-4 py-3">
                <span className={`font-display font-bold text-sm w-6 shrink-0 text-center ${RANK_STYLES[e.rank] ?? "text-[var(--text-faint)]"}`}>
                  {e.rank}
                </span>
                {meta.logo && <img src={meta.logo} className="w-7 h-7 shrink-0" alt="" />}
                <span className="text-sm font-medium text-[var(--text)] flex-1">{meta.name}</span>
                <span className="text-sm font-semibold text-[var(--text)] tabular-nums">
                  {e.gei > 0 ? "+" : ""}
                  {e.gei.toFixed(3)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
