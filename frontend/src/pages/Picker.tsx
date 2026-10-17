import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Game, KalshiGame, Pick, Recommendation } from "../lib/types";
import type { PickerView } from "../lib/kalshi";
import { GamePickCard } from "../components/GamePickCard";
import { ExportModal } from "../components/ExportModal";
import { usePolling } from "../lib/usePolling";

function currentWeekFor(allGames: Game[]): number | null {
  if (!allGames.length) return null;
  const upcoming = allGames.filter((g) => g.status !== "final");
  if (upcoming.length) return Math.min(...upcoming.map((g) => g.week));
  return Math.max(...allGames.map((g) => g.week));
}

function storedView(): PickerView {
  try {
    return localStorage.getItem("pickerView") === "percent" ? "percent" : "spread";
  } catch {
    return "spread";
  }
}

function ViewToggle({ view, onChange }: { view: PickerView; onChange: (v: PickerView) => void }) {
  const options: { value: PickerView; label: string }[] = [
    { value: "spread", label: "Spread" },
    { value: "percent", label: "Percentage" },
  ];
  return (
    <div role="tablist" aria-label="Picker view" className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={view === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${
            view === o.value
              ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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
  const [view, setView] = useState<PickerView>(storedView);
  const [kalshi, setKalshi] = useState<Record<string, KalshiGame>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const gamesRef = useRef<Game[]>([]);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  const context = useRef<{ season: number | null; week: number | null }>({ season: null, week: null });
  useEffect(() => {
    context.current = { season, week };
  }, [season, week]);

  async function reload(silent = false) {
    if (season === null) return;
    const id = ++requestId.current;
    if (!silent) setLoading(true);
    try {
      const allGames = await api.games({ season });
      if (id !== requestId.current) return;
      setGames(allGames);
      if (autoWeek) {
        const live = currentWeekFor(allGames);
        if (live !== null) setWeek(live);
      }
    } finally {
      if (id === requestId.current && !silent) setLoading(false);
    }
  }

  async function refreshPicks() {
    const { season: s, week: w } = context.current;
    if (s === null || w === null) return;
    const id = ++picksRequestId.current;
    const weekPicks = await api.picks({ season: s, week: w });
    if (id === picksRequestId.current) setPicks(weekPicks);
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
    refreshPicks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week]);

  usePolling(() => {
    reload(true);
    refreshPicks();
  }, 10 * 60 * 1000);

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

  function changeView(v: PickerView) {
    setView(v);
    try {
      localStorage.setItem("pickerView", v);
    } catch {
    }
  }

  const loadKalshi = useRef<() => void>(() => {});
  loadKalshi.current = async () => {
    const { season: s, week: w } = context.current;
    if (s === null || w === null) return;
    try {
      const r = await api.kalshi({ season: s, week: w });
      setKalshi((prev) => ({ ...prev, ...r }));
    } catch {
    }
  };

  useEffect(() => {
    if (view === "percent") loadKalshi.current();
  }, [view, season, week]);

  usePolling(() => loadKalshi.current(), 3 * 60 * 1000, view === "percent");

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
            Lock in your straight-up, ATS, and total picks before kickoff. ATS and totals are graded against the closing line, so your pick always follows the current line. Change it if you don't like where it moves.
          </p>
        </div>
        {currentSeason !== null && season !== null && (
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => setExportOpen(true)}
              disabled={week === null}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/50 text-[var(--text)] font-semibold py-2 px-3.5 text-sm transition-colors disabled:opacity-60"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              Export
            </button>
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

      {exportOpen && season !== null && week !== null && <ExportModal season={season} week={week} onClose={() => setExportOpen(false)} />}

      <div className="mb-4">
        <ViewToggle view={view} onChange={changeView} />
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
            view={view}
            kalshi={kalshi[g.game_id] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
