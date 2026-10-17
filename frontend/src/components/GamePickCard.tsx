import { Link } from "react-router-dom";
import type { Game, KalshiGame, Pick, Recommendation, TeamRecord } from "../lib/types";
import { atsProbs, fmtPct, totalProbs, type PickerView } from "../lib/kalshi";
import { TeamLogo } from "./TeamBadge";
import { usePickToggle } from "../lib/usePickToggle";

export function fmtSpread(n: number | null) {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function GamePickCard({
  game,
  existingPicks,
  rec,
  loadingRec,
  onPickMade,
  view = "spread",
  kalshi = null,
  detailLink = true,
}: {
  game: Game;
  existingPicks: Pick[];
  rec: Recommendation | null;
  loadingRec: boolean;
  onPickMade: () => void;
  view?: PickerView;
  kalshi?: KalshiGame | null;
  detailLink?: boolean;
}) {
  const { selectionFor, togglePick, locked, error } = usePickToggle(game, existingPicks, onPickMade);

  const spread = game.current_spread ?? game.home_spread_close;
  const total = game.current_total ?? game.total_close;

  const percent = view === "percent";
  const win = percent ? kalshi?.win ?? null : null;
  const ats = percent ? atsProbs(kalshi, spread) : null;
  const tot = percent ? totalProbs(kalshi, total) : null;

  const mlAway = game.current_away_ml ?? game.away_ml_close ?? null;
  const mlHome = game.current_home_ml ?? game.home_ml_close ?? null;

  const resultFor = (pickType: string): Pick["result"] | undefined =>
    existingPicks.find((p) => p.pick_type === pickType)?.result;

  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-4 ${
        locked ? "opacity-90" : ""
      }`}
    >
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{fmtKickoff(game.kickoff_time)}</span>
        <span className={`uppercase tracking-wide ${locked ? "text-orange-400 font-semibold" : ""}`}>
          {locked ? "🔒 Locked" : game.status.replace("_", " ")}
        </span>
      </div>

      {detailLink ? (
        <Link
          to={`/games/${game.game_id}`}
          className="grid grid-cols-2 gap-2 -m-1 p-1 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
          title="View full game details"
        >
          <TeamColumn team={game.away} score={game.final_away_score} record={rec?.away_record} />
          <TeamColumn team={game.home} score={game.final_home_score} record={rec?.home_record} />
        </Link>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <TeamColumn team={game.away} score={game.final_away_score} record={rec?.away_record} />
          <TeamColumn team={game.home} score={game.final_home_score} record={rec?.home_record} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PickButton
          active={selectionFor("ats") === game.away_team}
          result={resultFor("ats")}
          edge={rec?.lean_ats === game.away_team}
          disabled={locked || spread === null}
          hint={`${game.away.name} ${spread !== null ? fmtSpread(-spread) : ""} spread`}
          color={game.away.color}
          secondary={game.away.secondary}
          onClick={() => togglePick("ats", game.away_team, spread !== null ? -spread : null)}
        >
          <Cell
            main={ats ? fmtPct(ats.away) : spread !== null ? fmtSpread(-spread) : "—"}
          />
        </PickButton>
        <PickButton
          active={selectionFor("ats") === game.home_team}
          result={resultFor("ats")}
          edge={rec?.lean_ats === game.home_team}
          disabled={locked || spread === null}
          hint={`${game.home.name} ${spread !== null ? fmtSpread(spread) : ""} spread`}
          color={game.home.color}
          secondary={game.home.secondary}
          onClick={() => togglePick("ats", game.home_team, spread)}
        >
          <Cell
            main={ats ? fmtPct(ats.home) : spread !== null ? fmtSpread(spread) : "—"}
          />
        </PickButton>

        <PickButton
          active={selectionFor("straight_up") === game.away_team}
          result={resultFor("straight_up")}
          edge={rec?.lean_straight_up === game.away_team}
          disabled={locked}
          hint={`${game.away.name} to win outright`}
          color={game.away.color}
          secondary={game.away.secondary}
          onClick={() => togglePick("straight_up", game.away_team, null)}
        >
          <Cell
            main={win ? fmtPct(win.away) : mlAway !== null ? fmtSpread(mlAway) : "ML"}
          />
        </PickButton>
        <PickButton
          active={selectionFor("straight_up") === game.home_team}
          result={resultFor("straight_up")}
          edge={rec?.lean_straight_up === game.home_team}
          disabled={locked}
          hint={`${game.home.name} to win outright`}
          color={game.home.color}
          secondary={game.home.secondary}
          onClick={() => togglePick("straight_up", game.home_team, null)}
        >
          <Cell
            main={win ? fmtPct(win.home) : mlHome !== null ? fmtSpread(mlHome) : "ML"}
          />
        </PickButton>

        <PickButton
          active={selectionFor("total") === "over"}
          result={resultFor("total")}
          edge={rec?.lean_total === "over"}
          disabled={locked || total === null}
          hint={`Over ${total ?? ""}`}
          color={game.away.color}
          secondary={game.away.secondary}
          onClick={() => togglePick("total", "over", total)}
        >
          <Cell main={tot ? fmtPct(tot.over) : total !== null ? `O ${total}` : "—"} />
        </PickButton>
        <PickButton
          active={selectionFor("total") === "under"}
          result={resultFor("total")}
          edge={rec?.lean_total === "under"}
          disabled={locked || total === null}
          hint={`Under ${total ?? ""}`}
          color={game.home.color}
          secondary={game.home.secondary}
          onClick={() => togglePick("total", "under", total)}
        >
          <Cell main={tot ? fmtPct(tot.under) : total !== null ? `U ${total}` : "—"} />
        </PickButton>
      </div>

      {error && <div className="text-xs text-[var(--destructive)]">{error}</div>}


      {(loadingRec || rec) && (
      <div className="rounded-xl bg-gradient-to-br from-[var(--accent)]/[0.08] to-[var(--accent)]/[0.05] border border-[var(--accent)]/15 p-2 sm:p-3">
        {loadingRec && <div className="text-xs text-[var(--text-muted)] animate-pulse">Analyzing historical trends…</div>}
        {rec && !loadingRec && (
          <>
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap sm:block">
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[var(--accent)] sm:mb-1 sm:block">
                ⬥ Edge
              </span>
              <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap sm:flex-col sm:items-stretch sm:gap-0.5 sm:mb-2">
                <LeanLine label="Straight Up" shortLabel="SU" team={rec.lean_straight_up} confidence={rec.confidence_straight_up} />
                <LeanLine label="ATS" shortLabel="ATS" team={rec.lean_ats} confidence={rec.confidence_ats} />
                <LeanLine
                  label="Total"
                  shortLabel="O/U"
                  team={rec.lean_total ? (rec.lean_total === "over" ? "Over" : "Under") : null}
                  confidence={rec.confidence_total}
                />
                {rec.lean_straight_up && rec.lean_ats && rec.lean_straight_up !== rec.lean_ats && (
                  <span className="hidden sm:block text-[11px] text-orange-400/90 mt-0.5">
                    Split call — more likely to win vs. more likely to cover point in different directions.
                  </span>
                )}
              </div>
            </div>
            <details className="group mt-1 sm:mt-0">
              <summary className="text-[11px] sm:text-xs text-[var(--accent)]/90 cursor-pointer select-none list-none flex items-center gap-1 hover:text-[var(--accent)]">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                Why? ({rec.reasons.length} factors)
              </summary>
              <ul className="text-xs text-[var(--text-muted)] leading-relaxed space-y-1 list-disc list-inside marker:text-[var(--accent)]/60 mt-2">
                {rec.reasons.map((r, i) => (
                  <li key={i} className={r.highlight ? "font-semibold text-[var(--text)]" : undefined}>
                    {r.text}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
      )}
    </div>
  );
}

function LeanLine({
  label,
  shortLabel,
  team,
  confidence,
}: {
  label: string;
  shortLabel: string;
  team: string | null;
  confidence: number;
}) {
  const strength = confidence >= 1.5 ? "strong" : confidence >= 0.5 ? "moderate" : "slight";
  return (
    <div className="flex items-center gap-1.5 text-xs sm:text-sm">
      <span className="text-[10px] sm:text-xs text-[var(--text-faint)] sm:w-20 shrink-0">
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      {team ? (
        <span className="font-semibold text-[var(--text)]">
          {team} <span className="hidden sm:inline text-[var(--text-muted)] font-normal">({strength})</span>
        </span>
      ) : (
        <span className="text-[var(--text-muted)]">
          <span className="sm:hidden">—</span>
          <span className="hidden sm:inline">No clear edge</span>
        </span>
      )}
    </div>
  );
}

function TeamColumn({ team, score, record }: { team: Game["home"]; score: number | null; record?: TeamRecord }) {
  const hasRecord = record && (record.wins || record.losses || record.ties);
  const nickname = team.name.split(" ").slice(-1)[0];
  return (
    <div className="flex flex-col items-center text-center gap-0.5">
      <TeamLogo team={team} size={44} className="w-9 h-9 sm:w-11 sm:h-11" />
      <div className="font-display font-bold text-sm sm:text-base text-[var(--text)] leading-tight">{nickname}</div>
      {score !== null && <div className="text-sm text-[var(--text-muted)] tabular-nums">{score}</div>}
      {hasRecord && (
        <div className="text-[10px] text-sky-400/80 font-medium tracking-wide">
          {record!.wins}-{record!.losses}
          {record!.ties ? `-${record!.ties}` : ""} ({record!.ats_wins}-{record!.ats_losses}
          {record!.ats_pushes ? `-${record!.ats_pushes}` : ""} ATS)
        </div>
      )}
    </div>
  );
}

function Cell({ main, sub }: { main: string; sub?: string }) {
  return (
    <span className="flex flex-col items-center justify-center leading-tight py-0.5">
      <span className="text-base font-semibold tabular-nums">{main}</span>
      {sub && <span className="text-[10px] font-medium opacity-70 tabular-nums">{sub}</span>}
    </span>
  );
}

export function PickRow({ label, shortLabel, children }: { label: string; shortLabel: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">

      <span className="text-[11px] sm:text-xs text-[var(--text-faint)] w-14 sm:w-32 shrink-0">
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <div className="flex gap-1.5 sm:gap-2 flex-1">{children}</div>
    </div>
  );
}

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.5 ? "#111111" : "#ffffff";
}

const RESULT_BADGE: Record<string, string> = { win: "✓", loss: "✗", push: "P" };

export function PickButton({
  children,
  active,
  result,
  edge,
  disabled,
  hint,
  color,
  secondary,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  result?: Pick["result"];
  edge?: boolean;
  disabled?: boolean;
  hint?: string;
  color?: string;
  secondary?: string;
  onClick: () => void;
}) {
  const graded = active && (result === "win" || result === "loss" || result === "push");
  const teamColored = !!color && !!active && !graded;
  const resultClasses: Record<string, string> = {
    win: "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-500/90",
    loss: "bg-rose-500 border-rose-500 text-white hover:bg-rose-500/90",
    push: "bg-amber-500 border-amber-500 text-white hover:bg-amber-500/90",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={
        teamColored
          ? {
              backgroundColor: color,
              borderColor: secondary ?? color,
              color: readableOn(color as string),
              boxShadow: `inset 0 0 0 2px ${secondary ?? color}, 0 3px 10px ${color}66`,
            }
          : undefined
      }
      title={
        graded
          ? `You ${result} this pick`
          : active
          ? "Click again to remove this pick"
          : edge
          ? "Model has the edge here"
          : hint
      }
      className={`relative flex-1 rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
        graded
          ? `${resultClasses[result as string]} shadow-sm`
          : teamColored
          ? "shadow-sm hover:brightness-110"
          : active
          ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm hover:bg-[var(--accent)]/90"
          : disabled
          ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] cursor-not-allowed"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-xs hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/10"
      } ${edge ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-[var(--card)]" : ""}`}
    >
      {edge && (
        <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[var(--card)]" />
      )}
      {graded && (
        <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-[var(--card)] border border-current flex items-center justify-center text-[9px] font-bold leading-none">
          {RESULT_BADGE[result as string]}
        </span>
      )}
      {children}
    </button>
  );
}
