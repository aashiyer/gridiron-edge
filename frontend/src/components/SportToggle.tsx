import { useLocation, useNavigate } from "react-router-dom";
import { useSport } from "../lib/SportContext";
import type { Sport } from "../lib/api";

export const NFL_ONLY_PATHS = ["/power-rankings", "/vs-model"];

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
    <div role="tablist" aria-label="Sport" className={compact ? "inline-flex gap-5" : "grid grid-cols-2 border-b border-[var(--border)]"}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={sport === o.value}
          onClick={() => choose(o.value)}
          className={`-mb-px text-left text-[11px] font-semibold uppercase tracking-[0.16em] border-b-2 transition-colors ${compact ? "py-1" : "pb-2"} ${
            sport === o.value ? "border-[var(--text)] text-[var(--text)]" : "border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
