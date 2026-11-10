import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useTeams } from "../lib/useTeams";
import { usePolling } from "../lib/usePolling";
import type { LiveGameDetail, LivePick, LivePlay } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { TeamLogo } from "../components/TeamBadge";
import { LivePill, PickChip, statusText } from "../components/LiveBits";
import { LineMovementPanel, MakePickPanel, MatchupPanel, useGameDetail } from "./GameDetail";

type Tab = "plays" | "picks" | "stats" | "matchup" | "box";

function WinProb({ series, homeColor, awayAbbr, homeAbbr }: { series: number[]; homeColor: string; awayAbbr: string; homeAbbr: string }) {
  if (series.length < 3) return null;
  const W = 300;
  const H = 70;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - (v / 100) * H;
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-[var(--text-faint)] mb-1">
        <span>Win probability</span>
        <span className="tabular-nums">
          <b className="text-[var(--text)]">{last >= 50 ? homeAbbr : awayAbbr} {Math.round(last >= 50 ? last : 100 - last)}%</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none" role="img" aria-label="Win probability over the game">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeDasharray="3 3" />
        <path d={`${line} L${W},${H / 2} L0,${H / 2} Z`} fill={homeColor} opacity="0.12" />
        <path d={line} fill="none" stroke={homeColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
        <span>{homeAbbr} favored ↑</span>
        <span>↓ {awayAbbr} favored</span>
      </div>
    </div>
  );
}

function PicksCard({ picks }: { picks: LivePick[] }) {
  const people = useMemo(() => {
    const m = new Map<number, { name: string; version: number; picks: LivePick[] }>();
    picks.forEach((p) => {
      if (!m.has(p.user_id)) m.set(p.user_id, { name: p.name, version: p.avatar_version, picks: [] });
      m.get(p.user_id)!.picks.push(p);
    });
    const order = ["straight_up", "ats", "total"];
    return [...m.entries()].map(([id, v]) => ({ id, ...v, picks: v.picks.sort((a, b) => order.indexOf(a.market) - order.indexOf(b.market)) }));
  }, [picks]);
  if (!people.length) return null;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">Picks on this game</h2>
      <div className="flex flex-col gap-2.5">
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-2 w-28 shrink-0 text-sm font-medium text-[var(--text)]">
              <Avatar userId={p.id} version={p.version} name={p.name} size={24} />
              {p.name}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {p.picks.map((pk) => (
                <PickChip key={pk.market} p={pk} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LiveGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const sport = gameId?.startsWith("nba-") ? "nba" : "nfl";
  const meta = useTeams(sport);
  const [data, setData] = useState<LiveGameDetail | null>(null);
  const [plays, setPlays] = useState<LivePlay[]>([]);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [scoringOnly, setScoringOnly] = useState(false);
  const lastSeq = useRef<number | undefined>(undefined);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!gameId) return;
    const id = ++requestId.current;
    try {
      const r = await api.liveGame(gameId, lastSeq.current);
      if (id !== requestId.current) return;
      setData(r);
      setError(false);
      setPlays((cur) => {
        if (!r.incremental) return r.plays;
        const seen = new Set(cur.map((p) => p.id));
        return [...cur, ...r.plays.filter((p) => !seen.has(p.id))];
      });
      const top = r.plays.length ? Math.max(...r.plays.map((p) => p.seq)) : undefined;
      if (top !== undefined) lastSeq.current = Math.max(lastSeq.current ?? 0, top);
    } catch {
      if (id === requestId.current) setError(true);
    }
  }, [gameId]);

  useEffect(() => {
    setData(null);
    setPlays([]);
    lastSeq.current = undefined;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const live = data?.state === "in";
  const activeTab: Tab = tab ?? (data?.state === "pre" ? "picks" : "plays");
  const detailState = useGameDetail(gameId, activeTab === "picks" || activeTab === "matchup");
  usePolling(load, live ? 8000 : 60000, data?.state !== "post");

  const feed = useMemo(() => {
    const list = scoringOnly ? plays.filter((p) => p.scoring) : plays;
    return [...list].reverse();
  }, [plays, scoringOnly]);

  if (error && !data) return <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load this game. <Link to="/live" className="text-[var(--accent)]">Back to live</Link></div>;
  if (!data || !data.home || !data.away) return <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  const home = meta(data.home.abbr);
  const away = meta(data.away.abbr);
  const hs = data.home.score;
  const as = data.away.score;
  const leading = hs !== null && as !== null ? (hs > as ? "home" : as > hs ? "away" : null) : null;
  const tabs: [Tab, string][] = [["picks", "Picks"], ["plays", "Plays"], ["stats", "Stats"], ["matchup", "Matchup"]];
  if (sport === "nba" && Object.keys(data.box).length) tabs.push(["box", "Box score"]);

  const side = (t: typeof home, score: number | null, key: "home" | "away") => (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      <TeamLogo team={t} size={56} />
      <div className="font-display font-bold text-[var(--text)]">{t.abbr}</div>
      <div className={`font-display text-5xl tabular-nums ${leading === key ? "font-bold text-[var(--text)]" : "text-[var(--text-muted)]"}`}>{score ?? "–"}</div>
      <div className="text-[11px] text-[var(--text-faint)]">{(key === "home" ? data.home : data.away)?.record ?? ""}</div>
    </div>
  );

  let lastGroup: string | null = null;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link to="/live" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">← Live</Link>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <LivePill state={data.state}>{statusText({ ...data, start: "" }, sport)}</LivePill>
          <span className="text-[11px] text-[var(--text-faint)]">{data.tv.join(" · ")}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {side(away, as, "away")}
          <span className="text-[var(--text-faint)]">@</span>
          {side(home, hs, "home")}
        </div>
        {live && data.situation?.down_distance && (
          <div className="text-center text-sm text-[var(--text)]">
            <b>{data.situation.down_distance}</b>
            {data.situation.possession && <span className="text-[var(--text-muted)]"> · {data.situation.possession} ball</span>}
          </div>
        )}
        <WinProb series={data.winprob} homeColor={home.color} awayAbbr={away.abbr} homeAbbr={home.abbr} />
      </section>

      <div role="tablist" className="inline-flex self-start max-w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${activeTab === t ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "picks" && (
        <div className="flex flex-col gap-4">
          <MakePickPanel state={detailState} />
          <PicksCard picks={data.picks} />
          <LineMovementPanel state={detailState} />
        </div>
      )}

      {activeTab === "matchup" && <MatchupPanel state={detailState} />}

      {activeTab === "plays" && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Play by play</span>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" checked={scoringOnly} onChange={(e) => setScoringOnly(e.target.checked)} className="accent-[var(--accent)]" />
              Scoring only
            </label>
          </div>
          {feed.length === 0 && <div className="p-6 text-sm text-[var(--text-faint)] text-center">{data.state === "pre" ? "Plays show up once the game starts." : "No plays yet."}</div>}
          <div className="divide-y divide-[var(--border)]">
            {feed.map((p) => {
              const group = sport === "nfl" && p.drive !== null
                ? `d${p.drive}`
                : `p${p.period}`;
              const header = group !== lastGroup;
              lastGroup = group;
              const drive = sport === "nfl" && p.drive !== null ? data.drives.find((d) => d.id === p.drive) : null;
              return (
                <div key={p.id}>
                  {header && (
                    <div className="px-4 py-1.5 bg-[var(--surface)] text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center justify-between">
                      <span>
                        {sport === "nfl" && drive
                          ? `${drive.team ?? ""} drive${drive.result ? ` · ${drive.result}` : ""}`
                          : `${sport === "nba" ? "Quarter" : "Period"} ${p.period ?? ""}`}
                      </span>
                      {drive?.desc && <span className="normal-case font-normal text-[var(--text-faint)]">{drive.desc}</span>}
                    </div>
                  )}
                  <div className={`flex gap-3 px-4 py-2.5 text-sm ${p.scoring ? "bg-[var(--accent)]/[0.06]" : ""}`}>
                    <div className="w-14 shrink-0 text-[11px] text-[var(--text-faint)] tabular-nums pt-0.5">
                      <div>{p.clock}</div>
                      {sport === "nfl" && p.period && <div>Q{p.period}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {p.dd && sport === "nfl" && <div className="text-[11px] text-[var(--text-faint)]">{p.dd}</div>}
                      <div className={p.scoring ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"}>{p.text}</div>
                    </div>
                    {(p.scoring || sport === "nba") && p.away !== null && p.home !== null && (
                      <div className="text-xs tabular-nums text-[var(--text-muted)] whitespace-nowrap pt-0.5">
                        {data.away?.abbr} {p.away} · {data.home?.abbr} {p.home}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "stats" && (
        <div className="flex flex-col gap-4">
          {data.team_stats.length > 0 ? (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_1fr] px-4 py-2.5 border-b border-[var(--border)] text-sm font-semibold text-[var(--text)]">
                <span>{away.abbr}</span>
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-faint)]">Team stats</span>
                <span className="text-right">{home.abbr}</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {data.team_stats.map((s) => (
                  <div key={s.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2 text-sm">
                    <span className="tabular-nums text-[var(--text)]">{s.away}</span>
                    <span className="text-[11px] text-[var(--text-faint)] text-center px-2">{s.label}</span>
                    <span className="tabular-nums text-[var(--text)] text-right">{s.home}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="text-sm text-[var(--text-faint)]">Team stats appear once the game is underway.</div>
          )}
          {Object.keys(data.leaders).length > 0 && (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">Leaders</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[away, home].map((t) => (
                  <div key={t.abbr}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <TeamLogo team={t} size={18} />
                      <span className="text-sm font-semibold text-[var(--text)]">{t.abbr}</span>
                    </div>
                    {(data.leaders[t.abbr] ?? []).map((l) => (
                      <div key={l.category} className="flex items-center justify-between py-1 text-sm">
                        <span className="text-[var(--text)]">{l.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          <b className="text-[var(--text)]">{l.value}</b> {l.category.toLowerCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
          {data.scoring.length > 0 && (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border)] text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Scoring summary</div>
              <div className="divide-y divide-[var(--border)]">
                {data.scoring.map((s, i) => (
                  <div key={i} className="px-4 py-2.5 text-sm flex items-start justify-between gap-3">
                    <span>
                      <span className="text-[11px] text-[var(--text-faint)] mr-2">Q{s.period} {s.clock}</span>
                      <b className="text-[var(--text)]">{s.team}</b> <span className="text-[var(--text-muted)]">{s.text}</span>
                    </span>
                    <span className="text-xs tabular-nums text-[var(--text-muted)] whitespace-nowrap">{s.away}–{s.home}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === "box" &&
        [away, home].map((t) => {
          const b = data.box[t.abbr];
          if (!b) return null;
          const cols = b.labels.filter(Boolean);
          return (
            <section key={t.abbr} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
                <TeamLogo team={t} size={20} />
                <span className="text-sm font-bold text-[var(--text)]">{t.abbr}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums whitespace-nowrap">
                  <thead>
                    <tr className="text-[var(--text-faint)] border-b border-[var(--border)]">
                      <th className="sticky left-0 bg-[var(--card)] text-left px-4 py-2 font-semibold">Player</th>
                      {cols.map((c) => (
                        <th key={c} className="px-2 py-2 text-right font-semibold">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {b.players.map((p) => (
                      <tr key={p.name ?? ""}>
                        <td className="sticky left-0 bg-[var(--card)] px-4 py-1.5 text-[var(--text)]">
                          {p.short} <span className="text-[var(--text-faint)]">{p.position}</span>
                        </td>
                        {cols.map((c) => (
                          <td key={c} className="px-2 py-1.5 text-right text-[var(--text-muted)]">{p.stats[c] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      <p className="text-[11px] text-[var(--text-faint)]">Data from ESPN, usually 20 to 60 seconds behind the broadcast.{live ? " Refreshing every few seconds." : ""}</p>
    </div>
  );
}
