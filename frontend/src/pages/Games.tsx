import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Game } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";

function currentWeekFor(allGames: Game[]): number | null {
  if (!allGames.length) return null;
  const upcoming = allGames.filter((g) => g.status !== "final");
  if (upcoming.length) return Math.min(...upcoming.map((g) => g.week));
  return Math.max(...allGames.map((g) => g.week));
}

export function GamesPage() {
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState<number | "">("");
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const jumpedToCurrentWeek = useRef(false);

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setCurrentSeason(latest);
      setSeason(latest);
    });
  }, []);

  useEffect(() => {
    if (season === null) return;
    setLoading(true);
    api
      .games({ season, week: week === "" ? undefined : week })
      .then((allGames) => {
        setGames(allGames);
        if (!jumpedToCurrentWeek.current && week === "" && season === currentSeason) {
          jumpedToCurrentWeek.current = true;
          const live = currentWeekFor(allGames);
          if (live !== null) setWeek(live);
        }
      })
      .finally(() => setLoading(false));
  }, [season, week, currentSeason]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--text)]">Games</h1>
        <div className="flex gap-2">
          <select value={season ?? ""} onChange={(e) => setSeason(Number(e.target.value))} className="input">
            {Array.from({ length: 6 }, (_, i) => (currentSeason ?? new Date().getFullYear()) - i).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={week} onChange={(e) => setWeek(e.target.value === "" ? "" : Number(e.target.value))} className="input">
            <option value="">All weeks</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="text-[var(--text-muted)] text-sm">Loading…</div>}

      <div className="flex flex-col gap-1">
        {games.map((g) => {
          const isFinal = g.status === "final";
          const spread = g.current_spread ?? g.home_spread_close;
          const total = g.current_total ?? g.total_close;
          return (
            <Link
              key={g.game_id}
              to={`/games/${g.game_id}`}
              className="grid grid-cols-[100px_1fr_auto_1fr_150px] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-sm px-3 py-2 hover:border-[var(--accent)]/40 transition-colors"
            >
              <span className="text-xs text-[var(--text-faint)]">W{g.week}</span>
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm text-[var(--text)]">{g.away.abbr}</span>
                <TeamLogo team={g.away} size={24} />
                {g.final_away_score !== null && <span className="text-sm font-semibold text-[var(--text)] w-6 text-right">{g.final_away_score}</span>}
              </div>
              <span className="text-xs text-[var(--text-faint)]">@</span>
              <div className="flex items-center gap-2">
                {g.final_home_score !== null && <span className="text-sm font-semibold text-[var(--text)] w-6">{g.final_home_score}</span>}
                <TeamLogo team={g.home} size={24} />
                <span className="text-sm text-[var(--text)]">{g.home.abbr}</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-[var(--text-muted)]">
                  {spread !== null ? `${g.home_team} ${spread > 0 ? "+" : ""}${spread}` : "—"}
                  {total !== null ? ` · O/U ${total}` : ""}
                </span>
                <span className={`text-[10px] uppercase tracking-wide ${isFinal ? "text-[var(--text-faint)]" : "text-emerald-400"}`}>
                  {g.status.replace("_", " ")}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
