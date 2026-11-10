import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Sport } from "../lib/api";
import type { PlayerDetail } from "../lib/types";

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</div>
      <div className="text-[13px] text-[var(--text)]">{value}</div>
    </div>
  );
}

export function StatsPlayerPage() {
  const { sport, id } = useParams<{ sport: string; id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState(false);
  const s: Sport = sport === "nba" ? "nba" : "nfl";

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(false);
    api.statsPlayer(id, s).then(setData).catch(() => setError(true));
  }, [id, s]);

  if (error) return <div className="max-w-4xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load this player. <Link to="/stats" className="underline underline-offset-4">Back to stats</Link></div>;
  if (!data) return <div className="max-w-4xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  const p = data.profile;
  const groups = data.groups.length > 1 ? data.groups : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-8">
      <button onClick={() => navigate(-1)} className="self-start text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
        ← Stats
      </button>

      <header className="flex items-center gap-5">
        {p.headshot ? <img src={p.headshot} alt="" className="h-20 w-20 rounded-full object-cover bg-[var(--surface)]" /> : <div className="h-20 w-20 rounded-full bg-[var(--surface)]" />}
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">{p.name}</h1>
          <div className="mt-1 text-[13px] text-[var(--text-muted)]">
            {[p.jersey, p.pos, p.team_name].filter(Boolean).join(" · ")}
            {p.status && p.status !== "Active" ? ` · ${p.status}` : ""}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 border-y border-[var(--border)] py-4">
        <Fact label="Age" value={p.age} />
        <Fact label="Height / weight" value={[p.height, p.weight].filter(Boolean).join(" · ")} />
        <Fact label="Experience" value={p.experience} />
        <Fact label="Draft" value={p.draft} />
      </div>

      {data.summary.splits.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Season</h2>
          <div className="overflow-x-auto border border-[var(--border)] bg-[var(--card)] rounded-lg">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                  <th className="px-3 py-2.5 text-left font-semibold"> </th>
                  {data.summary.labels.map((l, i) => (
                    <th key={i} title={data.summary.descs[i]} className="px-2.5 py-2.5 text-right font-semibold whitespace-nowrap">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.summary.splits.map((sp) => (
                  <tr key={sp.label}>
                    <td className="px-3 py-2.5 text-[var(--text)] font-medium whitespace-nowrap">{sp.label}</td>
                    {sp.stats.map((v, i) => (
                      <td key={i} className="px-2.5 py-2.5 text-right text-[var(--text-muted)]">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Game log</h2>
        {data.games.length === 0 ? (
          <div className="text-sm text-[var(--text-faint)]">No games played yet this season.</div>
        ) : (
          <div className="overflow-x-auto border border-[var(--border)] bg-[var(--card)] rounded-lg">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                {groups.length > 0 && (
                  <tr className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                    <th colSpan={3} />
                    {groups.map((g) => (
                      <th key={g.name} colSpan={g.end - g.start} className="border-l border-[var(--border)] px-2.5 pt-2.5 text-left font-semibold">
                        {g.name}
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                  <th className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 text-left font-semibold">Date</th>
                  <th className="px-2.5 py-2.5 text-left font-semibold">Opp</th>
                  <th className="px-2.5 py-2.5 text-left font-semibold">Result</th>
                  {data.labels.map((l, i) => {
                    const start = groups.some((g) => g.start === i);
                    return (
                      <th key={i} className={`px-2.5 py-2.5 text-right font-semibold whitespace-nowrap ${start ? "border-l border-[var(--border)]" : ""}`}>
                        {l}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.games.map((g) => (
                  <tr key={g.id}>
                    <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
                      {g.date ? new Date(`${g.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-[var(--text)]">
                      <span className="text-[var(--text-faint)]">{g.home ? "vs" : "@"}</span> {g.opp}
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
                      <span className={g.result === "W" ? "text-emerald-500" : g.result === "L" ? "text-rose-500" : ""}>{g.result}</span> {g.score}
                    </td>
                    {g.stats.map((v, i) => {
                      const start = groups.some((gr) => gr.start === i);
                      return (
                        <td key={i} className={`px-2.5 py-2.5 text-right whitespace-nowrap text-[var(--text-muted)] ${start ? "border-l border-[var(--border)]" : ""}`}>
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
