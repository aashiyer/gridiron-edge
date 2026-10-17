import { useRef, useState } from "react";
import type { TrendPoint } from "../lib/types";

export type TrendMode = "units" | "rolling_ats" | "su_over" | "rolling_su";

const W = 720;
const H = 260;
const PAD = { l: 48, r: 16, t: 22, b: 30 };

const MODES: { [m in TrendMode]: { value: (p: TrendPoint) => number | null; baseline: number; cumulative: boolean; pct: boolean; label: string } } = {
  units: { value: (p) => p.cumulative_units, baseline: 0, cumulative: true, pct: false, label: "Cumulative units" },
  rolling_ats: { value: (p) => p.rolling_ats_pct, baseline: 52.4, cumulative: false, pct: true, label: "Rolling 25-pick ATS win percentage" },
  su_over: { value: (p) => p.su_wins_over_500, baseline: 0, cumulative: true, pct: false, label: "Straight-up wins over .500" },
  rolling_su: { value: (p) => p.rolling_su_pct, baseline: 50, cumulative: false, pct: true, label: "Rolling 25-pick straight-up win percentage" },
};

function niceStep(span: number) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  return steps.find((s) => span / s <= 6) ?? 100;
}

export function TrendChart({ points, mode }: { points: TrendPoint[]; mode: TrendMode }) {
  const cfg = MODES[mode];
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const vals = points.map((p) => cfg.value(p)).filter((v): v is number => v !== null);
  if (points.length < 2 || vals.length < 2) {
    return <div className="text-sm text-[var(--text-muted)] py-8 text-center">Not enough graded picks yet to draw a trend.</div>;
  }

  const lo = Math.min(...vals, cfg.baseline);
  const hi = Math.max(...vals, cfg.baseline);
  const step = niceStep(hi - lo || 1);
  const yMin = Math.floor(lo / step) * step - (lo === hi ? step : 0);
  const yMax = Math.ceil(hi / step) * step + (lo === hi ? step : 0);
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  let path = "";
  let started = false;
  points.forEach((p, i) => {
    const v = cfg.value(p);
    if (v === null) {
      started = false;
      return;
    }
    path += `${started ? "L" : "M"}${x(i)},${y(v)}`;
    started = true;
  });
  const first = points.findIndex((p) => cfg.value(p) !== null);
  const baseline = cfg.baseline;
  const area = cfg.cumulative ? `${path}L${x(points.length - 1)},${y(0)}L${x(first)},${y(0)}Z` : "";

  const boundaries: { index: number; season: number }[] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.season !== points[i - 1].season) boundaries.push({ index: i, season: p.season });
  });

  const fmt = (v: number) => (cfg.pct ? `${v}%` : mode === "units" ? `${v > 0 ? "+" : ""}${v}u` : `${v > 0 ? "+" : ""}${v}`);
  const active = hover !== null ? points[hover] : null;
  const activeVal = active ? cfg.value(active) : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.min(Math.max(i, 0), points.length - 1));
  }

  const lastVal = cfg.value(points[points.length - 1]);
  const positive = (lastVal ?? 0) >= cfg.baseline;
  const stroke = positive ? "#22c55e" : "#ef4444";

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto touch-none select-none"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`${cfg.label} over time`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-faint)">
            {cfg.pct ? `${v}%` : v}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-faint)" strokeWidth={1.25} strokeDasharray="4 4" />
      {cfg.pct && (
        <text x={W - PAD.r} y={y(baseline) - 5} textAnchor="end" fontSize={10} fill="var(--text-faint)">
          {mode === "rolling_ats" ? "break-even 52.4%" : "50%"}
        </text>
      )}
      {boundaries.slice(1).map((b) => (
        <line key={b.season} x1={x(b.index)} x2={x(b.index)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeDasharray="2 4" />
      ))}
      {boundaries.map((b, i) => {
        const next = boundaries[i + 1]?.index ?? points.length;
        return (
          <text key={b.season} x={(x(b.index) + x(next - 1)) / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-faint)">
            {b.season}
          </text>
        );
      })}
      {area && <path d={area} fill={stroke} opacity={0.12} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      {active && activeVal !== null && (
        <g pointerEvents="none">
          <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-faint)" strokeDasharray="3 3" />
          <circle cx={x(hover!)} cy={y(activeVal)} r={5} fill={stroke} stroke="var(--card)" strokeWidth={2} />
          <g transform={`translate(${Math.min(Math.max(x(hover!) - 78, PAD.l), W - PAD.r - 156)},${PAD.t - 4})`}>
            <rect width={156} height={44} rx={8} fill="var(--card)" stroke="var(--border)" />
            <text x={10} y={18} fontSize={12} fontWeight={700} fill="var(--text)">
              {active.label} · {fmt(activeVal)}
            </text>
            <text x={10} y={34} fontSize={10.5} fill="var(--text-muted)">
              {mode === "units" || mode === "rolling_ats"
                ? `That week: ATS ${active.ats.wins}-${active.ats.losses}${active.ats.pushes ? `-${active.ats.pushes}` : ""}`
                : `That week: SU ${active.straight_up.wins}-${active.straight_up.losses}${active.straight_up.pushes ? `-${active.straight_up.pushes}` : ""}`}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
