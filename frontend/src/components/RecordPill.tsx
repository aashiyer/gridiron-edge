import type { Record } from "../lib/types";

export function RecordPill({ label, record }: { label: string; record: Record }) {
  const pct = record.win_pct;
  const color =
    pct === null ? "text-[var(--text-muted)]" : pct >= 52.4 ? "text-emerald-400" : pct >= 45 ? "text-orange-400" : "text-rose-400";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm px-4 py-3 flex flex-col gap-1 min-w-[120px]">
      <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <span className="font-display text-lg font-bold text-[var(--text)]">
        {record.wins}-{record.losses}
        {record.pushes ? `-${record.pushes}` : ""}
      </span>
      <span className={`text-sm font-medium ${color}`}>{pct !== null ? `${pct}%` : "—"}</span>
    </div>
  );
}
