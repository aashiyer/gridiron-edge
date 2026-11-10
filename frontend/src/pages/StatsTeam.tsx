import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { PlayerStatsResponse, TeamStatsResponse } from "../lib/types";
import { fmtStat } from "../components/StatTable";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function StatsTeamPage() {
  const { sport, abbr } = useParams<{ sport: string; abbr: string }>();
  const navigate = useNavigate();
  const s = sport === "nba" ? "nba" : "nfl";
  const [teams, setTeams] = useState<TeamStatsResponse | null>(null);
  const [roster, setRoster] = useState<{ title: string; data: PlayerStatsResponse }[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    setTeams(null);
    setRoster([]);
    setError(false);
    api.statsTeams({}).then(setTeams).catch(() => setError(true));
    const views = s === "nba" ? [["avg", "Players"]] : [["passing", "Passing"], ["rushing", "Rushing"], ["receiving", "Receiving"], ["defense", "Defense"]];
    Promise.all(views.map(([v, title]) => api.statsPlayers({ view: v, qualified: s === "nba" ? false : true }).then((data) => ({ title, data }))))
      .then(setRoster)
      .catch(() => {});
  }, [s, abbr]);

  const team = teams?.teams.find((t) => t.abbr === abbr);
  if (error) return <div className="max-w-4xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load this team. <Link to="/stats?tab=teams" className="underline underline-offset-4">Back to stats</Link></div>;
  if (!teams) return <div className="max-w-4xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;
  if (!team) return <div className="max-w-4xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Team not found.</div>;
  const n = teams.teams.length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-8">
      <button onClick={() => navigate(-1)} className="self-start text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
        ← Stats
      </button>
      <header className="flex items-center gap-5">
        {team.logo && <img src={team.logo} alt="" className="h-16 w-16 object-contain" />}
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">{team.name}</h1>
          <div className="mt-1 text-[13px] text-[var(--text-muted)]">{teams.seasons.find((x) => x.year === teams.season)?.label} season · ranks out of {n}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {teams.views.map((view) => (
          <section key={view.id}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{view.label}</h2>
            <div className="border border-[var(--border)] bg-[var(--card)] rounded-lg divide-y divide-[var(--border)]">
              {view.columns.map((c) => {
                const rank = c.ranks[team.abbr];
                const share = rank ? 1 - (rank - 1) / (n - 1) : 0;
                return (
                  <div key={c.key} className="px-3 py-2.5" title={c.desc}>
                    <div className="flex items-baseline justify-between text-[13px] tabular-nums">
                      <span className="text-[var(--text-muted)]">{c.desc.replace(/ per game$/i, "")}</span>
                      <span>
                        <span className="text-[var(--text)] font-medium">{fmtStat(team.v[c.key])}</span>
                        {rank && <span className="ml-2 text-[11px] text-[var(--text-faint)]">{ordinal(rank)}</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 h-px bg-[var(--border)]">
                      <div className="h-px bg-[var(--text)]" style={{ width: `${Math.max(3, share * 100)}%`, opacity: 0.55 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {roster.map(({ title, data }) => {
        const rows = data.rows.filter((r) => r.team === team.abbr).slice(0, s === "nba" ? 15 : 5);
        if (!rows.length) return null;
        const idx = data.columns.map((c) => c.label);
        return (
          <section key={title}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{title}</h2>
            <div className="overflow-x-auto border border-[var(--border)] bg-[var(--card)] rounded-lg">
              <table className="w-full text-[13px] tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                    <th className="px-3 py-2.5 text-left font-semibold">Player</th>
                    {idx.map((l, i) => (
                      <th key={i} title={data.columns[i].desc} className="px-2.5 py-2.5 text-right font-semibold whitespace-nowrap">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/stats/player/${s}/${r.id}`)} className="cursor-pointer hover:bg-[var(--surface-hover)]/60 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap text-[var(--text)] font-medium">
                        {r.name} <span className="text-[11px] font-normal text-[var(--text-faint)]">{r.pos}</span>
                      </td>
                      {r.v.map((v, i) => (
                        <td key={i} className="px-2.5 py-2.5 text-right text-[var(--text-muted)]">
                          {fmtStat(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
