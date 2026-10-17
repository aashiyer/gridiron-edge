import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { ExportSlide, WeekBoard } from "../lib/types";
import { Avatar } from "./Avatar";

const MAX_PEOPLE = 4;

function download(slide: ExportSlide) {
  const a = document.createElement("a");
  a.href = slide.image;
  a.download = slide.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function dayText(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

async function saveToPhone(slides: ExportSlide[]) {
  try {
    const files = await Promise.all(
      slides.map(async (s) => new File([await (await fetch(s.image)).blob()], s.filename, { type: "image/png" }))
    );
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files });
      return;
    }
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return;
  }
  slides.forEach((s, i) => setTimeout(() => download(s), i * 450));
}

export function ExportModal({
  season,
  week,
  sport,
  day,
  onClose,
}: {
  season: number;
  week: number;
  sport: "nfl" | "nba";
  day: string | null;
  onClose: () => void;
}) {
  const isNba = sport === "nba";
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [slides, setSlides] = useState<ExportSlide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.leaderboardWeek(season, week).then((b) => {
      if (cancelled) return;
      setBoard(b);
      const withPicks = [...b.users]
        .filter((u) => (b.records[String(u.user_id)]?.games_picked ?? 0) > 0)
        .sort((a, c) => Number(c.is_you) - Number(a.is_you));
      setSelected(withPicks.slice(0, MAX_PEOPLE).map((u) => u.user_id));
    });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const picksCount = useMemo(() => {
    const out: { [id: number]: number } = {};
    board?.users.forEach((u) => (out[u.user_id] = board.records[String(u.user_id)]?.games_picked ?? 0));
    return out;
  }, [board]);

  function toggle(id: number) {
    setSlides(null);
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PEOPLE ? cur : [...cur, id]));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setSlides(null);
    try {
      const r = await api.exportWeek(season, week, selected, day);
      setSlides(r.slides);
      if (!r.slides.length) setError(isNba ? "Nobody selected has picked any games in this window yet." : "There are no games to export for this week yet.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't build the export. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Export week ${week} picks`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-5 flex flex-col gap-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">
              {isNba ? `Export NBA picks · ${day ? dayText(day) : `Week ${week}`}` : `Export Week ${week} picks`}
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {isNba
                ? "Makes a swipeable set of images (1080×1350, Instagram's portrait size) with only the games someone picked, plus everyone's season record."
                : "Makes a swipeable set of images (1080×1350, Instagram's portrait size) with everyone's picks and last week's records."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)] text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Who's in it (up to {MAX_PEOPLE})</div>
          {!board && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
          <div className="flex flex-wrap gap-2">
            {board?.users.map((u) => {
              const on = selected.includes(u.user_id);
              const n = picksCount[u.user_id] ?? 0;
              return (
                <button
                  key={u.user_id}
                  onClick={() => toggle(u.user_id)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    on ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  <Avatar userId={u.user_id} version={u.avatar_version} name={u.display_name} size={26} />
                  <span className="font-medium">{u.display_name}</span>
                  <span className="text-xs text-[var(--text-faint)]">{n} picked</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={busy || selected.length === 0}
            className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold py-2.5 px-5 text-sm shadow-sm transition-colors disabled:opacity-60"
          >
            {busy ? "Building slides…" : slides ? "Rebuild" : "Generate export"}
          </button>
          {busy && <span className="text-xs text-[var(--text-muted)]">This takes about 10 seconds.</span>}
          {slides && slides.length > 0 && (
            <button
              onClick={() => saveToPhone(slides)}
              className="rounded-lg bg-emerald-500 hover:bg-emerald-500/90 text-white font-semibold py-2.5 px-4 text-sm shadow-sm transition-colors"
            >
              Save to phone
            </button>
          )}
          {slides && slides.length > 0 && (
            <button
              onClick={() => slides.forEach((s, i) => setTimeout(() => download(s), i * 450))}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50 text-[var(--text)] font-semibold py-2.5 px-4 text-sm transition-colors"
            >
              Download all ({slides.length})
            </button>
          )}
        </div>

        {error && <div className="text-sm text-[var(--destructive)]">{error}</div>}

        {slides && slides.length > 0 && (
          <div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {slides.map((s, i) => (
                <div key={s.filename} className="shrink-0 w-52 sm:w-60">
                  <img src={s.image} alt={`Slide ${i + 1}`} className="w-full rounded-lg border border-[var(--border)]" />
                  <button onClick={() => download(s)} className="mt-2 w-full text-xs font-semibold text-[var(--accent)] hover:underline">
                    Download slide {i + 1}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-2">Post them in order as a carousel. On a phone, tap Save to phone and choose Save Image, or press and hold a slide. Nothing is stored; the images are made fresh each time.</p>
          </div>
        )}
      </div>
    </div>
  );
}
