import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Sport } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useSport } from "../lib/SportContext";
import { useTheme } from "../lib/ThemeContext";
import { teamAccentFor } from "../lib/teamAccent";

const teamColorPromises: { [sport: string]: Promise<Record<string, string>> } = {};
function getTeamColors(sport: Sport): Promise<Record<string, string>> {
  if (!teamColorPromises[sport]) {
    teamColorPromises[sport] = api.teams(sport).then((teams) => Object.fromEntries(teams.map((t) => [t.abbr, t.color])));
  }
  return teamColorPromises[sport];
}

export function TeamAccentSync() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { sport } = useSport();
  const [loaded, setLoaded] = useState<{ sport: Sport; colors: Record<string, string> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTeamColors(sport).then((colors) => !cancelled && setLoaded({ sport, colors }));
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const colors = loaded && loaded.sport === sport ? loaded.colors : null;
  const favorite = sport === "nba" ? user?.favorite_nba_team : user?.favorite_teams?.[0];

  useEffect(() => {
    const root = document.documentElement.style;
    const teamColor = favorite && colors ? colors[favorite] : null;
    if (!teamColor) {
      root.removeProperty("--accent");
      root.removeProperty("--accent-text");
      return;
    }
    const { accent, accentText } = teamAccentFor(teamColor, theme);
    root.setProperty("--accent", accent);
    root.setProperty("--accent-text", accentText);
  }, [favorite, colors, theme]);

  return null;
}
