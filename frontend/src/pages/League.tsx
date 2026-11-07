import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useSport } from "../lib/SportContext";
import { usePolling } from "../lib/usePolling";
import type { LeagueStats, Person, Recap, Rivalry, TalkPost } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { saveToPhone } from "../components/ExportModal";
import { SectionTitle, fmtPct, fmtRec, tone } from "../components/StatBits";

const EMOJIS = ["🔥", "😂", "💀", "👏", "🤡"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm ${className}`}>{children}</div>;
}

function Who({ p, size = 26 }: { p: Person; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar userId={p.user_id} version={p.avatar_version} name={p.display_name} size={size} />
      <span className="font-medium text-[var(--text)]">{p.display_name}</span>
    </span>
  );
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Th({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <th className={`px-4 py-2.5 text-center ${first ? "text-left" : "border-l border-[var(--border)]"}`}>{children}</th>;
}

export function LeaguePage() {
  const { user } = useAuth();
  const { sport } = useSport();
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [data, setData] = useState<LeagueStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    api
      .league(season)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [season, sport]);

  if (error) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Couldn't load the league.</div>;
  if (!data) return <div className="max-w-5xl mx-auto px-4 py-8 text-sm text-[var(--text-muted)]">Loading…</div>;

  const latest = data.seasons[0] ?? new Date().getFullYear();
  const byId = new Map(data.people.map((p) => [p.user_id, p]));

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">League</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Rivalries, who beats the closing line, who fades the room, and the weekly recap. Only stats your group can have.</p>
        </div>
        <select value={season ?? "all"} onChange={(e) => setSeason(e.target.value === "all" ? undefined : Number(e.target.value))} className="input" aria-label="Season">
          <option value="all">All seasons</option>
          {data.seasons.map((s) => (
            <option key={s} value={s}>
              {sport === "nba" ? `${s}-${String(s + 1).slice(2)}` : s} season
            </option>
          ))}
        </select>
      </div>

      <RecapSection season={season ?? latest} />
      <LockerRoom season={season ?? latest} meId={user?.user_id ?? 0} isAdmin={!!user?.is_admin} />
      <RivalrySection data={data} byId={byId} />
      <ClvSection data={data} />
      <RoomSection data={data} />
      <TailSection data={data} />
      <SpecialtySection data={data} />
      {data.model && <ModelSection data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------- recap

function RecapSection({ season }: { season: number }) {
  const [weeks, setWeeks] = useState<number[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.weeks(season).then((info) => {
      const done = info.weeks.filter((w) => w.complete).map((w) => w.week);
      const list = done.length ? done : info.weeks.map((w) => w.week);
      setWeeks(list);
      setWeek(list.length ? list[list.length - 1] : null);
    });
  }, [season]);

  useEffect(() => {
    if (week === null) return;
    setRecap(null);
    setMissing(false);
    api.recap(season, week).then(setRecap).catch(() => setMissing(true));
  }, [season, week]);

  async function share() {
    if (week === null) return;
    setBusy(true);
    try {
      const { slides } = await api.exportRecap(season, week);
      if (slides.length) await saveToPhone(slides);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <SectionTitle
        right={
          <div className="flex items-center gap-2">
            <select value={week ?? ""} onChange={(e) => setWeek(Number(e.target.value))} className="input" aria-label="Week">
              {weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
            <button onClick={share} disabled={!recap || busy} className="rounded-lg bg-[var(--accent)] text-[var(--accent-text)] px-3.5 py-2 text-sm font-semibold disabled:opacity-50">
              {busy ? "Rendering…" : "Share recap"}
            </button>
          </div>
        }
      >
        Weekly recap
      </SectionTitle>
      {missing && <div className="text-sm text-[var(--text-faint)]">No graded picks that week.</div>}
      {!recap && !missing && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
      {recap && (
        <Card className="p-4 sm:p-5 flex flex-col gap-4">
          {recap.winners.length > 0 && (
            <div className="flex items-center gap-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.07] p-4">
              <span className="text-3xl">👑</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  Week winner{recap.winner_streak ? ` · ${recap.winner_streak + 1} weeks running` : ""}
                  {!recap.complete && " · so far"}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {recap.winners.map((w) => (
                    <span key={w.user_id} className="flex items-center gap-2 font-display text-xl font-bold text-[var(--text)]">
                      <Avatar userId={w.user_id} version={w.avatar_version} name={w.display_name} size={32} />
                      {w.display_name}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  {fmtRec(recap.winners[0].ats)} ATS · {fmtPct(recap.winners[0].ats.win_pct)}
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {recap.people.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between py-2 text-sm">
                <Who p={p} />
                <span className="tabular-nums text-[var(--text-muted)]">
                  <b className="text-[var(--text)]">{fmtRec(p.ats)}</b> ATS <span className={tone(p.ats.win_pct, 52.4)}>{fmtPct(p.ats.win_pct)}</span>
                  <span className="mx-2 text-[var(--border)]">|</span>
                  <b className="text-[var(--text)]">{fmtRec(p.su)}</b> SU
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-sm text-[var(--text-muted)] border-l-4 border-[var(--accent)] pl-3">
            {recap.upset && (
              <div>
                <b className="text-[var(--text)]">Upset call:</b> {recap.upset.users.join(" & ")} hit {recap.upset.team} (+{recap.upset.line}) in {recap.upset.matchup}
              </div>
            )}
            {recap.lone_wolves.map((w) => (
              <div key={w.name + w.matchup}>
                <b className="text-[var(--text)]">Lone wolf:</b> {w.name} was alone on {w.team} ({w.matchup}) and cashed it
              </div>
            ))}
            {recap.model && recap.model.ats.win_pct !== null && (
              <div>
                <b className="text-[var(--text)]">The model:</b> {fmtRec(recap.model.ats)} ATS ({fmtPct(recap.model.ats.win_pct)}). Beat it: {recap.model.beat_by.join(", ") || "nobody"}
              </div>
            )}
            {recap.worst && (
              <div>
                <b className="text-[var(--text)]">Rough week:</b> {recap.worst.display_name} at {fmtRec(recap.worst.ats)} ATS
              </div>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- locker room

function LockerRoom({ season, meId, isAdmin }: { season: number; meId: number; isAdmin: boolean }) {
  const [posts, setPosts] = useState<TalkPost[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.talk().then(setPosts).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  usePolling(load, 180000);

  async function post() {
    if (!text.trim()) return;
    setError(null);
    try {
      await api.postTalk(text.trim(), season, null);
      setText("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't post.");
    }
  }

  async function react(id: number, emoji: string) {
    await api.reactTalk(id, emoji);
    load();
  }

  return (
    <section>
      <SectionTitle>Locker room</SectionTitle>
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && post()}
            maxLength={280}
            placeholder="Say something about your picks…"
            className="input flex-1"
          />
          <button onClick={post} className="rounded-lg bg-[var(--accent)] text-[var(--accent-text)] px-4 py-2 text-sm font-semibold">
            Post
          </button>
        </div>
        {error && <div className="text-xs text-[var(--destructive)]">{error}</div>}
        {posts.length === 0 && <div className="text-sm text-[var(--text-faint)]">Quiet in here. Be the first.</div>}
        <div className="flex flex-col gap-3">
          {posts.map((p) => (
            <div key={p.id} className="flex gap-3">
              <Avatar userId={p.user_id} version={p.avatar_version} name={p.display_name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-xs text-[var(--text-faint)]">
                  <span className="text-sm font-semibold text-[var(--text)]">{p.display_name}</span>
                  <span>{ago(p.created_at)}</span>
                  {(p.user_id === meId || isAdmin) && (
                    <button onClick={() => api.deleteTalk(p.id).then(load)} className="ml-auto hover:text-[var(--destructive)]">
                      delete
                    </button>
                  )}
                </div>
                <div className="text-sm text-[var(--text)] break-words">{p.body}</div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {EMOJIS.map((e) => {
                    const who = p.reactions[e] ?? [];
                    const mine = who.includes(meId);
                    return (
                      <button
                        key={e}
                        onClick={() => react(p.id, e)}
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${mine ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] hover:border-[var(--accent)]/50"} ${who.length || mine ? "" : "opacity-50"}`}
                      >
                        {e}
                        {who.length > 0 && <span className="ml-1 text-[var(--text-muted)]">{who.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------- rivalries

function RivalrySection({ data, byId }: { data: LeagueStats; byId: Map<number, Person> }) {
  const sorted = useMemo(
    () => [...data.rivalries].sort((a, b) => b.weeks.a + b.weeks.b + b.weeks.t - (a.weeks.a + a.weeks.b + a.weeks.t)),
    [data.rivalries]
  );
  const [sel, setSel] = useState<string | null>(null);
  const current: Rivalry | undefined = sorted.find((r) => `${r.a}-${r.b}` === sel) ?? sorted[0];
  if (!current) return null;
  const a = byId.get(current.a);
  const b = byId.get(current.b);
  if (!a || !b) return null;

  const lead = (x: number, y: number) => (x > y ? "text-emerald-500" : x < y ? "text-rose-500" : "text-[var(--text-muted)]");

  return (
    <section>
      <SectionTitle
        right={
          <select value={`${current.a}-${current.b}`} onChange={(e) => setSel(e.target.value)} className="input" aria-label="Rivalry">
            {sorted.map((r) => (
              <option key={`${r.a}-${r.b}`} value={`${r.a}-${r.b}`}>
                {byId.get(r.a)?.display_name} vs {byId.get(r.b)?.display_name}
              </option>
            ))}
          </select>
        }
      >
        Rivalries
      </SectionTitle>
      <Card className="p-4 sm:p-5 flex flex-col gap-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar userId={a.user_id} version={a.avatar_version} name={a.display_name} size={56} />
            <span className="font-semibold text-[var(--text)]">{a.display_name}</span>
          </div>
          <span className="font-display text-sm text-[var(--text-faint)]">VS</span>
          <div className="flex flex-col items-center gap-1.5">
            <Avatar userId={b.user_id} version={b.avatar_version} name={b.display_name} size={56} />
            <span className="font-semibold text-[var(--text)]">{b.display_name}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Weeks won (ATS)", l: current.weeks.a, r: current.weeks.b, sub: current.weeks.t ? `${current.weeks.t} tied` : "" },
            { label: "Head-to-head ATS", l: current.duels.ats.a, r: current.duels.ats.b, sub: "when you took opposite sides" },
            { label: "Head-to-head SU", l: current.duels.straight_up.a, r: current.duels.straight_up.b, sub: "when you took opposite sides" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">{s.label}</div>
              <div className="font-display text-3xl font-bold tabular-nums mt-1">
                <span className={lead(s.l, s.r)}>{s.l}</span>
                <span className="text-[var(--text-faint)] mx-2">–</span>
                <span className={lead(s.r, s.l)}>{s.r}</span>
              </div>
              <div className="text-[11px] text-[var(--text-faint)]">{s.sub || " "}</div>
            </div>
          ))}
        </div>

        {current.by_season.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)]">
                  <th className="text-left py-2">Season</th>
                  <th className="text-center py-2">Weeks</th>
                  <th className="text-center py-2">ATS duels</th>
                  <th className="text-center py-2">SU duels</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] tabular-nums">
                {current.by_season.map((s) => (
                  <tr key={s.season}>
                    <td className="py-2 font-semibold text-[var(--text)]">{s.season}</td>
                    <td className="py-2 text-center text-[var(--text-muted)]">
                      {s.weeks.a}–{s.weeks.b}
                      {s.weeks.t ? `–${s.weeks.t}` : ""}
                    </td>
                    <td className="py-2 text-center text-[var(--text-muted)]">
                      {s.duels.ats.a}–{s.duels.ats.b}
                    </td>
                    <td className="py-2 text-center text-[var(--text-muted)]">
                      {s.duels.straight_up.a}–{s.duels.straight_up.b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {current.recent.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-2">Latest disagreements</div>
            <div className="flex flex-col gap-1.5">
              {current.recent.map((d) => (
                <Link
                  key={d.game_id + d.market}
                  to={`/games/${d.game_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <span className="text-[var(--text-muted)]">
                    {d.matchup} · W{d.week} · {d.market === "ats" ? "ATS" : "SU"}
                  </span>
                  <span className="text-[var(--text)]">
                    {a.display_name} {d.a_pick} · {b.display_name} {d.b_pick}
                    <span className="ml-2 font-semibold text-emerald-500">{d.winner === "a" ? a.display_name : b.display_name} won it</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="text-xs text-[var(--text-faint)]">
          All time across {current.weeks.a + current.weeks.b + current.weeks.t} shared weeks (6+ ATS picks each). A duel only counts when exactly one of you won.
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------- CLV

function ClvSection({ data }: { data: LeagueStats }) {
  const rows = data.clv.people;
  if (!rows.length) return null;
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
  return (
    <section>
      <SectionTitle>Beating the closing line</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)] whitespace-nowrap">
              <Th first>Player</Th>
              <Th>ATS line value</Th>
              <Th>Beat the close</Th>
              <Th>O/U line value</Th>
              <Th>Pick timing</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] whitespace-nowrap">
            {rows.map((p) => (
              <tr key={p.user_id}>
                <td className="px-4 py-3">
                  <Who p={p} />
                </td>
                <td className={`px-4 py-3 text-center tabular-nums font-semibold border-l border-[var(--border)] ${p.ats ? (p.ats.avg >= 0 ? "text-emerald-500" : "text-rose-500") : ""}`}>
                  {p.ats ? `${sign(p.ats.avg)} pts` : "—"}
                  {p.ats && (
                    <span className="block text-[11px] font-normal text-[var(--text-faint)]">
                      {p.ats.n} picks · {fmtPct(p.ats.win_pct)} ATS
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-muted)] border-l border-[var(--border)]">
                  {p.ats ? `${p.ats.beat_pct}%` : "—"}
                  {p.ats && <span className="block text-[11px] text-[var(--text-faint)]">worse {p.ats.worse_pct}%</span>}
                </td>
                <td className={`px-4 py-3 text-center tabular-nums font-semibold border-l border-[var(--border)] ${p.total ? (p.total.avg >= 0 ? "text-emerald-500" : "text-rose-500") : ""}`}>
                  {p.total ? `${sign(p.total.avg)} pts` : "—"}
                  {p.total && <span className="block text-[11px] font-normal text-[var(--text-faint)]">{p.total.n} picks</span>}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-muted)] border-l border-[var(--border)]">
                  {p.avg_hours_early !== null ? (p.avg_hours_early >= 24 ? `${(p.avg_hours_early / 24).toFixed(1)}d early` : `${p.avg_hours_early}h early`) : "—"}
                  {p.last_minute_pct !== null && <span className="block text-[11px] text-[var(--text-faint)]">{p.last_minute_pct}% in the last hour</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-[var(--text-faint)] mt-2">
        Line value is how many points better your number was than the closing line (positive means the market moved your way after you picked). It separates skill from luck because it doesn't depend on whether the pick won. Only picks made in the app count ({data.clv.seasons.join(", ")}); imported spreadsheet seasons have no pick-time line.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- room

function RoomSection({ data }: { data: LeagueStats }) {
  const [market, setMarket] = useState<"ats" | "straight_up">("ats");
  const rows = data.crowd.people.filter((p) => (p.markets[market]?.n ?? 0) >= 10);
  const byId = new Map(data.people.map((p) => [p.user_id, p]));
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle
        right={
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(
              [
                ["ats", "ATS"],
                ["straight_up", "SU"],
              ] as const
            ).map(([m, t]) => (
              <button key={m} onClick={() => setMarket(m)} className={`px-3 py-1 rounded-md text-xs font-semibold ${market === m ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-muted)]"}`}>
                {t}
              </button>
            ))}
          </div>
        }
      >
        Reading the room
      </SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)] whitespace-nowrap">
              <Th first>Player</Th>
              <Th>Fades the room</Th>
              <Th>When fading</Th>
              <Th>When following</Th>
              <Th>Lone wolf</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] whitespace-nowrap">
            {rows.map((p) => {
              const m = p.markets[market];
              const base = market === "ats" ? 52.4 : 50;
              return (
                <tr key={p.user_id}>
                  <td className="px-4 py-3">
                    <Who p={p} />
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums font-semibold text-[var(--text)] border-l border-[var(--border)]">{fmtPct(m.fade_pct)}</td>
                  <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                    <span className="text-[var(--text)] font-medium">{fmtRec(m.fade_record)}</span>
                    <span className={`ml-1.5 text-[11px] ${tone(m.fade_record.win_pct, base)}`}>{fmtPct(m.fade_record.win_pct)}</span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums border-l border-[var(--border)]">
                    <span className="text-[var(--text)] font-medium">{fmtRec(m.follow_record)}</span>
                    <span className={`ml-1.5 text-[11px] ${tone(m.follow_record.win_pct, base)}`}>{fmtPct(m.follow_record.win_pct)}</span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-[var(--text-muted)] border-l border-[var(--border)]">{fmtRec(p.lone_wolf)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {data.crowd.lone_wolf_recent.length > 0 && (
        <Card className="p-4 mt-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)] mb-2">Latest lone-wolf wins</div>
          <div className="flex flex-col gap-1.5">
            {data.crowd.lone_wolf_recent.map((w) => (
              <Link key={w.game_id + w.user_id + w.market} to={`/games/${w.game_id}`} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
                <b className="text-[var(--text)]">{byId.get(w.user_id)?.display_name}</b> was alone on {w.selection} ({w.matchup}, W{w.week}) and cashed it
              </Link>
            ))}
          </div>
        </Card>
      )}
      <p className="text-xs text-[var(--text-faint)] mt-2">Fading means taking the other side from the majority of everyone else on that game (needs at least 3 people picking). Lone wolf is being the only one on a side while everyone else agreed.</p>
    </section>
  );
}

// ---------------------------------------------------------------- tail / fade

function TailSection({ data }: { data: LeagueStats }) {
  if (!data.tail.length) return null;
  const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
  return (
    <section>
      <SectionTitle>Tail them or fade them</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {data.tail.map((p) => (
          <Card key={p.user_id} className="p-4 flex flex-col gap-2">
            <Who p={p} />
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[10px] uppercase tracking-widest text-[var(--text-faint)]">Tail</div>
                <div className={`font-display text-xl font-bold tabular-nums ${p.tail_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{units(p.tail_units)}</div>
              </div>
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[10px] uppercase tracking-widest text-[var(--text-faint)]">Fade</div>
                <div className={`font-display text-xl font-bold tabular-nums ${p.fade_units >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{units(p.fade_units)}</div>
              </div>
            </div>
            <div className="text-[11px] text-[var(--text-faint)]">
              {p.n} ATS picks · {fmtRec(p.ats)}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-[var(--text-faint)] mt-2">What you'd have made betting one unit at −110 on every one of their ATS picks (tail), or on the other side of each (fade).</p>
    </section>
  );
}

// ---------------------------------------------------------------- specialties

function SpecialtySection({ data }: { data: LeagueStats }) {
  if (!data.specialties.length) return null;
  return (
    <section>
      <SectionTitle>Specialties</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.specialties.map((p) => (
          <Card key={p.user_id} className="p-4 flex flex-col gap-2.5">
            <Who p={p} />
            {(
              [
                ["Best spot", p.best, "text-emerald-500"],
                ["Worst spot", p.worst, "text-rose-500"],
              ] as const
            ).map(([title, s, color]) => (
              <div key={title} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-[var(--text-muted)]">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)] mr-2">{title}</span>
                  {s.label} <span className="text-[var(--text-faint)]">· {s.group}</span>
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  <span className="text-[var(--text-muted)] mr-2">{fmtRec(s.record)}</span>
                  <span className={`font-semibold ${color}`}>{fmtPct(s.record.win_pct)}</span>
                </span>
              </div>
            ))}
          </Card>
        ))}
      </div>
      <p className="text-xs text-[var(--text-faint)] mt-2">Best and worst slices of each person's ATS picks (at least 12 decided picks in a slice).</p>
    </section>
  );
}

// ---------------------------------------------------------------- model

function ModelSection({ data }: { data: LeagueStats }) {
  const m = data.model!;
  return (
    <section>
      <SectionTitle>Beat the model</SectionTitle>
      <Card className="p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--accent)]/15 text-lg">🤖</span>
          <div>
            <div className="font-semibold text-[var(--text)]">The Model</div>
            <div className="text-xs text-[var(--text-muted)]">
              {m.games_called} games called · {fmtRec(m.su)} SU · {fmtRec(m.ats)} ATS ({fmtPct(m.ats.win_pct)}) · {fmtRec(m.total)} O/U
            </div>
          </div>
        </div>
        {data.weeks_vs_model.length > 0 && (
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {data.weeks_vs_model.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between py-2 text-sm">
                <Who p={p} />
                <span className="tabular-nums text-[var(--text-muted)]">
                  beat it in <b className="text-emerald-500">{p.beat}</b> weeks · lost <b className="text-rose-500">{p.lost}</b>
                  {p.tied ? ` · tied ${p.tied}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <Link to="/vs-model" className="text-sm font-medium text-[var(--accent)]">
          Full model breakdown →
        </Link>
      </Card>
    </section>
  );
}
