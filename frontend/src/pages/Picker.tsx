import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Game, KalshiGame, Pick, Recommendation, WeeksResponse } from "../lib/types";
import { useSport } from "../lib/SportContext";
import type { PickerView } from "../lib/kalshi";
import { GamePickCard } from "../components/GamePickCard";
import { ExportModal } from "../components/ExportModal";
import { usePolling } from "../lib/usePolling";

const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

function easternDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : EASTERN_DAY.format(d);
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function seasonLabel(sport: "nfl" | "nba", season: number): string {
  return sport === "nba" ? `${season}-${String(season + 1).slice(2)} Season` : `${season} Season`;
}

function weekLabel(sport: "nfl" | "nba", week: number, firstKickoff: string | null): string {
  if (sport !== "nba" || !firstKickoff) return `Week ${week}`;
  const d = new Date(firstKickoff);
  return isNaN(d.getTime()) ? `Week ${week}` : `Week ${week} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "America/New_York" })}`;
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
  const { sport } = useSport();
  const isNba = sport === "nba";
  const [games, setGames] = useState<Game[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [weeksInfo, setWeeksInfo] = useState<WeeksResponse | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [autoWeek, setAutoWeek] = useState(true);
  const [day, setDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const picksRequestId = useRef(0);
  const gamesRequestId = useRef(0);
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

  useEffect(() => {
    setGames([]);
    setPicks([]);
    setWeeksInfo(null);
    setWeek(null);
    setDay(null);
    setAutoWeek(true);
    setSeason(null);
    setLoading(true);
    api.seasons().then((list) => {
      const sorted = [...list].sort((a, b) => b - a);
      const latest = sorted[0] ?? new Date().getFullYear();
      setSeasons(sorted.slice(0, 3));
      setCurrentSeason(latest);
      setSeason(latest);
    });
  }, [sport]);

  async function loadWeeks(silent = false) {
    if (season === null) return;
    const info = await api.weeks(season);
    setWeeksInfo(info);
    if (autoWeek && info.current_week !== null) setWeek((w) => (silent && w !== null ? w : info.current_week));
    if (!info.weeks.length) setLoading(false);
  }

  async function loadGames(silent = false) {
    const { season: s, week: w } = context.current;
    if (s === null || w === null) return;
    const id = ++gamesRequestId.current;
    if (!silent) setLoading(true);
    try {
      const weekGames = await api.games({ season: s, week: w });
      if (id === gamesRequestId.current) setGames(weekGames);
    } finally {
      if (id === gamesRequestId.current && !silent) setLoading(false);
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
    loadWeeks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    setDay(null);
    loadGames();
    refreshPicks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week]);

  usePolling(
    () => {
      loadWeeks(true);
      loadGames(true);
      refreshPicks();
    },
    (isNba ? 15 : 10) * 60 * 1000
  );

  useEffect(() => {
    if (isNba || week === null || season === null) return;
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
  }, [season, week, isNba]);

  function changeView(v: PickerView) {
    setView(v);
    try {
      localStorage.setItem("pickerView", v);
    } catch {
    }
  }

  const showPercent = !isNba && view === "percent";
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
    if (showPercent) loadKalshi.current();
  }, [showPercent, season, week]);

  usePolling(() => loadKalshi.current(), 3 * 60 * 1000, showPercent);

  const days = useMemo(() => {
    if (!isNba) return [];
    const counts = new Map<string, number>();
    for (const g of games) {
      const d = easternDay(g.kickoff_time);
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [games, isNba]);

  useEffect(() => {
    if (!isNba || day !== null || !days.length) return;
    const today = EASTERN_DAY.format(new Date());
    const firstOpen = games.find((g) => g.status === "scheduled");
    setDay(days.some(([d]) => d === today) ? today : (firstOpen && easternDay(firstOpen.kickoff_time)) || days[0][0]);
  }, [days, day, isNba, games]);

  const weekGames = useMemo(
    () => (isNba && day && day !== "all" ? games.filter((g) => easternDay(g.kickoff_time) === day) : games),
    [games, isNba, day]
  );
  const weekOptions = weeksInfo?.weeks ?? [];

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
            {isNba
              ? "Pick whichever games you like. Only the games you pick count. ATS and totals are graded against the closing line, so your pick follows the current line."
              : "Lock in your straight-up, ATS, and total picks before kickoff. ATS and totals are graded against the closing line, so your pick always follows the current line. Change it if you don't like where it moves."}
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
                setWeek(null);
                setSeason(Number(e.target.value));
              }}
              className="input"
            >
              {(seasons.length ? seasons : [currentSeason]).map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(sport, s)}
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
              {weekOptions.map((w) => (
                <option key={w.week} value={w.week}>
                  {weekLabel(sport, w.week, w.first_kickoff)}
                </option>
              ))}
            </select>

            {(!autoWeek || season !== currentSeason) && (
              <button
                onClick={() => {
                  setAutoWeek(true);
                  if (season !== currentSeason) {
                    setWeek(null);
                    setSeason(currentSeason);
                  } else if (weeksInfo?.current_week != null) {
                    setWeek(weeksInfo.current_week);
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

      {exportOpen && season !== null && week !== null && (
        <ExportModal season={season} week={week} sport={sport} day={isNba && day && day !== "all" ? day : null} onClose={() => setExportOpen(false)} />
      )}

      {!isNba && (
        <div className="mb-4">
          <ViewToggle view={view} onChange={changeView} />
        </div>
      )}

      {isNba && days.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Day">
          {days.map(([d, n]) => (
            <button
              key={d}
              role="tab"
              aria-selected={day === d}
              onClick={() => setDay(d)}
              className={`shrink-0 rounded-xl border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                day === d
                  ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {dayLabel(d)} <span className="opacity-70 text-xs">· {n}</span>
            </button>
          ))}
          <button
            role="tab"
            aria-selected={day === "all"}
            onClick={() => setDay("all")}
            className={`shrink-0 rounded-xl border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              day === "all"
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            Whole week
          </button>
        </div>
      )}

      {loading && <div className="text-[var(--text-muted)] text-sm">Loading slate…</div>}
      {!loading && weekGames.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm">{isNba ? "No NBA games scheduled for this day." : "No games found for this week yet — run the odds poller to pull the latest slate."}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 sm:gap-4">
        {weekGames.map((g) => (
          <GamePickCard
            key={g.game_id}
            game={g}
            existingPicks={picksByGame.get(g.game_id) ?? []}
            rec={isNba ? null : recs[g.game_id] ?? null}
            loadingRec={!isNba && !recs[g.game_id]}
            onPickMade={refreshPicks}
            view={isNba ? "spread" : view}
            kalshi={kalshi[g.game_id] ?? null}
            detailLink={!isNba}
          />
        ))}
      </div>
    </div>
  );
}
