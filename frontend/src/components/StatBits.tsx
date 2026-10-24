import type { Record as PickRecord } from "../lib/types";

export function fmtRec(r: PickRecord) {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}

export function fmtPct(p: number | null) {
  return p === null ? "—" : `${p}%`;
}

export function fmtUnits(u: number) {
  return `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
}

export function tone(pct: number | null, baseline: number) {
  if (pct === null) return "text-[var(--text-muted)]";
  return pct >= baseline ? "text-emerald-500" : "text-rose-500";
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${
            value === v ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">{children}</h2>
      {right}
    </div>
  );
}

