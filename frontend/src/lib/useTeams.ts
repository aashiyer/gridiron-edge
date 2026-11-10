import { useEffect, useState } from "react";
import { api } from "./api";
import type { Sport } from "./api";
import type { TeamMeta } from "./types";

const cache: { [sport: string]: Promise<{ [abbr: string]: TeamMeta }> } = {};

function load(sport: Sport) {
  if (!cache[sport]) {
    cache[sport] = api.teams(sport).then((list) => Object.fromEntries(list.map((t) => [t.abbr, t])));
  }
  return cache[sport];
}

export function useTeams(sport: Sport): (abbr: string) => TeamMeta {
  const [map, setMap] = useState<{ [abbr: string]: TeamMeta }>({});
  useEffect(() => {
    let cancelled = false;
    load(sport).then((m) => !cancelled && setMap(m));
    return () => {
      cancelled = true;
    };
  }, [sport]);
  return (abbr: string) =>
    map[abbr] ?? { abbr, name: abbr, logo: `https://a.espncdn.com/i/teamlogos/${sport}/500/${abbr.toLowerCase()}.png`, color: "#333333", secondary: "#666666" };
}
