import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Record as PickRecord, RecordsResponse, WeekMark } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { TrendChart } from "../components/TrendChart";
import { team_meta_lookup } from "../lib/localTeams";

type Market = "ats" | "straight_up";

const ATS_BREAK_EVEN = 52.4;
const MIN_TEAM_SAMPLE = 5;

function fmtRec(r: PickRecord) {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}

function fmtPct(p: number | null) {
  return p === null ? "—" : `${p}%`;
}

function fmtUnits(u: number) {
  return `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
}

function tone(pct: number | null, baseline: number) {
  if (pct === null) return "text-[var(--text-muted)]";
  return pct >= baseline ? "text-emerald-500" : "text-rose-500";
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${
            value === v ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">{children}</h2>
      {right}
    </div>
  );
}

function WeekChip({ title, mark, good }: { title: string; mark: WeekMark | null; good: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{title}</div>
      {mark ? (
        <div className="text-sm mt-0.5">
          <span className="text-[var(--text-muted)]">{mark.label} · </span>
          <span className={`font-semibold ${good ? "text-emerald-500" : "text-rose-500"}`}>
            {mark.wins}-{mark.losses}
            {mark.pushes ? `-${mark.pushes}` : ""} ({mark.win_pct}%)
          </span>
        </div>
      ) : (
        <div className="text-sm text-[var(--text-faint)] mt-0.5">—</div>
      )}
    </div>
  );
}

export function RecordPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"units" | "rolling">("units");
  const [market, setMarket] = useState<Market>("ats");

  const userParam = params.get("user");
  const seasonParam = params.get("season");
  const userId = userParam ? Number(userParam) : undefined;
  const season = seasonParam && seasonParam !== "all" ? Number(seasonParam) : undefined;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .records({ user_id: userId, season })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [userId, season]);

  function update(next: { user?: number | null; season?: string | null }) {
    const p = new URLSearchParams(params);
    if (next.user !== undefined) next.user === null ? p.delete("user") : p.set("user", String(next.user));
    if (next.season !== undefined) next.season === null || next.season === "all" ? p.delete("season") : p.set("season", next.season);
    setParams(p, { replace: true });
  }

  const baseline = market === "ats" ? ATS_BREAK_EVEN : 50;
  const teams = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.teams[market])
      .map(([team, rec]) => ({ team, rec, n: rec.wins + rec.losses }))
      .sort((a, b) => {
        const aSmall = a.n < MIN_TEAM_SAMPLE;
        const bSmall = b.n < MIN_TEAM_SAMPLE;
        if (aSmall !== bSmall) return aSmall ? 1 : -1;
        return (b.rec.win_pct ?? -1) - (a.rec.win_pct ?? -1) || b.n - a.n;
      });
  }, [data, market]);

  if (error) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load that record.</div>;
  if (!data) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  const sc = data.scorecard;
  const scope = season ? `${season} season` : "All time";

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Record</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {data.is_you ? "Your picks" : `${data.user.display_name}'s picks`}, graded against the closing line. Units assume standard −110 odds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={data.user.user_id} onChange={(e) => update({ user: Number(e.target.value) })} className="input" aria-label="Whose record">
            {data.people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <select value={season ?? "all"} onChange={(e) => update({ season: e.target.value })} className="input" aria-label="Season">
            <option value="all">All time</option>
            {data.available_seasons.map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar userId={data.user.user_id} version={data.user.avatar_version} name={data.user.display_name} size={64} />
          <div>
            <div className="text-xl font-bold text-[var(--text)]">{data.user.display_name}</div>
            <div className="text-sm text-[var(--text-muted)]">
              {scope} · {sc.decided_picks.toLocaleString()} graded picks
              {sc.rank && (
                <span className="ml-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-2 py-0.5">
                  #{sc.rank.rank} of {sc.rank.of} ATS
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">Against the spread</div>
            <div className={`text-4xl font-bold tabular-nums mt-1 ${tone(sc.ats.win_pct, ATS_BREAK_EVEN)}`}>{fmtPct(sc.ats.win_pct)}</div>
            <div className="text-sm text-[var(--text-muted)] tabular-nums mt-1">
              {fmtRec(sc.ats)} ·{" "}
              <span className={`font-semibold ${sc.ats_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtUnits(sc.ats_units)}</span>
            </div>
          </div>
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">Straight up</div>
            <div className={`text-4xl font-bold tabular-nums mt-1 ${tone(sc.straight_up.win_pct, 50)}`}>{fmtPct(sc.straight_up.win_pct)}</div>
            <div className="text-sm text-[var(--text-muted)] tabular-nums mt-1">{fmtRec(sc.straight_up)}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <WeekChip title="Best week" mark={sc.best_week} good />
          <WeekChip title="Worst week" mark={sc.worst_week} good={false} />
        </div>
        <p className="text-xs text-[var(--text-faint)]">Break-even against the spread is 52.4% at −110. Only picks you actually made count here; the leaderboard also counts skipped picks as losses.</p>
      </section>

      <section>
        <SectionTitle
          right={
            <Segmented
              label="Trend"
              value={mode}
              options={[
                ["units", "Units"],
                ["rolling", "Rolling 25 ATS"],
              ]}
              onChange={setMode}
            />
          }
        >
          Trend
        </SectionTitle>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-3 sm:p-5">
          <TrendChart points={data.trend} mode={mode} />
        </div>
      </section>

      {data.season_rows.length > 0 && (
        <section>
          <SectionTitle>Season by season</SectionTitle>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5">Season</th>
                  <th className="text-right px-3 py-2.5">ATS</th>
                  <th className="text-right px-3 py-2.5">Units</th>
                  <th className="text-right px-3 py-2.5">Straight up</th>
                  <th className="text-right px-4 py-2.5">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.season_rows.map((s) => (
                  <tr key={s.season} className="hover:bg-[var(--surface-hover)] cursor-pointer" onClick={() => update({ season: String(s.season) })}>
                    <td className="px-4 py-3 font-semibold text-[var(--text)]">{s.season}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className={`font-semibold ${tone(s.ats.win_pct, ATS_BREAK_EVEN)}`}>{fmtPct(s.ats.win_pct)}</span>
                      <span className="text-[var(--text-muted)] ml-1.5">{fmtRec(s.ats)}</span>
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums font-semibold ${s.ats_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtUnits(s.ats_units)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                      {fmtRec(s.straight_up)} <span className="text-[var(--text-faint)]">({fmtPct(s.straight_up.win_pct)})</span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{s.rank ? `#${s.rank.rank} of ${s.rank.of}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-2">Click a season to focus the page on it. Rank is by ATS % among people with 30+ graded picks that year.</p>
        </section>
      )}

      <section>
        <SectionTitle
          right={
            <Segmented
              label="Market"
              value={market}
              options={[
                ["ats", "Against the spread"],
                ["straight_up", "Straight up"],
              ]}
              onChange={setMarket}
            />
          }
        >
          Where the wins come from
        </SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.splits[market].map((group) => (
            <div key={group.title} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-3">{group.title}</div>
              <div className="flex flex-col gap-2.5">
                {group.items.map((item) => {
                  const n = item.record.wins + item.record.losses;
                  const pct = item.record.win_pct;
                  return (
                    <div key={item.label} title={`${n} decided picks`} className={n < 10 ? "opacity-60" : ""}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-[var(--text)]">{item.label}</span>
                        <span className="tabular-nums">
                          <span className="text-[var(--text-muted)] mr-2">{fmtRec(item.record)}</span>
                          <span className={`font-semibold ${tone(pct, baseline)}`}>{fmtPct(pct)}</span>
                        </span>
                      </div>
                      <div className="relative h-1.5 mt-1 rounded-full bg-[var(--surface)]">
                        <div className={`h-full rounded-full ${pct !== null && pct >= baseline ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${pct ?? 0}%` }} />
                        <div className="absolute top-[-2px] h-[10px] w-px bg-[var(--text-faint)]" style={{ left: `${baseline}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-2">
          The thin marker on each bar is the {market === "ats" ? "52.4% ATS break-even" : "50% line"}. Faded rows have fewer than 10 decided picks.
        </p>
      </section>

      <section>
        <SectionTitle>By team picked</SectionTitle>
        {teams.length === 0 && <div className="text-sm text-[var(--text-faint)]">No graded picks yet.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {teams.map(({ team, rec, n }) => {
            const meta = team_meta_lookup(team);
            return (
              <div
                key={team}
                title={`${n} decided picks`}
                className={`flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 ${n < MIN_TEAM_SAMPLE ? "opacity-50" : ""}`}
              >
                {meta.logo && <img src={meta.logo} alt="" className="w-8 h-8 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">{team}</div>
                  <div className="text-xs tabular-nums">
                    <span className="text-[var(--text-muted)]">{fmtRec(rec)} </span>
                    <span className={`font-semibold ${tone(rec.win_pct, baseline)}`}>{fmtPct(rec.win_pct)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-2">Sorted best to worst. Teams picked fewer than {MIN_TEAM_SAMPLE} times are faded and listed last.</p>
      </section>
    </div>
  );
}
