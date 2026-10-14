import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DashboardSummary } from "../lib/types";
import { RecordPill } from "../components/RecordPill";
import { team_meta_lookup } from "../lib/localTeams";

export function RecordPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    api.dashboard().then(setSummary);
  }, []);

  if (!summary) return <div className="max-w-5xl mx-auto px-4 py-6 text-[var(--text-muted)] text-sm">Loading…</div>;

  const emptyRecord: DashboardSummary["straight_up"] = { wins: 0, losses: 0, pushes: 0, win_pct: null };
  const teams = Array.from(new Set([...Object.keys(summary.by_team), ...Object.keys(summary.su_by_team)]));
  const teamRows = teams
    .map((team) => ({ team, ats: summary.by_team[team] ?? emptyRecord, su: summary.su_by_team[team] ?? emptyRecord }))
    .sort((a, b) => (b.ats.win_pct ?? 0) - (a.ats.win_pct ?? 0));
  const fmtRec = (r: typeof emptyRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
  const weekRows = Object.entries(summary.by_week);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Your Record</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Break-even at standard -110 is <span className="text-[var(--text)] font-medium">{summary.break_even_pct}%</span>.{" "}
          {summary.pending_count} pick{summary.pending_count === 1 ? "" : "s"} still pending.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <RecordPill label="Straight Up" record={summary.straight_up} />
        <RecordPill label="Against the Spread" record={summary.ats} />
        <RecordPill label="Totals" record={summary.total} />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text)] mb-3">Tendencies</h2>
        <div className="flex flex-wrap gap-3">
          <RecordPill label="Picking Favorites (SU)" record={summary.tendencies.su_favorite} />
          <RecordPill label="Picking Underdogs (SU)" record={summary.tendencies.su_underdog} />
          <RecordPill label="Laying Points (ATS)" record={summary.tendencies.ats_laying} />
          <RecordPill label="Taking Points (ATS)" record={summary.tendencies.ats_taking} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text)] mb-3">Record by Team Picked</h2>
        {teamRows.length === 0 && <div className="text-sm text-[var(--text-faint)]">No graded picks yet.</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {teamRows.map(({ team, ats, su }) => {
            const meta = team_meta_lookup(team);
            return (
              <div key={team} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/40 px-3 py-2">
                {meta.logo && <img src={meta.logo} className="w-7 h-7" />}
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text)]">{team}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    ATS {fmtRec(ats)}
                    <span className="mx-1.5 text-[var(--text-faint)]">·</span>
                    SU {fmtRec(su)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text)] mb-3">Record by Week</h2>
        {weekRows.length === 0 && <div className="text-sm text-[var(--text-faint)]">No graded picks yet.</div>}
        <div className="flex flex-col gap-1">
          {weekRows.map(([week, split]) => (
            <div key={week} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)]/40 px-3 py-2">
              <span className="text-sm text-[var(--text-muted)]">{week}</span>
              <span className="text-sm text-[var(--text-muted)]">
                SU {split.straight_up.wins}-{split.straight_up.losses}
                {split.straight_up.pushes ? `-${split.straight_up.pushes}` : ""}
                {split.straight_up.win_pct !== null ? ` (${split.straight_up.win_pct}%)` : ""}
                <span className="mx-2 text-[var(--text-faint)]">·</span>
                ATS {split.ats.wins}-{split.ats.losses}
                {split.ats.pushes ? `-${split.ats.pushes}` : ""}
                {split.ats.win_pct !== null ? ` (${split.ats.win_pct}%)` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
