import type { KalshiGame } from "./types";

export type PickerView = "spread" | "percent";

type Ladder = { [strike: string]: number };
type Point = [number, number];

function points(ladder: Ladder | undefined): Point[] {
  return Object.entries(ladder ?? {})
    .map(([strike, p]): Point => [Number(strike), p])
    .sort((a, b) => a[0] - b[0]);
}

function survival(pts: Point[], x: number): number | undefined {
  const exact = pts.find(([strike]) => strike === x);
  if (exact) return exact[1];
  const below = [...pts].reverse().find(([strike]) => strike < x);
  const above = pts.find(([strike]) => strike > x);
  if (!below || !above) return undefined;
  const t = (x - below[0]) / (above[0] - below[0]);
  return below[1] + t * (above[1] - below[1]);
}

export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function atsProbs(k: KalshiGame | null, homeSpread: number | null): { home: number; away: number } | null {
  if (!k || homeSpread === null) return null;
  if (homeSpread === 0) return k.win ?? null;
  const homeFavored = homeSpread < 0;
  const line = Math.abs(homeSpread);
  const half = line % 1 !== 0;
  const pts = points(homeFavored ? k.spread?.home : k.spread?.away);
  const favoriteWin = k.win ? (homeFavored ? k.win.home : k.win.away) : undefined;
  if (favoriteWin !== undefined && !pts.some(([strike]) => strike === 0.5)) pts.unshift([0.5, favoriteWin]);
  const favorite = survival(pts, half ? line : line + 0.5);
  const underdogBase = survival(pts, half ? line : line - 0.5);
  if (favorite === undefined || underdogBase === undefined) return null;
  const underdog = 1 - underdogBase;
  return homeFavored ? { home: favorite, away: underdog } : { home: underdog, away: favorite };
}

export function totalProbs(k: KalshiGame | null, total: number | null): { over: number; under: number } | null {
  if (!k?.total || total === null) return null;
  const half = total % 1 !== 0;
  const pts = points(k.total);
  const over = survival(pts, half ? total : total + 0.5);
  const underBase = survival(pts, half ? total : total - 0.5);
  if (over === undefined || underBase === undefined) return null;
  return { over, under: 1 - underBase };
}
