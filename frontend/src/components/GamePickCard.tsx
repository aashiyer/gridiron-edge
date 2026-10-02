import { Link } from "react-router-dom";
import type { Game, Pick, Recommendation, TeamRecord } from "../lib/types";
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
}: {
  game: Game;
  existingPicks: Pick[];
  rec: Recommendation | null;
  loadingRec: boolean;
  onPickMade: () => void;
}) {
  const { selectionFor, togglePick, locked, error } = usePickToggle(game, existingPicks, onPickMade);

  const spread = game.current_spread ?? game.home_spread_close;
  const total = game.current_total ?? game.total_close;

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

      <Link
        to={`/games/${game.game_id}`}
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 -m-1 p-1 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
        title="View full game details"
      >
        <TeamColumn team={game.away} score={game.final_away_score} align="left" record={rec?.away_record} />
        <div className="text-[var(--text-faint)] text-xs sm:text-sm font-medium">@</div>
        <TeamColumn team={game.home} score={game.final_home_score} align="right" record={rec?.home_record} />
      </Link>


      <PickRow label="Straight Up" shortLabel="SU">
        <PickButton
          active={selectionFor("straight_up") === game.away_team}
          result={resultFor("straight_up")}
          edge={rec?.lean_straight_up === game.away_team}
          disabled={locked}
          onClick={() => togglePick("straight_up", game.away_team, null)}
        >
          {game.away.abbr}
        </PickButton>
        <PickButton
          active={selectionFor("straight_up") === game.home_team}
          result={resultFor("straight_up")}
          edge={rec?.lean_straight_up === game.home_team}
          disabled={locked}
          onClick={() => togglePick("straight_up", game.home_team, null)}
        >
          {game.home.abbr}
        </PickButton>
      </PickRow>


      <PickRow label="Against the Spread" shortLabel="ATS">
        <PickButton
          active={selectionFor("ats") === game.away_team}
          result={resultFor("ats")}
          edge={rec?.lean_ats === game.away_team}
          disabled={locked || spread === null}
          onClick={() => togglePick("ats", game.away_team, spread !== null ? -spread : null)}
        >
          {game.away.abbr} {spread !== null ? fmtSpread(-spread) : ""}
        </PickButton>
        <PickButton
          active={selectionFor("ats") === game.home_team}
          result={resultFor("ats")}
          edge={rec?.lean_ats === game.home_team}
          disabled={locked || spread === null}
          onClick={() => togglePick("ats", game.home_team, spread)}
        >
          {game.home.abbr} {spread !== null ? fmtSpread(spread) : ""}
        </PickButton>
      </PickRow>


      <PickRow label="Total" shortLabel="O/U">
        <PickButton
          active={selectionFor("total") === "over"}
          result={resultFor("total")}
          edge={rec?.lean_total === "over"}
          disabled={locked || total === null}
          onClick={() => togglePick("total", "over", total)}
        >
          Over {total ?? ""}
        </PickButton>
        <PickButton
          active={selectionFor("total") === "under"}
          result={resultFor("total")}
          edge={rec?.lean_total === "under"}
          disabled={locked || total === null}
          onClick={() => togglePick("total", "under", total)}
        >
          Under {total ?? ""}
        </PickButton>
      </PickRow>

      {error && <div className="text-xs text-[var(--destructive)]">{error}</div>}


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

function TeamColumn({
  team,
  score,
  align,
  record,
}: {
  team: Game["home"];
  score: number | null;
  align: "left" | "right";
  record?: TeamRecord;
}) {
  const hasRecord = record && (record.wins || record.losses || record.ties);
  return (
    <div className={`flex items-center gap-1.5 sm:gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <TeamLogo team={team} size={44} className="w-8 h-8 sm:w-11 sm:h-11" />
      <div>
        <div className="font-display font-bold text-sm sm:text-base text-[var(--text)]">{team.abbr}</div>
        {score !== null && <div className="text-xs sm:text-sm text-[var(--text-muted)]">{score}</div>}
        {hasRecord && (
          <div className="text-[10px] text-sky-400/80 font-medium tracking-wide">
            {record!.wins}-{record!.losses}
            {record!.ties ? `-${record!.ties}` : ""} ({record!.ats_wins}-{record!.ats_losses}
            {record!.ats_pushes ? `-${record!.ats_pushes}` : ""} ATS)
          </div>
        )}
      </div>
    </div>
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

const RESULT_BADGE: Record<string, string> = { win: "✓", loss: "✗", push: "P" };

export function PickButton({
  children,
  active,
  result,
  edge,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  result?: Pick["result"];
  edge?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const graded = active && (result === "win" || result === "loss" || result === "push");
  const resultClasses: Record<string, string> = {
    win: "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-500/90",
    loss: "bg-rose-500 border-rose-500 text-white hover:bg-rose-500/90",
    push: "bg-amber-500 border-amber-500 text-white hover:bg-amber-500/90",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        graded
          ? `You ${result} this pick`
          : active
          ? "Click again to remove this pick"
          : edge
          ? "Model has the edge here"
          : undefined
      }
      className={`relative flex-1 rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
        graded
          ? `${resultClasses[result as string]} shadow-sm`
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
