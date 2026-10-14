import type { KalshiGame } from "./types";

export type PickerView = "spread" | "percent";

const at = (ladder: Record<string, number> | undefined, strike: number): number | undefined => ladder?.[String(strike)];

export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function atsProbs(k: KalshiGame | null, homeSpread: number | null): { home: number; away: number } | null {
  if (!k || homeSpread === null) return null;
  if (homeSpread === 0) return k.win ?? null;
  const homeFavored = homeSpread < 0;
  const line = Math.abs(homeSpread);
  const half = line % 1 !== 0;
  const ladder = homeFavored ? k.spread?.home : k.spread?.away;
  const favorite = at(ladder, half ? line : line + 0.5);
  const underdogBase = at(ladder, half ? line : line - 0.5);
  if (favorite === undefined || underdogBase === undefined) return null;
  const underdog = 1 - underdogBase;
  return homeFavored ? { home: favorite, away: underdog } : { home: underdog, away: favorite };
}

export function totalProbs(k: KalshiGame | null, total: number | null): { over: number; under: number } | null {
  if (!k?.total || total === null) return null;
  const half = total % 1 !== 0;
  const over = at(k.total, half ? total : total + 0.5);
  const underBase = at(k.total, half ? total : total - 0.5);
  if (over === undefined || underBase === undefined) return null;
  return { over, under: 1 - underBase };
}
