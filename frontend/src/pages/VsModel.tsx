import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { VsModelSummary } from "../lib/types";
import { RecordPill } from "../components/RecordPill";

const resultColor: Record<string, string> = {
  win: "text-emerald-400",
  loss: "text-rose-400",
  push: "text-orange-400",
};

export function VsModelPage() {
  const [summary, setSummary] = useState<VsModelSummary | null>(null);

  useEffect(() => {
    api.vsModel().then(setSummary);
  }, []);

  if (!summary) return <div className="max-w-5xl mx-auto px-4 py-6 text-[var(--text-muted)] text-sm">Loading…</div>;

  if (summary.comparable_picks === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-[var(--text)] mb-2">You vs. the Model</h1>
        <p className="text-sm text-[var(--text-muted)]">
          No graded picks yet — the model snapshots its own call (straight-up, ATS, and over/under) whenever you make
          one, then this page compares the two once games go final.
          {summary.pending_comparable > 0 && ` (${summary.pending_comparable} pick(s) awaiting kickoff/grading.)`}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">You vs. the Model</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Comparing {summary.comparable_picks} graded pick(s) — straight-up, ATS, and over/under — against the model's
          own snapshotted call at the time you picked.
          {summary.pending_comparable > 0 && ` ${summary.pending_comparable} more awaiting grading.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <RecordPill label="You · SU" record={summary.your_record_su} />
        <RecordPill label="You · ATS" record={summary.your_record_ats} />
        <RecordPill label="You · O/U" record={summary.your_record_total} />
        <RecordPill label="Model · SU" record={summary.model_record_su} />
        <RecordPill label="Model · ATS" record={summary.model_record_ats} />
        <RecordPill label="Model · O/U" record={summary.model_record_total} />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm px-4 py-3 flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Agreement</span>
          <span className="font-display text-lg font-bold text-[var(--text)]">{summary.agreement_pct ?? "—"}%</span>
          <span className="text-sm text-[var(--text-muted)]">
            {summary.agree_count} of {summary.comparable_picks}
          </span>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text)] mb-3">When You Agreed</h2>
        <div className="flex gap-4 text-sm text-[var(--text-muted)]">
          <span className="text-emerald-400 font-medium">{summary.agree_and_won} won together</span>
          <span className="text-rose-400 font-medium">{summary.agree_and_lost} lost together</span>
        </div>
      </section>

      {summary.disagree_count > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--text)] mb-3">When You Disagreed ({summary.disagree_count})</h2>
          <div className="flex gap-4 text-sm mb-4">
            <span className="text-emerald-400 font-medium">You were right: {summary.you_right_on_disagree}</span>
            <span className="text-sky-400 font-medium">Model was right: {summary.model_right_on_disagree}</span>
            <span className="text-[var(--text-muted)] font-medium">Both wrong: {summary.both_wrong_on_disagree}</span>
          </div>

          <div className="flex flex-col gap-2">
            {summary.disagreements.map((d) => (
              <Link
                key={d.pick_id}
                to={`/games/${d.game_id}`}
                className="block rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm px-4 py-3 hover:border-[var(--accent)]/40 transition-colors"
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-faint)] mb-2">
                  <span>
                    {d.matchup} · S{d.season} W{d.week} · {d.pick_type.replace("_", " ").toUpperCase()}
                  </span>
                  <span>{d.final_score}</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    {d.your_pick_meta?.logo && <img src={d.your_pick_meta.logo} className="w-5 h-5" />}
                    <span className="text-[var(--text-muted)]">You: {d.your_pick_meta?.name ?? d.your_pick}</span>
                    <span className={`font-semibold uppercase text-xs ${resultColor[d.your_result] ?? "text-[var(--text-muted)]"}`}>
                      {d.your_result}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.model_pick_meta?.logo && <img src={d.model_pick_meta.logo} className="w-5 h-5" />}
                    <span className="text-[var(--text-muted)]">Model: {d.model_pick_meta?.name ?? d.model_pick}</span>
                    <span className={`font-semibold uppercase text-xs ${resultColor[d.model_result] ?? "text-[var(--text-muted)]"}`}>
                      {d.model_result}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
