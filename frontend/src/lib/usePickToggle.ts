import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Pick } from "./types";

export interface LockableGame {
  game_id: string;
  status: string;
  kickoff_time: string | null;
}

export function isLocked(game: LockableGame): boolean {
  if (game.status !== "scheduled") return true;
  if (!game.kickoff_time) return false;
  const kickoff = new Date(game.kickoff_time);
  if (isNaN(kickoff.getTime())) return false;
  return Date.now() >= kickoff.getTime();
}

export function usePickToggle(game: LockableGame, existingPicks: Pick[], onPickMade: () => void) {
  const [optimistic, setOptimistic] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Record<string, boolean>>({});
  const queued = useRef<Record<string, { selection: string | null; line: number | null }>>({});

  const serverPick = (pickType: string) => existingPicks.find((p) => p.pick_type === pickType);
  const selectionFor = (pickType: string) =>
    pickType in optimistic ? optimistic[pickType] : serverPick(pickType)?.selection ?? null;

  const locked = isLocked(game);

  useEffect(() => {
    setOptimistic((cur) => {
      const keys = Object.keys(cur);
      if (!keys.length) return cur;
      const next = { ...cur };
      let changed = false;
      for (const pickType of keys) {
        const server = existingPicks.find((p) => p.pick_type === pickType)?.selection ?? null;
        if (server === cur[pickType]) {
          delete next[pickType];
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [existingPicks]);

  async function sendPick(pick_type: string, selection: string | null, line: number | null) {
    if (inFlight.current[pick_type]) {
      queued.current[pick_type] = { selection, line };
      return;
    }
    inFlight.current[pick_type] = true;
    try {
      await api.setPick({ game_id: game.game_id, pick_type, selection, line_at_pick_time: line });
      setError(null);
      onPickMade();
    } catch (e: any) {
      if (!queued.current[pick_type]) {
        setOptimistic((o) => {
          const n = { ...o };
          delete n[pick_type];
          return n;
        });
      }
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setError("This game has already kicked off, so picks are locked.");
        } else {
          setError(e.message || `Couldn't save (error ${e.status}). Please try again.`);
        }
      } else {
        setError("Couldn't save. Please try again.");
      }
    } finally {
      inFlight.current[pick_type] = false;
      const next = queued.current[pick_type];
      if (next) {
        delete queued.current[pick_type];
        sendPick(pick_type, next.selection, next.line);
      }
    }
  }

  function togglePick(pick_type: string, selection: string, line: number | null) {
    if (locked) return;
    const next = selectionFor(pick_type) === selection ? null : selection;
    setOptimistic((o) => ({ ...o, [pick_type]: next }));
    setError(null);
    sendPick(pick_type, next, line);
  }

  return { selectionFor, togglePick, locked, error };
}
