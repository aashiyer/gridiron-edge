import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ModelCall, ModelStats, ModelWeekMark } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { TrendChart, type TrendMode } from "../components/TrendChart";
import { Segmented, SectionTitle, fmtPct, fmtRec, fmtUnits, tone } from "../components/StatBits";
import { team_meta_lookup } from "../lib/localTeams";

type Market = "su" | "ats" | "total";

const MARKET_TEXT: { [m in Market]: { tab: string; full: string; noun: string } } = {
  su: { tab: "Straight up", full: "Straight up", noun: "straight-up" },
  ats: { tab: "ATS", full: "Against the spread", noun: "ATS" },
  total: { tab: "Over / under", full: "Over / under", noun: "over/under" },
};
const BASELINE: { [m in Market]: number } = { su: 50, ats: 52.4, total: 52.4 };
const MIN_TEAM_SAMPLE = 4;

const RESULT_TONE: { [r: string]: string } = {
  win: "text-emerald-500",
  loss: "text-rose-500",
  push: "text-amber-500",
};

function WeekChip({ title, mark, good }: { title: string; mark: ModelWeekMark | null; good: boolean }) {
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

function Stat({ label, value, sub, valueClass }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-3.5 flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{label}</span>
      <span className={`font-display text-xl font-bold tabular-nums ${valueClass ?? "text-[var(--text)]"}`}>{value}</span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm ${className}`}>{children}</div>;
}

function PickLabel({ pick, data }: { pick: string; data: ModelStats }) {
  if (pick === "over" || pick === "under") return <span className="capitalize">{pick}</span>;
  const meta = data.team_meta[pick] ?? team_meta_lookup(pick);
  return (
    <span className="inline-flex items-center gap-1.5">
      {meta?.logo && <img src={meta.logo} alt="" className="w-4 h-4" />}
      {pick}
    </span>
  );
}

function CallRow({ c, data }: { c: ModelCall; data: ModelStats }) {
  return (
    <Link to={`/games/${c.game_id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-[var(--surface-hover)] rounded-lg px-2 -mx-2 transition-colors">
      <span className="flex items-center gap-2 min-w-0">
        <span className={`font-semibold uppercase text-xs w-8 ${RESULT_TONE[c.result]}`}>{c.result === "win" ? "Hit" : "Miss"}</span>
        <span className="text-[var(--text)] truncate">
          <PickLabel pick={c.lean} data={data} /> <span className="text-[var(--text-faint)]">· {c.label}</span>
        </span>
      </span>
      <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
        conf {c.confidence} · W{c.week} · {c.score}
      </span>
    </Link>
  );
}

export function VsModelPage() {
  const [data, setData] = useState<ModelStats | null>(null);
  const [error, setError] = useState(false);
  const [market, setMarket] = useState<Market>("ats");
  const [trendView, setTrendView] = useState<"cumulative" | "rolling">("cumulative");
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [userId, setUserId] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .modelStats({ season, user_id: userId })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [season, userId]);

  const teams = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.teams[market])
      .map(([team, v]) => ({ team, ...v, n: v.for.wins + v.for.losses }))
      .sort((a, b) => {
        const small = (n: number) => n < MIN_TEAM_SAMPLE;
        if (small(a.n) !== small(b.n)) return small(a.n) ? 1 : -1;
        return (b.for.win_pct ?? -1) - (a.for.win_pct ?? -1) || b.n - a.n;
      });
  }, [data, market]);

  if (error) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load the model's stats.</div>;
  if (!data) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  if (data.games_called === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-[var(--text)] mb-2">Model</h1>
        <p className="text-sm text-[var(--text-muted)]">The model's calls get saved about an hour before kickoff. Stats show up once games it called have gone final.</p>
      </div>
    );
  }

  const sc = data.scorecard[market];
  const rec = sc.record;
  const baseline = BASELINE[market];
  const decided = rec.wins + rec.losses + rec.pushes;
  const text = MARKET_TEXT[market];
  const me = data.people.find((p) => p.user_id === data.user_id);
  const mine = me?.markets[market];
  const crowd = data.crowd[market];
  const trendMode: TrendMode =
    market === "ats" ? (trendView === "cumulative" ? "units" : "rolling_ats") : market === "su" ? (trendView === "cumulative" ? "su_over" : "rolling_su") : trendView === "cumulative" ? "units" : "rolling_total";
  const baselineRec = market === "su" ? data.baselines.always_favorite_su : market === "ats" ? data.baselines.always_home_ats : data.baselines.always_over;
  const baselineText = market === "su" ? "Always picking the favorite" : market === "ats" ? "Always taking the home side" : "Always taking the over";
  const rows = data.people.filter((p) => p.markets[market]);
  const disagreements = data.disagreements.filter((d) => d.market === market);
  const crowdBeat = crowd.crowd.win_pct !== null && crowd.model.win_pct !== null ? crowd.model.win_pct - crowd.crowd.win_pct : null;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Model</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            The model's call on every game it covered, graded against the closing line, and how each of you compares. Units assume −110.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={data.user_id} onChange={(e) => setUserId(Number(e.target.value))} className="input" aria-label="Compare with">
            {data.people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                vs. {p.display_name}
              </option>
            ))}
          </select>
          <select value={season ?? "all"} onChange={(e) => setSeason(e.target.value === "all" ? undefined : Number(e.target.value))} className="input" aria-label="Season">
            <option value="all">All seasons</option>
            {data.available_seasons.map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </select>
        </div>
      </div>

      <div role="tablist" aria-label="Market" className="flex gap-2 flex-wrap">
        {(Object.keys(MARKET_TEXT) as Market[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={market === m}
            onClick={() => setMarket(m)}
            className={`rounded-xl border px-5 py-2 text-sm font-semibold transition-colors ${
              market === m
                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)]/50"
            }`}
          >
            {MARKET_TEXT[m].tab}
          </button>
        ))}
      </div>

      <Card className="p-4 sm:p-6 flex flex-col gap-5">
        <div>
          <div className="text-xl font-bold text-[var(--text)]">The model</div>
          <div className="text-sm text-[var(--text-muted)]">
            {season ? `${season} season` : "All seasons"} · {decided.toLocaleString()} graded {text.noun} calls
            {sc.pending > 0 && ` · ${sc.pending} awaiting a result`}
          </div>
        </div>
        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{text.full}</div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
            <div className={`text-5xl font-bold tabular-nums ${tone(rec.win_pct, baseline)}`}>{fmtPct(rec.win_pct)}</div>
            <div className="text-lg text-[var(--text-muted)] tabular-nums">
              {fmtRec(rec)}
              {sc.units !== null ? (
                <span className={`ml-3 font-semibold ${sc.units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtUnits(sc.units)}</span>
              ) : (
                <span className={`ml-3 font-semibold ${rec.wins - rec.losses >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {rec.wins - rec.losses > 0 ? "+" : ""}
                  {rec.wins - rec.losses} over .500
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={baselineText} value={fmtPct(baselineRec.win_pct)} sub={fmtRec(baselineRec)} valueClass={tone(baselineRec.win_pct, baseline)} />
          <Stat
            label="Current streak"
            value={sc.streaks.current ? `${sc.streaks.current.kind}${sc.streaks.current.length}` : "—"}
            valueClass={sc.streaks.current?.kind === "W" ? "text-emerald-500" : "text-rose-500"}
          />
          <Stat label="Longest win streak" value={sc.streaks.longest_win} />
          <Stat label="Longest losing streak" value={sc.streaks.longest_loss} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <WeekChip title={`Best ${text.noun} week`} mark={sc.best_week} good />
          <WeekChip title={`Worst ${text.noun} week`} mark={sc.worst_week} good={false} />
        </div>
        <p className="text-xs text-[var(--text-faint)]">
          {data.games_called} games called so far. The model saves its call about an hour before kickoff, so this is its real, un-revised record, not a backtest.
          {market !== "su" && " Break-even at −110 is 52.4%. "}
          {data.validation?.test_acc != null && ` Its ATS model scored ${data.validation.test_acc}% on the held-out ${data.validation.test_season} season when it was trained.`}
          {" "}Weeks need 6+ graded calls to count.
        </p>
      </Card>

      <section>
        <SectionTitle>You vs. the model</SectionTitle>
        {!mine ? (
          <div className="text-sm text-[var(--text-faint)]">No overlapping graded picks for this market yet.</div>
        ) : (
          <Card className="p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {me && <Avatar userId={me.user_id} version={me.avatar_version} name={me.display_name} size={40} />}
              <div>
                <div className="font-semibold text-[var(--text)]">{me?.display_name}</div>
                <div className="text-xs text-[var(--text-muted)]">On the {mine.n} games you both called.</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Them" value={fmtPct(mine.you.win_pct)} sub={fmtRec(mine.you)} valueClass={tone(mine.you.win_pct, baseline)} />
              <Stat label="Model, same games" value={fmtPct(mine.model.win_pct)} sub={fmtRec(mine.model)} valueClass={tone(mine.model.win_pct, baseline)} />
              <Stat label="Agreement" value={fmtPct(mine.agree_pct)} sub={`${mine.n - mine.disagree} of ${mine.n}`} />
              <Stat label="When you split" value={`${mine.you_right}–${mine.model_right}`} sub={`you vs model · ${mine.both_wrong} both wrong`} />
            </div>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>Everyone vs. the model</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)] whitespace-nowrap">
                <th className="sticky left-0 bg-[var(--card)] text-left px-4 py-2.5">Player</th>
                <th className="text-center px-4 py-2.5 border-l border-[var(--border)]">Them</th>
                <th className="text-center px-4 py-2.5 border-l border-[var(--border)]">Model</th>
                <th className="text-center px-4 py-2.5 border-l border-[var(--border)]">Edge</th>
                <th className="text-center px-4 py-2.5 border-l border-[var(--border)]">Agree</th>
                <th className="text-center px-4 py-2.5 border-l border-[var(--border)]">When split</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] whitespace-nowrap">
              {rows.map((p) => {
                const d = p.markets[market];
                const edge = d.you.win_pct !== null && d.model.win_pct !== null ? Math.round((d.you.win_pct - d.model.win_pct) * 10) / 10 : null;
                return (
                  <tr key={p.user_id} className="hover:bg-[var(--surface-hover)] cursor-pointer" onClick={() => setUserId(p.user_id)}>
                    <td className="sticky left-0 bg-[var(--card)] px-4 py-3 font-medium text-[var(--text)]">
                      <span className="flex items-center gap-2.5">
                        <Avatar userId={p.user_id} version={p.avatar_version} name={p.display_name} size={26} />
                        {p.display_name}
                        <span className="text-[11px] text-[var(--text-faint)]">{d.n}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                      <span className="block font-semibold text-[var(--text)]">{fmtRec(d.you)}</span>
                      <span className={`block text-[11px] ${tone(d.you.win_pct, baseline)}`}>{fmtPct(d.you.win_pct)}</span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                      <span className="block font-semibold text-[var(--text)]">{fmtRec(d.model)}</span>
                      <span className={`block text-[11px] ${tone(d.model.win_pct, baseline)}`}>{fmtPct(d.model.win_pct)}</span>
                    </td>
                    <td className={`px-4 py-3 text-center tabular-nums font-semibold border-l border-[var(--border)] ${edge === null ? "" : edge >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {edge === null ? "—" : `${edge > 0 ? "+" : ""}${edge}`}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-[var(--text-muted)] border-l border-[var(--border)]">{fmtPct(d.agree_pct)}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-[var(--text-muted)] border-l border-[var(--border)]">
                      {d.you_right}–{d.model_right}
                    </td>
                  </tr>
                );
              })}
              {crowd.games > 0 && (
                <tr className="bg-[var(--surface)]/60">
                  <td className="sticky left-0 bg-[var(--surface)] px-4 py-3 font-medium text-[var(--text)]">
                    Group consensus <span className="text-[11px] text-[var(--text-faint)]">{crowd.games}</span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                    <span className="block font-semibold text-[var(--text)]">{fmtRec(crowd.crowd)}</span>
                    <span className={`block text-[11px] ${tone(crowd.crowd.win_pct, baseline)}`}>{fmtPct(crowd.crowd.win_pct)}</span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                    <span className="block font-semibold text-[var(--text)]">{fmtRec(crowd.model)}</span>
                    <span className={`block text-[11px] ${tone(crowd.model.win_pct, baseline)}`}>{fmtPct(crowd.model.win_pct)}</span>
                  </td>
                  <td className={`px-4 py-3 text-center tabular-nums font-semibold border-l border-[var(--border)] ${crowdBeat === null ? "" : crowdBeat <= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {crowdBeat === null ? "—" : `${-crowdBeat > 0 ? "+" : ""}${Math.round(-crowdBeat * 10) / 10}`}
                  </td>
                  <td className="border-l border-[var(--border)]" colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-[var(--text-faint)] mt-2">
          Edge is their win % minus the model's on the same games (positive = they beat it). Group consensus is the side most of you took, on games at least two of you picked. Click a row to compare with that person.
        </p>
      </section>

      <section>
        <SectionTitle
          right={
            <Segmented
              label="Trend"
              value={trendView}
              options={[
                ["cumulative", market === "su" ? "Over .500" : "Units"],
                ["rolling", "Rolling 25"],
              ]}
              onChange={setTrendView}
            />
          }
        >
          Trend
        </SectionTitle>
        <Card className="p-3 sm:p-5">
          <TrendChart points={data.trend[market]} mode={trendMode} />
        </Card>
      </section>

      <section>
        <SectionTitle>Week by week</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-2.5">Week</th>
                <th className="text-center px-3 py-2.5 border-l border-[var(--border)]">SU</th>
                <th className="text-center px-3 py-2.5 border-l border-[var(--border)]">ATS</th>
                <th className="text-center px-3 py-2.5 border-l border-[var(--border)]">Units</th>
                <th className="text-center px-3 py-2.5 border-l border-[var(--border)]">O/U</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {[...data.weeks].reverse().map((w) => (
                <tr key={w.label} className={w.complete ? "" : "opacity-60"}>
                  <td className="px-4 py-2.5 font-semibold text-[var(--text)]">
                    {w.label}
                    {!w.complete && <span className="ml-2 text-[10px] font-normal text-[var(--text-faint)]">in progress</span>}
                  </td>
                  {(["su", "ats"] as const).map((m) => (
                    <td key={m} className="px-3 py-2.5 text-center tabular-nums border-l border-[var(--border)]">
                      <span className="text-[var(--text)] font-medium">{fmtRec(w[m])}</span>
                      <span className={`ml-1.5 text-[11px] ${tone(w[m].win_pct, BASELINE[m])}`}>{fmtPct(w[m].win_pct)}</span>
                    </td>
                  ))}
                  <td className={`px-3 py-2.5 text-center tabular-nums font-semibold border-l border-[var(--border)] ${w.ats_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtUnits(w.ats_units)}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums border-l border-[var(--border)]">
                    <span className="text-[var(--text)] font-medium">{fmtRec(w.total)}</span>
                    <span className={`ml-1.5 text-[11px] ${tone(w.total.win_pct, BASELINE.total)}`}>{fmtPct(w.total.win_pct)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {data.calibration[market].length > 0 && (
        <section>
          <SectionTitle>Does confidence mean anything?</SectionTitle>
          <Card className="p-4 flex flex-col gap-3">
            {data.calibration[market].map((b) => (
              <div key={b.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[var(--text)]">
                    Confidence {b.label} <span className="text-[11px] text-[var(--text-faint)]">{b.n} calls</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="text-[var(--text-muted)] mr-2">{fmtRec(b.record)}</span>
                    <span className={`font-semibold ${tone(b.record.win_pct, baseline)}`}>{fmtPct(b.record.win_pct)}</span>
                  </span>
                </div>
                <div className="relative h-1.5 mt-1 rounded-full bg-[var(--surface)]">
                  <div className={`h-full rounded-full ${b.record.win_pct !== null && b.record.win_pct >= baseline ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${b.record.win_pct ?? 0}%` }} />
                  <div className="absolute top-[-2px] h-[10px] w-px bg-[var(--text-faint)]" style={{ left: `${baseline}%` }} />
                </div>
              </div>
            ))}
          </Card>
          <p className="text-xs text-[var(--text-faint)] mt-2">Calls split into four equal groups by the model's own confidence. If confidence is meaningful, the bars should climb from top to bottom.</p>
        </section>
      )}

      <section>
        <SectionTitle>Where it's strong and weak</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.splits[market].map((group) => (
            <Card key={group.title} className="p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-3">{group.title}</div>
              <div className="flex flex-col gap-2.5">
                {group.items.map((item) => {
                  const n = item.record.wins + item.record.losses;
                  const pct = item.record.win_pct;
                  return (
                    <div key={item.label} title={`${n} decided calls`} className={n < 8 ? "opacity-60" : ""}>
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
            </Card>
          ))}
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-2">The thin marker is the {market === "su" ? "50% line" : "52.4% break-even"}. Faded rows have fewer than 8 decided calls.</p>
      </section>

      <section>
        <SectionTitle>{market === "total" ? "By team playing" : "By team"}</SectionTitle>
        {teams.length === 0 && <div className="text-sm text-[var(--text-faint)]">No graded calls yet.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {teams.map(({ team, for: f, against, n }) => {
            const meta = data.team_meta[team] ?? team_meta_lookup(team);
            const aN = against.wins + against.losses;
            return (
              <div key={team} title={`${n} calls ${market === "total" ? "in their games" : "on them"}`} className={`flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 ${n < MIN_TEAM_SAMPLE ? "opacity-50" : ""}`}>
                {meta?.logo && <img src={meta.logo} alt="" className="w-8 h-8 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">{team}</div>
                  <div className="text-xs tabular-nums">
                    <span className="text-[var(--text-muted)]">{market === "total" ? "" : "on "}{fmtRec(f)} </span>
                    <span className={`font-semibold ${tone(f.win_pct, baseline)}`}>{fmtPct(f.win_pct)}</span>
                  </div>
                  {market !== "total" && aN > 0 && (
                    <div className="text-[11px] tabular-nums text-[var(--text-faint)]">
                      against {fmtRec(against)} {fmtPct(against.win_pct)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-2">
          {market === "total" ? "The model's over/under record in each team's games." : "\"On\" is how the model does when it picks that team; \"against\" is when it picks their opponent."} Teams with fewer than {MIN_TEAM_SAMPLE} calls are faded and listed last.
        </p>
      </section>

      {(data.extremes[market].hits.length > 0 || data.extremes[market].misses.length > 0) && (
        <section>
          <SectionTitle>Its most confident calls</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-2">Biggest hits</div>
              {data.extremes[market].hits.map((c) => (
                <CallRow key={c.game_id} c={c} data={data} />
              ))}
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-rose-500 mb-2">Biggest misses</div>
              {data.extremes[market].misses.map((c) => (
                <CallRow key={c.game_id} c={c} data={data} />
              ))}
            </Card>
          </div>
        </section>
      )}

      {disagreements.length > 0 && (
        <section>
          <SectionTitle>
            When {me?.display_name ?? "you"} and the model split ({disagreements.length})
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {disagreements.map((d) => (
              <Link key={d.game_id + d.market} to={`/games/${d.game_id}`} className="block rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm px-4 py-3 hover:border-[var(--accent)]/40 transition-colors">
                <div className="flex items-center justify-between text-xs text-[var(--text-faint)] mb-2">
                  <span>
                    {d.matchup} · S{d.season} W{d.week}
                  </span>
                  <span>{d.score}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <span className="flex items-center gap-2 text-[var(--text-muted)]">
                    {me?.display_name ?? "You"}: <PickLabel pick={d.your_pick} data={data} />
                    <span className={`font-semibold uppercase text-xs ${RESULT_TONE[d.your_result]}`}>{d.your_result}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[var(--text-muted)]">
                    Model: <PickLabel pick={d.model_pick} data={data} />
                    <span className={`font-semibold uppercase text-xs ${RESULT_TONE[d.model_result]}`}>{d.model_result}</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
