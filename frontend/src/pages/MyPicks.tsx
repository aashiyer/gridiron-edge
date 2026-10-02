import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Pick } from "../lib/types";
import { team_meta_lookup } from "../lib/localTeams";

const PICK_TYPE_ORDER: Pick["pick_type"][] = ["straight_up", "ats", "total"];
const PICK_TYPE_LABEL: Record<Pick["pick_type"], string> = {
  straight_up: "Straight Up",
  ats: "ATS",
  total: "Total",
};

function fmtLine(n: number | null): string {
  if (n === null) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

function selectionLabel(p: Pick): string {
  if (p.pick_type === "total") {
    return `${p.selection === "over" ? "Over" : "Under"}${p.line_at_pick_time !== null ? ` ${p.line_at_pick_time}` : ""}`;
  }
  const abbr = p.selection_meta?.abbr ?? p.selection;
  return p.pick_type === "ats" && p.line_at_pick_time !== null ? `${abbr} ${fmtLine(p.line_at_pick_time)}` : abbr;
}

function modelTooltip(p: Pick): string | undefined {
  if (!p.model_lean) return undefined;
  const agreed = p.model_lean === p.selection;
  const leanLabel =
    p.pick_type === "total" ? (p.model_lean === "over" ? "Over" : "Under") : team_meta_lookup(p.model_lean).abbr;
  const line = p.model_line !== null ? ` ${fmtLine(p.model_line)}` : "";
  return agreed
    ? `Model agreed — favored ${leanLabel}${line} when you picked.`
    : `Model favored ${leanLabel}${line} when you picked.`;
}

function chipClasses(result: Pick["result"]): string {
  switch (result) {
    case "win":
      return "border-emerald-500 bg-emerald-500 text-white";
    case "loss":
      return "border-rose-500 bg-rose-500 text-white";
    case "push":
      return "border-amber-500 bg-amber-500 text-white";
    default:
      return "border-[var(--border)] bg-[var(--card)] text-[var(--text)]";
  }
}

export function MyPicks() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setPicks(await api.picks());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(pickId: number) {
    setPicks((prev) => prev.filter((p) => p.pick_id !== pickId));
    await api.deletePick(pickId);
  }

  const gamesInOrder: string[] = [];
  const byGame = new Map<string, Pick[]>();
  for (const p of picks) {
    if (!byGame.has(p.game_id)) {
      byGame.set(p.game_id, []);
      gamesInOrder.push(p.game_id);
    }
    byGame.get(p.game_id)!.push(p);
  }
  const grouped = gamesInOrder.map((gid) =>
    byGame.get(gid)!.slice().sort((a, b) => PICK_TYPE_ORDER.indexOf(a.pick_type) - PICK_TYPE_ORDER.indexOf(b.pick_type))
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text)]">My Picks</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">

          {picks.length} logged pick{picks.length === 1 ? "" : "s"} across {grouped.length} game{grouped.length === 1 ? "" : "s"}
        </p>
      </div>

      {loading && <div className="text-[var(--text-muted)] text-sm">Loading…</div>}

      {!loading && grouped.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm">
          No picks yet.{" "}
          <Link to="/picker" className="text-[var(--accent)] font-medium hover:underline">
            Head to the Picker
          </Link>{" "}
          to make some.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {grouped.map((gamePicks) => {
          const first = gamePicks[0];
          const away = team_meta_lookup(first.away_team);
          const home = team_meta_lookup(first.home_team);
          const isFinal = first.status === "final";
          return (
            <div key={first.game_id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
              <Link
                to={`/games/${first.game_id}`}
                className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {away.logo && <img src={away.logo} className="w-7 h-7 shrink-0" alt="" />}
                  <span className="font-display font-semibold text-sm text-[var(--text)]">{away.abbr}</span>
                </div>
                <span className="text-xs text-[var(--text-faint)]">@</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  {home.logo && <img src={home.logo} className="w-7 h-7 shrink-0" alt="" />}
                  <span className="font-display font-semibold text-sm text-[var(--text)]">{home.abbr}</span>
                </div>

                <span className="text-xs text-[var(--text-faint)] ml-1">
                  S{first.season} W{first.week}
                </span>

                <div className="ml-auto flex items-center gap-2.5">
                  {isFinal && first.final_home_score !== null && (
                    <span className="font-display text-sm font-semibold text-[var(--text-muted)] tabular-nums">
                      {first.final_away_score}-{first.final_home_score}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide ${
                      isFinal ? "text-[var(--text-faint)]" : "text-emerald-400"
                    }`}
                  >
                    {isFinal ? "Final" : first.status.replace("_", " ")}
                  </span>
                </div>
              </Link>

              <div className="flex flex-wrap gap-3 px-4 sm:px-5 py-4">
                {gamePicks.map((p) => (
                  <div key={p.pick_id} className="flex flex-col gap-1 min-w-[7.5rem]">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                        {PICK_TYPE_LABEL[p.pick_type]}
                      </span>
                      <button
                        onClick={() => remove(p.pick_id)}
                        title="Remove this pick"
                        className="text-[var(--text-faint)] hover:text-rose-400 transition-colors leading-none text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className={`relative rounded-lg border px-3 py-2 text-sm font-semibold text-center ${chipClasses(p.result)}`}>
                      {selectionLabel(p)}
                      {p.model_lean && (
                        <span
                          title={modelTooltip(p)}
                          className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[var(--card)] ${
                            p.model_lean === p.selection ? "bg-emerald-400" : "bg-[var(--text-faint)]"
                          }`}
                        />
                      )}
                    </div>
                    {p.notes && <div className="text-[11px] text-[var(--text-faint)] italic truncate">{p.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
