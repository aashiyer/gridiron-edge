import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Game, PickCell, PickMarket, Record as PickRecord, StandingsEntry, StandingsResponse, WeekAward, WeekBoard } from "../lib/types";
import { fmtSpread } from "../components/GamePickCard";
import { TeamLogo } from "../components/TeamBadge";
import { Avatar } from "../components/Avatar";
import { usePolling } from "../lib/usePolling";

const MARKETS: { key: PickMarket; label: string }[] = [
  { key: "ats", label: "ATS" },
  { key: "straight_up", label: "SU" },
  { key: "total", label: "O/U" },
];

const PLAYOFF_LABELS: { [week: number]: string } = { 19: "Wild Card", 20: "Divisional", 21: "Conference", 22: "Super Bowl" };

const RESULT_CELL: { [result: string]: string } = {
  win: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  loss: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  push: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  pending: "bg-[var(--surface)] text-[var(--text)] border-[var(--border)]",
};

const RANK_STYLES: { [rank: number]: string } = {
  1: "text-amber-400",
  2: "text-[var(--text-muted)]",
  3: "text-orange-400",
};

function weekLabel(week: number) {
  return PLAYOFF_LABELS[week] ?? `Week ${week}`;
}

function fmtRecord(r: PickRecord) {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}

function fmtPct(p: number | null) {
  return p === null || p === undefined ? "—" : `${p}%`;
}

function cellLabel(market: PickMarket, pick: PickCell) {
  if (pick.missed || pick.selection === null) return "No pick";
  if (market === "straight_up") return pick.selection;
  if (market === "ats") return `${pick.selection}${pick.line !== null ? ` ${fmtSpread(pick.line)}` : ""}`;
  return `${pick.selection === "over" ? "O" : "U"}${pick.line !== null ? ` ${pick.line}` : ""}`;
}

export function LeaderboardPage() {
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [market, setMarket] = useState<PickMarket>("ats");
  const [view, setView] = useState<"season" | "week">("season");
  const [openGame, setOpenGame] = useState<string | null>(null);

  useEffect(() => {
    api.seasons().then((list) => {
      const latest = list.length ? Math.max(...list) : new Date().getFullYear();
      setCurrentSeason(latest);
      setSeason(latest);
    });
  }, []);

  useEffect(() => {
    if (season === null) return;
    let cancelled = false;
    setStandings(null);
    setBoard(null);
    api.leaderboardStandings(season).then((r) => {
      if (cancelled) return;
      setStandings(r);
      setWeek(r.current_week);
    });
    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    if (season === null || week === null) return;
    let cancelled = false;
    setBoard(null);
    setOpenGame(null);
    api.leaderboardWeek(season, week).then((r) => {
      if (!cancelled) setBoard(r);
    });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  usePolling(() => {
    if (season !== null && week !== null) api.leaderboardWeek(season, week).then(setBoard);
  }, 15 * 60 * 1000);

  const weeks = standings?.weeks ?? [];
  const weekIndex = weeks.findIndex((w) => w.week === week);

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8 flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Leaderboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Season standings, then every pick, game by game. Ranked by ATS win%. ATS and totals are graded against the closing line, so pending picks always show the current line. A skipped SU or ATS pick counts as a loss once the game is final.
          </p>
        </div>
        {currentSeason !== null && season !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className="input">
              {[currentSeason, currentSeason - 1, currentSeason - 2].map((s) => (
                <option key={s} value={s}>
                  {s} Season
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
            <button
              onClick={() => weekIndex > 0 && setWeek(weeks[weekIndex - 1].week)}
              disabled={weekIndex <= 0}
              aria-label="Previous week"
              className="h-9 w-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              ‹
            </button>
            <select value={week ?? ""} onChange={(e) => setWeek(Number(e.target.value))} className="input">
              {weeks.map((w) => (
                <option key={w.week} value={w.week}>
                  {weekLabel(w.week)}
                  {w.complete ? " ✓" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => weekIndex >= 0 && weekIndex < weeks.length - 1 && setWeek(weeks[weekIndex + 1].week)}
              disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
              aria-label="Next week"
              className="h-9 w-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              ›
            </button>
          </div>
          </div>
        )}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
            {view === "season" ? "Season Standings" : `${week !== null ? weekLabel(week) : "Week"} Standings`}
          </h2>
          <div role="tablist" aria-label="Standings view" className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(["season", "week"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${
                  view === v ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {v === "season" ? "Season" : "Week"}
              </button>
            ))}
          </div>
        </div>
        {view === "season" && !standings && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
        {view === "season" && standings && standings.entries.length === 0 && <EmptyNote text="No picks this season yet." />}
        {view === "season" && standings && standings.entries.length > 0 && <StandingsTable entries={standings.entries} />}
        {view === "week" && !board && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
        {view === "week" && board && board.users.length === 0 && <EmptyNote text="Nobody has picked this season yet." />}
        {view === "week" && board && board.users.length > 0 && <WeekStandingsTable board={board} />}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
            {week !== null ? weekLabel(week) : "Week"} Picks
          </h2>
          <div role="tablist" aria-label="Market" className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {MARKETS.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={market === m.key}
                onClick={() => setMarket(m.key)}
                className={`px-3.5 py-1.5 rounded-[10px] text-sm font-medium transition-colors ${
                  market === m.key ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {!board && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
        {board && board.users.length === 0 && <EmptyNote text="Nobody has picked this season yet." />}
        {board && board.users.length > 0 && (
          <WeekGrid board={board} market={market} openGame={openGame} onToggle={(id) => setOpenGame(openGame === id ? null : id)} />
        )}
      </section>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm">{text}</div>
  );
}

function YouBadge() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-full px-1.5 py-0.5 shrink-0">
      You
    </span>
  );
}

function AwardCell({ award, good }: { award: WeekAward | null; good: boolean }) {
  if (!award) return <span className="text-[var(--text-faint)]">—</span>;
  return (
    <span title={`ATS ${fmtRecord(award.ats)}`} className="tabular-nums whitespace-nowrap">
      <span className="text-[var(--text-faint)] text-xs">Wk {award.week} · </span>
      <span className={`font-semibold ${good ? "text-emerald-500" : "text-rose-500"}`}>{award.win_pct}%</span>
    </span>
  );
}

const YOU_TINT = "linear-gradient(color-mix(in srgb, var(--accent) 7%, transparent), color-mix(in srgb, var(--accent) 7%, transparent))";

function StandingsTable({ entries }: { entries: StandingsEntry[] }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)] whitespace-nowrap">
            <th className="sticky left-0 z-10 bg-[var(--card)] text-left px-4 py-2.5">Player</th>
            <th className="text-right px-3 py-2.5">ATS</th>
            <th className="text-right px-3 py-2.5">SU</th>
            <th className="text-right px-3 py-2.5">O/U</th>
            <th className="text-right px-3 py-2.5">Picked</th>
            <th className="text-right px-3 py-2.5">Best ATS wk</th>
            <th className="text-right px-3 py-2.5">Worst ATS wk</th>
            <th className="text-right px-4 py-2.5">ATS wk wins</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] whitespace-nowrap">
          {entries.map((e) => {
            const tint = e.is_you ? { backgroundImage: YOU_TINT } : undefined;
            return (
              <tr key={e.user_id}>
                <td style={tint} className="sticky left-0 z-10 bg-[var(--card)] px-4 py-3 font-medium text-[var(--text)]">
                  <span className="flex items-center gap-2.5">
                    <span className={`font-display font-bold w-4 text-center ${RANK_STYLES[e.rank] ?? "text-[var(--text-faint)]"}`}>{e.rank}</span>
                    <Avatar userId={e.user_id} version={e.avatar_version} name={e.display_name} size={28} />
                    <Link to={`/record?user=${e.user_id}`} className="hover:text-[var(--accent)] transition-colors" title="See their full record">
                      {e.display_name}
                    </Link>
                    {e.is_you && <YouBadge />}
                  </span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text)]">
                  <span className="font-semibold">{fmtPct(e.ats.win_pct)}</span>
                  <span className="text-[var(--text-muted)] ml-1.5">{fmtRecord(e.ats)}</span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                  {fmtRecord(e.straight_up)} <span className="text-[var(--text-faint)]">({fmtPct(e.straight_up.win_pct)})</span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">{fmtRecord(e.total)}</td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                  {e.games_picked}/{e.games_available}
                </td>
                <td style={tint} className="px-3 py-3 text-right">
                  <AwardCell award={e.best_week} good />
                </td>
                <td style={tint} className="px-3 py-3 text-right">
                  <AwardCell award={e.worst_week} good={false} />
                </td>
                <td style={tint} className="px-4 py-3 text-right tabular-nums font-semibold text-[var(--text)]">{e.week_wins}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekStandingsTable({ board }: { board: WeekBoard }) {
  const rows = board.users
    .map((u) => ({ user: u, rec: board.records[String(u.user_id)] }))
    .sort((a, b) => {
      const pa = a.rec?.ats.win_pct ?? -1;
      const pb = b.rec?.ats.win_pct ?? -1;
      if (pb !== pa) return pb - pa;
      const da = (a.rec?.ats.wins ?? 0) + (a.rec?.ats.losses ?? 0);
      const db = (b.rec?.ats.wins ?? 0) + (b.rec?.ats.losses ?? 0);
      return db - da;
    });
  const top = rows[0]?.rec?.ats.win_pct ?? null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] border-b border-[var(--border)] whitespace-nowrap">
            <th className="sticky left-0 z-10 bg-[var(--card)] text-left px-4 py-2.5">Player</th>
            <th className="text-right px-3 py-2.5">ATS</th>
            <th className="text-right px-3 py-2.5">SU</th>
            <th className="text-right px-3 py-2.5">O/U</th>
            <th className="text-right px-4 py-2.5">Picked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] whitespace-nowrap">
          {rows.map(({ user, rec }, i) => {
            const tint = user.is_you ? { backgroundImage: YOU_TINT } : undefined;
            const leader = top !== null && rec?.ats.win_pct === top;
            return (
              <tr key={user.user_id}>
                <td style={tint} className="sticky left-0 z-10 bg-[var(--card)] px-4 py-3 font-medium text-[var(--text)]">
                  <span className="flex items-center gap-2.5">
                    <span className={`font-display font-bold w-4 text-center ${RANK_STYLES[i + 1] ?? "text-[var(--text-faint)]"}`}>{i + 1}</span>
                    <Avatar userId={user.user_id} version={user.avatar_version} name={user.display_name} size={28} />
                    <Link to={`/record?user=${user.user_id}`} className="hover:text-[var(--accent)] transition-colors" title="See their full record">
                      {user.display_name}
                    </Link>
                    {user.is_you && <YouBadge />}
                    {board.complete && leader && <span title="Won the week">👑</span>}
                  </span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text)]">
                  <span className="font-semibold">{fmtPct(rec?.ats.win_pct ?? null)}</span>
                  <span className="text-[var(--text-muted)] ml-1.5">{rec ? fmtRecord(rec.ats) : "—"}</span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">
                  {rec ? fmtRecord(rec.straight_up) : "—"} <span className="text-[var(--text-faint)]">({fmtPct(rec?.straight_up.win_pct ?? null)})</span>
                </td>
                <td style={tint} className="px-3 py-3 text-right tabular-nums text-[var(--text-muted)]">{rec ? fmtRecord(rec.total) : "—"}</td>
                <td style={tint} className="px-4 py-3 text-right tabular-nums text-[var(--text-muted)]">
                  {rec?.games_picked ?? 0}/{board.games.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function kickoffLabel(g: Game) {
  if (g.status === "final") return `Final ${g.final_away_score}-${g.final_home_score}`;
  if (!g.kickoff_time) return "TBD";
  const d = new Date(g.kickoff_time);
  return isNaN(d.getTime()) ? g.kickoff_time : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function WeekGrid({
  board,
  market,
  openGame,
  onToggle,
}: {
  board: WeekBoard;
  market: PickMarket;
  openGame: string | null;
  onToggle: (gameId: string) => void;
}) {
  const leaders = useMemo(() => {
    const best = Math.max(...board.users.map((u) => board.records[String(u.user_id)]?.[market].win_pct ?? -1));
    return new Set(board.users.filter((u) => best >= 0 && (board.records[String(u.user_id)]?.[market].win_pct ?? -1) === best).map((u) => u.user_id));
  }, [board, market]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 190 + board.users.length * 96 }}>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            <th className="sticky left-0 z-10 bg-[var(--card)] text-left px-3 py-2.5 border-b border-[var(--border)]">Game</th>
            {board.users.map((u) => (
              <th key={u.user_id} className="px-2 py-2.5 text-center border-b border-[var(--border)]">
                <span className={`inline-flex items-center gap-1 max-w-[92px] ${u.is_you ? "text-[var(--accent)]" : ""}`}>
                  {board.complete && leaders.has(u.user_id) && <span title="Won the week">👑</span>}
                  <Avatar userId={u.user_id} version={u.avatar_version} name={u.display_name} size={22} />
                  <span className="truncate">{u.display_name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.games.map((g) => (
            <Fragment key={g.game_id}>
              <tr className="cursor-pointer hover:bg-[var(--surface-hover)]" onClick={() => onToggle(g.game_id)}>
                <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 border-b border-[var(--border)]">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] text-[var(--text-faint)] transition-transform ${openGame === g.game_id ? "rotate-90" : ""}`}>▸</span>
                    <TeamLogo team={g.away} size={20} className="w-5 h-5" />
                    <span className="text-xs font-semibold text-[var(--text)]">{g.away.abbr}</span>
                    <span className="text-[10px] text-[var(--text-faint)]">@</span>
                    <TeamLogo team={g.home} size={20} className="w-5 h-5" />
                    <span className="text-xs font-semibold text-[var(--text)]">{g.home.abbr}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5 ml-4">{kickoffLabel(g)}</div>
                </td>
                {board.users.map((u) => {
                  const pick = board.picks[g.game_id]?.[String(u.user_id)]?.[market];
                  return (
                    <td key={u.user_id} className="px-1.5 py-2 text-center border-b border-[var(--border)]">
                      {pick ? (
                        <span className={`inline-block rounded-md border px-1.5 py-1 text-xs font-semibold tabular-nums whitespace-nowrap ${RESULT_CELL[pick.result]}`}>
                          {cellLabel(market, pick)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-faint)]" title="No pick">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {openGame === g.game_id && (
                <tr>
                  <td colSpan={board.users.length + 1} className="bg-[var(--surface)] border-b border-[var(--border)] p-0">
                    <GameBreakdown game={g} board={board} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">Week record</td>
            {board.users.map((u) => {
              const rec = board.records[String(u.user_id)]?.[market];
              return (
                <td key={u.user_id} className="px-1.5 py-3 text-center tabular-nums">
                  <div className="text-[var(--text)]">{rec ? fmtRecord(rec) : "—"}</div>
                  <div className="text-[10px] text-[var(--text-faint)] font-normal">{rec ? fmtPct(rec.win_pct) : ""}</div>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GameBreakdown({ game, board }: { game: Game; board: WeekBoard }) {
  const spread = game.current_spread ?? game.home_spread_close;
  const total = game.current_total ?? game.total_close;
  const hasRealPick = (userId: number) => Object.values(board.picks[game.game_id]?.[String(userId)] ?? {}).some((p) => !p.missed);
  const missing = board.users.filter((u) => !hasRealPick(u.user_id));

  const columns: { market: PickMarket; title: string; sides: [string, string]; sideLabels: [string, string] }[] = [
    { market: "straight_up", title: "Straight up", sides: [game.away_team, game.home_team], sideLabels: [game.away.abbr, game.home.abbr] },
    { market: "ats", title: "Against the spread", sides: [game.away_team, game.home_team], sideLabels: [game.away.abbr, game.home.abbr] },
    { market: "total", title: "Total", sides: ["over", "under"], sideLabels: ["Over", "Under"] },
  ];

  return (
    <div className="p-4 flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        {spread !== null && (
          <span>
            Spread: {game.home.abbr} {fmtSpread(spread)}
          </span>
        )}
        {total !== null && <span>Total: {total}</span>}
        {game.status === "final" && (
          <span className="font-semibold text-[var(--text)]">
            Final: {game.away.abbr} {game.final_away_score} – {game.home.abbr} {game.final_home_score}
          </span>
        )}
        {missing.length > 0 && (
          <span className="text-[var(--text-faint)]">
            No picks{game.status === "final" ? " (counted as losses)" : ""}: {missing.map((u) => u.display_name).join(", ")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {columns.map((col) => {
          const sideRows = col.sides.map((side) =>
            board.users
              .map((u) => ({ user: u, pick: board.picks[game.game_id]?.[String(u.user_id)]?.[col.market] }))
              .filter((r) => r.pick && r.pick.selection === side)
          );
          const count = sideRows[0].length + sideRows[1].length;
          return (
            <div key={col.market} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-2">{col.title}</div>
              {count === 0 ? (
                <div className="text-xs text-[var(--text-faint)]">No picks</div>
              ) : (
                <>
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--surface)] mb-2.5">
                    <div className="bg-[var(--accent)]/60" style={{ width: `${(sideRows[0].length / count) * 100}%` }} />
                    <div className="bg-[var(--accent)]" style={{ width: `${(sideRows[1].length / count) * 100}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {sideRows.map((rows, i) => (
                      <div key={col.sides[i]}>
                        <div className="text-xs font-semibold text-[var(--text)] mb-1">
                          {col.sideLabels[i]} <span className="text-[var(--text-faint)] font-normal">{rows.length}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {rows.map(({ user, pick }) => (
                            <span
                              key={user.user_id}
                              className={`inline-flex items-center justify-between gap-1 rounded-md border px-1.5 py-0.5 text-xs ${RESULT_CELL[pick!.result]}`}
                            >
                              <span className="truncate">{user.display_name}</span>
                              <span className="font-bold">{pick!.result === "win" ? "✓" : pick!.result === "loss" ? "✗" : pick!.result === "push" ? "P" : ""}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
