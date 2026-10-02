import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";
import { teamAccentFor } from "../lib/teamAccent";

let teamColorsPromise: Promise<Record<string, string>> | null = null;
function getTeamColors(): Promise<Record<string, string>> {
  if (!teamColorsPromise) {
    teamColorsPromise = api.teams().then((teams) => Object.fromEntries(teams.map((t) => [t.abbr, t.color])));
  }
  return teamColorsPromise;
}

export function TeamAccentSync() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [colors, setColors] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getTeamColors().then(setColors);
  }, []);

  useEffect(() => {
    const root = document.documentElement.style;
    const favorite = user?.favorite_teams?.[0];
    const teamColor = favorite && colors ? colors[favorite] : null;
    if (!teamColor) {
      root.removeProperty("--accent");
      root.removeProperty("--accent-text");
      return;
    }
    const { accent, accentText } = teamAccentFor(teamColor, theme);
    root.setProperty("--accent", accent);
    root.setProperty("--accent-text", accentText);
  }, [user?.favorite_teams, colors, theme]);

  return null;
}
