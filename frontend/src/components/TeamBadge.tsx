import type { TeamMeta } from "../lib/types";

export function TeamLogo({ team, size = 40, className = "" }: { team: TeamMeta; size?: number; className?: string }) {
  return (
    <img
      src={team.logo}
      alt={team.name}
      width={size}
      height={size}
      className={`object-contain drop-shadow-sm ${className}`}
      loading="lazy"
    />
  );
}

export function TeamBadge({ team, sub }: { team: TeamMeta; sub?: string }) {
  return (
    <div className="flex items-center gap-2">
      <TeamLogo team={team} size={32} />
      <div className="text-left">
        <div className="text-sm font-semibold text-gray-100 leading-tight">{team.abbr}</div>
        {sub && <div className="text-xs text-gray-400 leading-tight">{sub}</div>}
      </div>
    </div>
  );
}
