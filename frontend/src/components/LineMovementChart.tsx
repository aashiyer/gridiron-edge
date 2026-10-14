import { useMemo, useRef, useState } from "react";
import type { OddsSnapshot } from "../lib/types";
import { fmtSpread } from "./GamePickCard";

type Range = "1H" | "1D" | "1W";
type Metric = "spread" | "total";

const RANGE_MS: Record<Range, number> = { "1H": 3600e3, "1D": 86400e3, "1W": 7 * 86400e3 };
const W = 640;
const H = 240;
const PAD = { l: 44, r: 14, t: 14, b: 28 };

interface Point {
  t: number;
  v: number;
}

function fmtTime(t: number, range: Range) {
  const d = new Date(t);
  if (range === "1W") return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function niceStep(span: number) {
  if (span <= 3) return 0.5;
  if (span <= 6) return 1;
  if (span <= 12) return 2;
  return 5;
}

export function LineMovementChart({ history, homeTeam }: { history: OddsSnapshot[]; homeTeam: string }) {
  const [range, setRange] = useState<Range>("1D");
  const [metric, setMetric] = useState<Metric>("spread");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo<Point[]>(() => {
    const key = metric === "spread" ? "home_spread" : "total";
    return history
      .filter((o) => o[key] !== null)
      .map((o) => ({ t: new Date(o.captured_at).getTime(), v: o[key] as number }))
      .filter((p) => !isNaN(p.t))
      .sort((a, b) => a.t - b.t);
  }, [history, metric]);

  const end = series.length ? Math.max(series[series.length - 1].t, Math.min(Date.now(), series[series.length - 1].t + RANGE_MS[range] / 4)) : Date.now();
  const start = end - RANGE_MS[range];

  const points = useMemo<Point[]>(() => {
    const inside = series.filter((p) => p.t >= start && p.t <= end);
    const before = series.filter((p) => p.t < start);
    const carry = before.length ? [{ t: start, v: before[before.length - 1].v }] : [];
    return [...carry, ...inside];
  }, [series, start, end]);

  if (!series.length) {
    return <div className="text-xs text-[var(--text-muted)]">No {metric} data yet.</div>;
  }

  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep(hi - lo || 1);
  const yMin = Math.floor((lo - step * 0.5) / step) * step;
  const yMax = Math.max(Math.ceil((hi + step * 0.5) / step) * step, yMin + step);
  const x = (t: number) => PAD.l + ((t - start) / (end - start)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  const path = points
    .map((p, i) => (i === 0 ? `M${x(p.t)},${y(p.v)}` : `H${x(p.t)}V${y(p.v)}`))
    .join("") + (points.length ? `H${x(end)}` : "");
  const area = points.length ? `${path}V${H - PAD.b}H${x(points[0].t)}Z` : "";

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? Math.round((last.v - first.v) * 100) / 100 : 0;
  const fmt = (v: number) => (metric === "spread" ? fmtSpread(v) : String(v));
  const active = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    }
    setHover(best);
  }

  const xLabels = [start, start + (end - start) / 2, end];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-2xl font-bold tabular-nums text-[var(--text)]">{last ? fmt(last.v) : "—"}</span>
          {metric === "spread" && <span className="text-xs text-[var(--text-faint)]">{homeTeam}</span>}
          {first && last && first !== last && (
            <span
              className={`text-xs font-semibold tabular-nums ${
                change === 0 ? "text-[var(--text-muted)]" : change > 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {change > 0 ? "+" : ""}
              {change} over {range}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            label="Metric"
            value={metric}
            options={[
              ["spread", "Spread"],
              ["total", "Total"],
            ]}
            onChange={(v) => {
              setHover(null);
              setMetric(v as Metric);
            }}
          />
          <Segmented
            label="Range"
            value={range}
            options={(["1H", "1D", "1W"] as Range[]).map((r) => [r, r])}
            onChange={(v) => {
              setHover(null);
              setRange(v as Range);
            }}
          />
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${metric} movement over the last ${range}`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-faint)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xLabels.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize={11}
            fill="var(--text-faint)"
          >
            {fmtTime(t, range)}
          </text>
        ))}
        {points.length > 0 && <path d={area} fill="var(--accent)" opacity={0.1} />}
        {points.length > 0 && (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={hover === i ? 5 : 2.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={1.5} />
        ))}
        {active && (
          <g pointerEvents="none">
            <line x1={x(active.t)} x2={x(active.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-faint)" strokeDasharray="3 3" />
            <g transform={`translate(${Math.min(Math.max(x(active.t) - 62, PAD.l), W - PAD.r - 124)},${PAD.t})`}>
              <rect width={124} height={38} rx={8} fill="var(--card)" stroke="var(--border)" />
              <text x={10} y={16} fontSize={12} fontWeight={700} fill="var(--text)">
                {metric === "spread" ? `${homeTeam} ${fmt(active.v)}` : `O/U ${active.v}`}
              </text>
              <text x={10} y={31} fontSize={10} fill="var(--text-muted)">
                {new Date(active.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </text>
            </g>
          </g>
        )}
      </svg>
      {points.length < 2 && (
        <div className="text-xs text-[var(--text-muted)] mt-1">No line changes in this window — showing the current line.</div>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: (string[] | [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            value === v ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
