import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Game, KalshiGame, Pick, Recommendation, WeeksResponse } from "../lib/types";
import { useSport } from "../lib/SportContext";
import type { PickerView } from "../lib/kalshi";
import { GamePickCard } from "../components/GamePickCard";
import { ExportModal } from "../components/ExportModal";
import { SwipePicker } from "../components/SwipePicker";
import { ModelToggle } from "../components/ModelToggle";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  const [mode, setModeState] = useState<"list" | "swipe">(() => {
    try {
      return localStorage.getItem("pickSixPickerMode") === "swipe" ? "swipe" : "list";
    } catch {
      return "list";
    }
  });
  function setMode(next: "list" | "swipe") {
    setModeState(next);
    try {
      localStorage.setItem("pickSixPickerMode", next);
    } catch {
      /* ignore */
    }
  }
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

  const weekIndex = weekOptions.findIndex((w) => w.week === week);
  const stepWeek = (delta: number) => {
    const next = weekOptions[weekIndex + delta];
    if (next) {
      setAutoWeek(false);
      setWeek(next.week);
    }
  };
  const isCurrentWeek = weeksInfo?.current_week === week;
  const pickedCount = weekGames.filter((g) => picksByGame.has(g.game_id)).length;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {currentSeason !== null && season !== null && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => stepWeek(-1)}
              disabled={weekIndex <= 0}
              className="h-9 w-9 shrink-0 grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] disabled:opacity-40"
              aria-label="Previous week"
            >
              ‹
            </button>
            <label className="relative min-w-0">
              <span className="flex flex-col items-center px-2 leading-tight cursor-pointer">
                <span className="font-display text-lg sm:text-xl font-bold text-[var(--text)] truncate">
                  {week !== null ? weekLabel(sport, week, weekOptions.find((w) => w.week === week)?.first_kickoff ?? null) : "…"}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                  <span className="hidden sm:inline">{seasonLabel(sport, season)} · </span>
                  {isCurrentWeek ? "current · " : ""}
                  {pickedCount}/{weekGames.length} picked
                </span>
              </span>
              <select
                value={week ?? ""}
                onChange={(e) => {
                  setAutoWeek(false);
                  setWeek(Number(e.target.value));
                }}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Jump to week"
              >
                {weekOptions.map((w) => (
                  <option key={w.week} value={w.week}>
                    {weekLabel(sport, w.week, w.first_kickoff)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => stepWeek(1)}
              disabled={weekIndex < 0 || weekIndex >= weekOptions.length - 1}
              className="h-9 w-9 shrink-0 grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] disabled:opacity-40"
              aria-label="Next week"
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="Pick style" className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {(["list", "swipe"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${mode === m ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-muted)]"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-label="Picker options"
                className={`h-9 w-9 grid place-items-center rounded-lg border bg-[var(--card)] text-[var(--text)] transition-colors ${menuOpen ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 z-30 w-[min(18.5rem,88vw)] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-3 flex flex-col gap-3">
                  <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
                    Season
                    <select
                      value={season}
                      onChange={(e) => {
                        setAutoWeek(true);
                        setWeek(null);
                        setSeason(Number(e.target.value));
                      }}
                      className="input"
                    >
                      {(seasons.length ? seasons : [currentSeason]).map((sv) => (
                        <option key={sv} value={sv}>
                          {seasonLabel(sport, sv)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!isNba && (
                    <div className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
                      Show odds as
                      <ViewToggle view={view} onChange={changeView} />
                    </div>
                  )}
                  {!isNba && (
                    <div className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
                      Model suggestions
                      <ModelToggle compact />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--border)]">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setExportOpen(true);
                      }}
                      disabled={week === null}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-60"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                      </svg>
                      Export picks as image
                    </button>
                    {(!autoWeek || season !== currentSeason) && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setAutoWeek(true);
                          if (season !== currentSeason) {
                            setWeek(null);
                            setSeason(currentSeason);
                          } else if (weeksInfo?.current_week != null) {
                            setWeek(weeksInfo.current_week);
                          }
                        }}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-hover)]"
                      >
                        ↻ Jump to current week
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {exportOpen && season !== null && week !== null && (
        <ExportModal season={season} week={week} sport={sport} day={isNba && day && day !== "all" ? day : null} onClose={() => setExportOpen(false)} />
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

      {mode === "swipe" && !loading && weekGames.length > 0 && (
        <SwipePicker games={weekGames} picks={picks} recs={recs} isNba={isNba} onPickMade={refreshPicks} onExit={() => setMode("list")} />
      )}

      <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 sm:gap-4 ${mode === "swipe" ? "hidden" : ""}`}>
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
          />
        ))}
      </div>
    </div>
  );
}
