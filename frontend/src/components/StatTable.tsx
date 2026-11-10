import { useMemo, useState } from "react";

export interface StatCol<T> {
  key: string;
  label: string;
  desc?: string;
  value: (row: T) => number | string | null;
  render?: (row: T, decimals: number) => React.ReactNode;
  /** true when a lower number is the better one, so the first sort is ascending */
  lowerBetter?: boolean;
  /** fixed decimal places; otherwise inferred from the data */
  dec?: number;
}

export function fmtStat(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (Number.isInteger(n)) return String(n);
  return Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(1);
}

export function fmtFixed(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(decimals);
}

export function StatTable<T>({
  rows,
  columns,
  lead,
  leadLabel,
  rowKey,
  onRow,
  initialSort,
  pageSize = 25,
  ranked = false,
}: {
  rows: T[];
  columns: StatCol<T>[];
  lead: (row: T) => React.ReactNode;
  leadLabel: string;
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  ranked?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]?.key ?? "", dir: "desc" as const });
  const [shown, setShown] = useState(pageSize);

  // One decimal place for the whole column when any value has a fraction, so 2 and 1.1 line up as 2.0 and 1.1.
  const decimals = useMemo(() => {
    const out: { [k: string]: number } = {};
    columns.forEach((c) => {
      if (c.dec !== undefined) {
        out[c.key] = c.dec;
        return;
      }
      out[c.key] = rows.some((r) => {
        const v = c.value(r);
        return typeof v === "number" && !Number.isInteger(v);
      })
        ? 1
        : 0;
    });
    return out;
  }, [rows, columns]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
  }, [rows, columns, sort]);

  function toggle(c: StatCol<T>) {
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: c.lowerBetter ? "asc" : "desc" }));
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              {ranked && <th className="w-10 pl-4 pr-1 py-2.5 text-left font-semibold">#</th>}
              <th className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 text-left font-semibold whitespace-nowrap">{leadLabel}</th>
              {columns.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} className="px-0 py-0 text-right font-semibold" title={c.desc}>
                    <button
                      onClick={() => toggle(c)}
                      className={`w-full min-w-[3.1rem] px-2.5 py-2.5 text-right uppercase tracking-[0.1em] whitespace-nowrap transition-colors ${active ? "text-[var(--text)]" : "hover:text-[var(--text-muted)]"}`}
                    >
                      {c.label}
                      <span className={`ml-0.5 inline-block w-2 ${active ? "" : "opacity-0"}`}>{sort.dir === "desc" ? "↓" : "↑"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.slice(0, shown).map((r, i) => (
              <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? "cursor-pointer hover:bg-[var(--surface-hover)]/60 transition-colors" : ""}>
                {ranked && <td className="pl-4 pr-1 py-2.5 text-[11px] text-[var(--text-faint)]">{i + 1}</td>}
                <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 whitespace-nowrap">{lead(r)}</td>
                {columns.map((c) => (
                  <td key={c.key} className={`px-2.5 py-2.5 text-right whitespace-nowrap ${sort.key === c.key ? "text-[var(--text)] font-medium" : "text-[var(--text-muted)]"}`}>
                    {c.render ? c.render(r, decimals[c.key]) : fmtFixed(c.value(r) as number | null, decimals[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <button onClick={() => setShown((n) => n + pageSize)} className="w-full border-t border-[var(--border)] py-2.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
          Show {Math.min(pageSize, sorted.length - shown)} more · {sorted.length - shown} remaining
        </button>
      )}
      {sorted.length === 0 && <div className="px-4 py-8 text-center text-sm text-[var(--text-faint)]">Nothing matches.</div>}
    </div>
  );
}

/** Quiet underlined text tabs. */
export function TextTabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`-mb-px shrink-0 border-b-2 pb-2 text-[13px] transition-colors ${value === o.id ? "border-[var(--text)] text-[var(--text)] font-medium" : "border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]"}`}
          style={{ borderRadius: 0 }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
