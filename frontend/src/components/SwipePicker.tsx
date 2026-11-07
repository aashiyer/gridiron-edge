import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { isLocked } from "../lib/usePickToggle";
import { useModelHints } from "../lib/ModelHintsContext";
import type { Game, Pick, Recommendation } from "../lib/types";
import { TeamLogo } from "./TeamBadge";
import { fmtSpread } from "./GamePickCard";

type Market = "straight_up" | "ats" | "total";
interface Step {
  key: string;
  game: Game;
  market: Market;
}

const THRESHOLD = 90;
const MARKET_ORDER: Market[] = ["straight_up", "ats", "total"];

function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.5 ? "#111" : "#fff";
}

export function SwipePicker({
  games,
  picks,
  recs,
  isNba,
  onPickMade,
  onExit,
}: {
  games: Game[];
  picks: Pick[];
  recs: Record<string, Recommendation>;
  isNba: boolean;
  onPickMade: () => void;
  onExit: () => void;
}) {
  const { show: showModel } = useModelHints();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ step: Step; picked: boolean }[]>([]);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [flying, setFlying] = useState<null | "left" | "right" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const delta = useRef({ x: 0, y: 0 });

  const steps = useMemo(() => {
    const have = new Set(picks.map((p) => `${p.game_id}:${p.pick_type}`));
    const out: Step[] = [];
    [...games]
      .filter((g) => !isLocked(g))
      .sort((a, b) => new Date(a.kickoff_time ?? 0).getTime() - new Date(b.kickoff_time ?? 0).getTime())
      .forEach((g) => {
        const spread = g.current_spread ?? g.home_spread_close;
        const total = g.current_total ?? g.total_close;
        MARKET_ORDER.forEach((market) => {
          if (market === "ats" && spread === null) return;
          if (market === "total" && total === null) return;
          const key = `${g.game_id}:${market}`;
          if (!have.has(key) && !done.has(key)) out.push({ key, game: g, market });
        });
      });
    return out;
  }, [games, picks, done]);

  const total = steps.length + done.size;
  const step = steps[0];

  async function commit(side: "left" | "right" | "skip") {
    if (!step || flying) return;
    const { game, market } = step;
    const spread = game.current_spread ?? game.home_spread_close;
    const tot = game.current_total ?? game.total_close;
    setFlying(side);
    setError(null);
    let selection: string | null = null;
    let line: number | null = null;
    if (side !== "skip") {
      if (market === "total") {
        selection = side === "right" ? "over" : "under";
        line = tot;
      } else {
        selection = side === "right" ? game.home_team : game.away_team;
        line = market === "ats" && spread !== null ? (side === "right" ? spread : -spread) : null;
      }
    }
    setTimeout(async () => {
      try {
        if (selection) {
          await api.setPick({ game_id: game.game_id, pick_type: market, selection, line_at_pick_time: line });
          onPickMade();
        }
        setDone((d) => new Set(d).add(step.key));
        setHistory((h) => [...h, { step, picked: !!selection }]);
      } catch {
        setError("Couldn't save that one. It may have just locked.");
      }
      setFlying(null);
      setDrag({ x: 0, y: 0, active: false });
    }, 180);
  }

  async function undo() {
    const last = history[history.length - 1];
    if (!last || flying) return;
    try {
      if (last.picked) {
        await api.setPick({ game_id: last.step.game.game_id, pick_type: last.step.market, selection: null, line_at_pick_time: null });
        onPickMade();
      }
      setDone((d) => {
        const n = new Set(d);
        n.delete(last.step.key);
        return n;
      });
      setHistory((h) => h.slice(0, -1));
    } catch {
      setError("Couldn't undo that.");
    }
  }

  function down(e: React.PointerEvent) {
    if (flying) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    start.current = { x: e.clientX, y: e.clientY };
    delta.current = { x: 0, y: 0 };
    setDrag({ x: 0, y: 0, active: true });
  }
  function move(e: React.PointerEvent) {
    if (!start.current) return;
    delta.current = { x: e.clientX - start.current.x, y: e.clientY - start.current.y };
    setDrag({ ...delta.current, active: true });
  }
  function up() {
    if (!start.current) return;
    start.current = null;
    const d = delta.current;
    if (d.x > THRESHOLD) commit("right");
    else if (d.x < -THRESHOLD) commit("left");
    else if (d.y < -THRESHOLD * 1.2) commit("skip");
    else setDrag({ x: 0, y: 0, active: false });
  }

  if (!step) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center flex flex-col items-center gap-3">
        <div className="text-3xl">🎯</div>
        <div className="font-display text-lg font-bold text-[var(--text)]">{total === 0 ? "Nothing left to pick" : "All caught up"}</div>
        <p className="text-sm text-[var(--text-muted)]">
          {total === 0 ? "Every open game on this slate already has your picks." : `You went through ${total} pick${total === 1 ? "" : "s"}. Skipped ones can be changed in the list.`}
        </p>
        <div className="flex gap-2">
          {history.length > 0 && (
            <button onClick={undo} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)]">
              Undo last
            </button>
          )}
          <button onClick={onExit} className="rounded-lg bg-[var(--accent)] text-[var(--accent-text)] px-4 py-2 text-sm font-semibold">
            Back to list
          </button>
        </div>
      </div>
    );
  }

  const { game, market } = step;
  const spread = game.current_spread ?? game.home_spread_close;
  const tot = game.current_total ?? game.total_close;
  const rec = showModel && !isNba ? recs[game.game_id] : null;
  const lean = rec ? (market === "straight_up" ? rec.lean_straight_up : market === "ats" ? rec.lean_ats : rec.lean_total) : null;
  const mlA = game.current_away_ml ?? game.away_ml_close;
  const mlH = game.current_home_ml ?? game.home_ml_close;

  const title = market === "straight_up" ? "Who wins?" : market === "ats" ? "Who covers?" : `Over or under ${tot}?`;
  const leftLabel = market === "total" ? "Under" : game.away.abbr;
  const rightLabel = market === "total" ? "Over" : game.home.abbr;
  const leftSub = market === "ats" && spread !== null ? fmtSpread(-spread) : market === "straight_up" && mlA !== null && mlA !== undefined ? fmtSpread(mlA) : "";
  const rightSub = market === "ats" && spread !== null ? fmtSpread(spread) : market === "straight_up" && mlH !== null && mlH !== undefined ? fmtSpread(mlH) : "";

  const leftColor = market === "total" ? "#64748b" : game.away.color;
  const rightColor = market === "total" ? "#f59e0b" : game.home.color;
  const lean_side = lean ? (lean === game.home_team || lean === "over" ? "right" : lean === game.away_team || lean === "under" ? "left" : null) : null;

  const rot = Math.max(-18, Math.min(18, drag.x / 12));
  const fly = flying === "left" ? { x: -700, y: 0 } : flying === "right" ? { x: 700, y: 0 } : flying === "skip" ? { x: 0, y: -700 } : null;
  const tx = fly ? fly.x : drag.x;
  const ty = fly ? fly.y : drag.y;
  const progress = Math.min(1, Math.abs(drag.x) / THRESHOLD);
  const dir = drag.x > 8 ? "right" : drag.x < -8 ? "left" : null;
  const tint = dir === "right" ? rightColor : dir === "left" ? leftColor : null;

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <div className="w-full max-w-sm flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>
          {done.size + 1} of {total}
        </span>
        <div className="h-1.5 flex-1 mx-3 rounded-full bg-[var(--surface)] overflow-hidden">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${(done.size / total) * 100}%` }} />
        </div>
        <button onClick={undo} disabled={history.length === 0} className="font-semibold text-[var(--accent)] disabled:opacity-40">
          Undo
        </button>
      </div>

      <div className="relative w-full max-w-sm" style={{ height: "min(430px, 52vh)" }}>
        <div className="absolute inset-x-3 top-3 bottom-0 rounded-3xl border border-[var(--border)] bg-[var(--card)] opacity-60 scale-[0.96]" />
        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="absolute inset-0 rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden cursor-grab active:cursor-grabbing"
          style={{
            touchAction: "none",
            transform: `translate(${tx}px, ${ty}px) rotate(${fly ? (flying === "left" ? -20 : flying === "right" ? 20 : 0) : rot}deg)`,
            transition: drag.active && !fly ? "none" : "transform 0.18s ease-out",
          }}
        >
          {tint && <div className="absolute inset-0 pointer-events-none" style={{ background: tint, opacity: 0.12 + 0.28 * progress }} />}
          <div className="relative h-full flex flex-col p-5">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{fmtKickoff(game.kickoff_time)}</span>
              <span className="uppercase tracking-widest font-semibold text-[var(--accent)]">{market === "straight_up" ? "Straight up" : market === "ats" ? "Spread" : "Total"}</span>
            </div>
            <div className="mt-4 text-center font-display text-2xl font-bold text-[var(--text)]">{title}</div>

            {market === "total" ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <div className="flex items-center gap-4">
                  <TeamLogo team={game.away} size={64} />
                  <span className="text-[var(--text-faint)]">@</span>
                  <TeamLogo team={game.home} size={64} />
                </div>
                <div className="font-display text-6xl font-bold text-[var(--text)] tabular-nums">{tot}</div>
              </div>
            ) : (
              <div className="flex-1 grid grid-cols-2 gap-3 items-center">
                {[
                  { t: game.away, sub: leftSub },
                  { t: game.home, sub: rightSub },
                ].map(({ t, sub }, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <TeamLogo team={t} size={88} />
                    <div className="font-display text-xl font-bold text-[var(--text)]">{t.abbr}</div>
                    <div className="text-sm text-[var(--text-muted)] tabular-nums">{sub || " "}</div>
                  </div>
                ))}
              </div>
            )}

            {lean && (
              <div className="mx-auto mb-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-500">
                Model leans {lean === "over" || lean === "under" ? lean : lean}
                {lean_side ? (lean_side === "right" ? " →" : " ←") : ""}
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-[var(--text-faint)] mt-1">
              <span>← {leftLabel}</span>
              <span>↑ skip</span>
              <span>{rightLabel} →</span>
            </div>
          </div>
          {dir && (
            <div
              className="absolute top-6 px-3 py-1 rounded-lg border-4 font-display text-xl font-bold uppercase tracking-wider"
              style={{
                [dir === "right" ? "right" : "left"]: 18,
                opacity: progress,
                borderColor: dir === "right" ? rightColor : leftColor,
                color: readableOn(dir === "right" ? rightColor : leftColor) === "#fff" ? (dir === "right" ? rightColor : leftColor) : "var(--text)",
                transform: `rotate(${dir === "right" ? 12 : -12}deg)`,
                background: "var(--card)",
              }}
            >
              {dir === "right" ? rightLabel : leftLabel}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-5">
        <button
          onClick={() => commit("left")}
          className="h-14 min-w-14 px-4 rounded-full border-2 font-display font-bold text-sm shadow-sm active:scale-95 transition-transform"
          style={{ borderColor: leftColor, color: "var(--text)", background: "var(--card)" }}
        >
          {leftLabel}
        </button>
        <button onClick={() => commit("skip")} className="h-11 px-4 rounded-full border border-[var(--border)] bg-[var(--card)] text-xs font-semibold text-[var(--text-muted)] active:scale-95 transition-transform">
          Skip
        </button>
        <button
          onClick={() => commit("right")}
          className="h-14 min-w-14 px-4 rounded-full border-2 font-display font-bold text-sm shadow-sm active:scale-95 transition-transform"
          style={{ borderColor: rightColor, color: "var(--text)", background: "var(--card)" }}
        >
          {rightLabel}
        </button>
      </div>
      {error && <div className="text-xs text-[var(--destructive)]">{error}</div>}
      <button onClick={onExit} className="text-xs text-[var(--text-faint)] hover:text-[var(--text)]">
        Switch to list view
      </button>
    </div>
  );
}
