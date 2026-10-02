import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Game, Pick, Recommendation } from "../lib/types";
import { GamePickCard } from "../components/GamePickCard";

function currentWeekFor(allGames: Game[]): number | null {
  if (!allGames.length) return null;
  const upcoming = allGames.filter((g) => g.status !== "final");
  if (upcoming.length) return Math.min(...upcoming.map((g) => g.week));
  return Math.max(...allGames.map((g) => g.week));
}

export function Picker() {
  const [games, setGames] = useState<Game[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [autoWeek, setAutoWeek] = useState(true);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const picksRequestId = useRef(0);
  const [recs, setRecs] = useState<Record<string, Recommendation>>({});
  const gamesRef = useRef<Game[]>([]);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  async function reload() {
    if (season === null) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const [allGames, allPicks] = await Promise.all([api.games({ season }), api.picks()]);
      if (id !== requestId.current) return;
      setGames(allGames);
      setPicks(allPicks);
      if (autoWeek) {
        const live = currentWeekFor(allGames);
        if (live !== null) setWeek(live);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  async function refreshPicks() {
    const id = ++picksRequestId.current;
    const allPicks = await api.picks();
    if (id === picksRequestId.current) setPicks(allPicks);
  }

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setCurrentSeason(latest);
      setSeason((s) => s ?? latest);
    });
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    const id = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, autoWeek]);

  useEffect(() => {
    if (week === null || season === null) return;
    const s = season;
    const w = week;
    let cancelled = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 12;

    async function poll() {
      if (cancelled) return;
      try {
        const r = await api.recommendations({ season: s, week: w });
        if (cancelled) return;
        setRecs((prev) => ({ ...prev, ...r }));
        const stillMissing = gamesRef.current.some((g) => g.week === w && !(g.game_id in r));
        if (!stillMissing) return;
      } catch {
      }
      attempt += 1;
      if (attempt < MAX_ATTEMPTS && !cancelled) {
        setTimeout(poll, 5000);
      }
    }
    poll();

    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const weekGames = useMemo(() => games.filter((g) => g.week === week), [games, week]);
  const availableWeeks = useMemo(() => Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b), [games]);

  const picksByGame = useMemo(() => {
    const map = new Map<string, Pick[]>();
    for (const p of picks) {
      if (!map.has(p.game_id)) map.set(p.game_id, []);
      map.get(p.game_id)!.push(p);
    }
    return map;
  }, [picks]);

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text)]">Pick the Slate</h1>

          <p className="hidden sm:block text-sm text-[var(--text-muted)]">
            Lock in your straight-up, ATS, and total picks before kickoff.
          </p>
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
              value={week ?? ""}
              onChange={(e) => {
                setAutoWeek(false);
                setWeek(Number(e.target.value));
              }}
              className="input"
            >
              {availableWeeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>

            {(!autoWeek || season !== currentSeason) && (
              <button
                onClick={() => {
                  setAutoWeek(true);
                  if (season !== currentSeason) {
                    setSeason(currentSeason);
                  } else {
                    const live = currentWeekFor(games);
                    if (live !== null) setWeek(live);
                  }
                }}
                className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent)]/80 px-2 py-1.5"
              >
                ↻ Jump to current week
              </button>
            )}
          </div>
        )}
      </div>

      {loading && <div className="text-[var(--text-muted)] text-sm">Loading slate…</div>}
      {!loading && weekGames.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm">No games found for this week yet — run the odds poller to pull the latest slate.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 sm:gap-4">
        {weekGames.map((g) => (
          <GamePickCard
            key={g.game_id}
            game={g}
            existingPicks={picksByGame.get(g.game_id) ?? []}
            rec={recs[g.game_id] ?? null}
            loadingRec={!recs[g.game_id]}
            onPickMade={refreshPicks}
          />
        ))}
      </div>
    </div>
  );
}
