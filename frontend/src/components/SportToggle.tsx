import { useLocation, useNavigate } from "react-router-dom";
import { useSport } from "../lib/SportContext";
import type { Sport } from "../lib/api";

export const NFL_ONLY_PATHS = ["/power-rankings", "/vs-model", "/games"];

const OPTIONS: { value: Sport; label: string }[] = [
  { value: "nfl", label: "NFL" },
  { value: "nba", label: "NBA" },
];

export function SportToggle({ compact = false }: { compact?: boolean }) {
  const { sport, setSport } = useSport();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  function choose(next: Sport) {
    if (next === sport) return;
    setSport(next);
    if (next === "nba" && NFL_ONLY_PATHS.some((p) => pathname.startsWith(p))) navigate("/");
  }

  return (
    <div role="tablist" aria-label="Sport" className={`inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 ${compact ? "" : "w-full"}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={sport === o.value}
          onClick={() => choose(o.value)}
          className={`${compact ? "px-2.5 py-1 text-xs" : "flex-1 py-1.5 text-sm"} rounded-md font-bold tracking-wide transition-colors ${
            sport === o.value ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
