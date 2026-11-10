import type { LiveGameSummary, LivePick } from "../lib/types";

export const TONE: { [s: string]: string } = {
  win: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  winning: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  loss: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  losing: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  push: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  tied: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  pending: "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]",
};

export const STATUS_WORD: { [s: string]: string } = {
  win: "won", loss: "lost", push: "push", winning: "winning", losing: "losing", tied: "tied", pending: "",
};

export function pickLabel(p: LivePick): string {
  if (p.market === "total") return `${p.selection === "over" ? "O" : "U"} ${p.line ?? ""}`.trim();
  if (p.market === "ats") return `${p.selection} ${p.line !== null ? (p.line > 0 ? `+${p.line}` : p.line) : ""}`.trim();
  return `${p.selection} ML`;
}

export function PickChip({ p, showName = false }: { p: LivePick; showName?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${TONE[p.status]}`}>
      {showName && <span className="opacity-80">{p.name}</span>}
      {pickLabel(p)}
      {STATUS_WORD[p.status] && <span className="font-normal opacity-80">· {STATUS_WORD[p.status]}</span>}
    </span>
  );
}

export function statusText(g: { state: string; detail: string | null; clock: string | null; period: number | null; start: string }, sport: string): string {
  if (g.state === "post") return g.detail ?? "Final";
  if (g.state === "pre") {
    const d = new Date(g.start);
    return isNaN(d.getTime()) ? g.detail ?? "" : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return g.detail ?? `${sport === "nba" ? "Q" : "Q"}${g.period} ${g.clock ?? ""}`;
}

export function LivePill({ state, children }: { state: LiveGameSummary["state"]; children: React.ReactNode }) {
  if (state === "in")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-500">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
        </span>
        {children}
      </span>
    );
  return <span className={`text-[11px] font-semibold uppercase tracking-wide ${state === "post" ? "text-[var(--text-faint)]" : "text-[var(--text-muted)]"}`}>{children}</span>;
}
