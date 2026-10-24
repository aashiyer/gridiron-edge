import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSport } from "../lib/SportContext";
import type { RecordsResponse, WeekMark } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { TrendChart, type TrendMode } from "../components/TrendChart";
import { team_meta_lookup } from "../lib/localTeams";
import { Segmented, SectionTitle, fmtPct, fmtRec, fmtUnits, tone } from "../components/StatBits";

type Market = "ats" | "straight_up";

const ATS_BREAK_EVEN = 52.4;
const MIN_TEAM_SAMPLE = 5;

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
  const { sport } = useSport();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState(false);
  const [trendView, setTrendView] = useState<"cumulative" | "rolling">("cumulative");
  const [market, setMarket] = useState<Market>("ats");

  const userParam = params.get("user");
  const seasonParam = params.get("season");
  const userId = userParam ? Number(userParam) : undefined;
  const season = seasonParam && seasonParam !== "all" ? Number(seasonParam) : undefined;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setData(null);
    api
      .records({ user_id: userId, season })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [userId, season, sport]);

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
  const isAts = market === "ats";
  const rec = isAts ? sc.ats : sc.straight_up;
  const rank = isAts ? sc.rank_ats : sc.rank_su;
  const bestWeek = isAts ? sc.best_week_ats : sc.best_week_su;
  const worstWeek = isAts ? sc.worst_week_ats : sc.worst_week_su;
  const gradedPicks = rec.wins + rec.losses + rec.pushes;
  const trendMode: TrendMode = isAts ? (trendView === "cumulative" ? "units" : "rolling_ats") : trendView === "cumulative" ? "su_over" : "rolling_su";

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
                {sport === "nba" ? `${s}-${String(s + 1).slice(2)}` : s} season
              </option>
            ))}
          </select>
        </div>
      </div>

      <div role="tablist" aria-label="Market" className="flex gap-2">
        {(
          [
            ["straight_up", "Straight up"],
            ["ats", "ATS"],
          ] as [Market, string][]
        ).map(([value, text]) => (
          <button
            key={value}
            role="tab"
            aria-selected={market === value}
            onClick={() => setMarket(value)}
            className={`rounded-xl border px-5 py-2 text-sm font-semibold transition-colors ${
              market === value
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)]/50"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar userId={data.user.user_id} version={data.user.avatar_version} name={data.user.display_name} size={64} />
          <div>
            <div className="text-xl font-bold text-[var(--text)]">{data.user.display_name}</div>
            <div className="text-sm text-[var(--text-muted)]">
              {scope} · {gradedPicks.toLocaleString()} graded {isAts ? "ATS" : "straight-up"} picks
              {rank && (
                <span className="ml-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-2 py-0.5">
                  #{rank.rank} of {rank.of}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{isAts ? "Against the spread" : "Straight up"}</div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
            <div className={`text-5xl font-bold tabular-nums ${tone(rec.win_pct, baseline)}`}>{fmtPct(rec.win_pct)}</div>
            <div className="text-lg text-[var(--text-muted)] tabular-nums">
              {fmtRec(rec)}
              {isAts ? (
                <span className={`ml-3 font-semibold ${sc.ats_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtUnits(sc.ats_units)}</span>
              ) : (
                <span className={`ml-3 font-semibold ${rec.wins - rec.losses >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {rec.wins - rec.losses > 0 ? "+" : ""}
                  {rec.wins - rec.losses} over .500
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <WeekChip title={`Best ${isAts ? "ATS" : "straight-up"} week`} mark={bestWeek} good />
          <WeekChip title={`Worst ${isAts ? "ATS" : "straight-up"} week`} mark={worstWeek} good={false} />
        </div>
        <p className="text-xs text-[var(--text-faint)]">
          {isAts ? "Break-even against the spread is 52.4% at −110. " : ""}Weeks need 8+ graded picks to count. Only picks actually made count here; the leaderboard also counts skipped picks as losses.
        </p>
      </section>

      <section>
        <SectionTitle
          right={
            <Segmented
              label="Trend"
              value={trendView}
              options={[
                ["cumulative", isAts ? "Units" : "Over .500"],
                ["rolling", isAts ? "Rolling 25 ATS" : "Rolling 25 SU"],
              ]}
              onChange={setTrendView}
            />
          }
        >
          Trend
        </SectionTitle>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-3 sm:p-5">
          <TrendChart points={data.trend} mode={trendMode} />
        </div>
      </section>

      {data.season_rows.length > 0 && (
        <section>
          <SectionTitle>Season by season</SectionTitle>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5">Season</th>
                  <th className="text-right px-3 py-2.5">{isAts ? "ATS" : "Straight up"}</th>
                  <th className="text-right px-3 py-2.5">{isAts ? "Units" : "Over .500"}</th>
                  <th className="text-right px-4 py-2.5">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.season_rows.map((s) => {
                  const r = isAts ? s.ats : s.straight_up;
                  const rk = isAts ? s.rank_ats : s.rank_su;
                  const edge = isAts ? s.ats_units : r.wins - r.losses;
                  return (
                    <tr key={s.season} className="hover:bg-[var(--surface-hover)] cursor-pointer" onClick={() => update({ season: String(s.season) })}>
                      <td className="px-4 py-3 font-semibold text-[var(--text)]">{s.season}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <span className={`font-semibold ${tone(r.win_pct, baseline)}`}>{fmtPct(r.win_pct)}</span>
                        <span className="text-[var(--text-muted)] ml-1.5">{fmtRec(r)}</span>
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums font-semibold ${edge >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {isAts ? fmtUnits(s.ats_units) : `${edge > 0 ? "+" : ""}${edge}`}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-muted)]">{rk ? `#${rk.rank} of ${rk.of}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-2">Click a season to focus the page on it. Rank is by {isAts ? "ATS" : "straight-up"} % among people with 30+ graded picks that year.</p>
        </section>
      )}

      <section>
        <SectionTitle>Where the wins come from</SectionTitle>
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
          The thin marker on each bar is the {isAts ? "52.4% ATS break-even" : "50% line"}. Faded rows have fewer than 10 decided picks.
        </p>
      </section>

      <section>
        <SectionTitle>By team picked</SectionTitle>
        {teams.length === 0 && <div className="text-sm text-[var(--text-faint)]">No graded picks yet.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {teams.map(({ team, rec, n }) => {
            const meta = data.team_meta?.[team] ?? team_meta_lookup(team);
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
