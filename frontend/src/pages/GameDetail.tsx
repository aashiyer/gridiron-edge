import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { GameDetail as GameDetailType, Pick, TeamMeta, TeamForm, TeamEfficiency, DepthChart, DepthChartEntry, QbStatus } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";
import { PickRow, PickButton } from "../components/GamePickCard";
import { usePickToggle } from "../lib/usePickToggle";

function fmtKickoff(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtSigned(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function fmtSpread(n: number | null) {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

const POSITION_ORDER = [
  "QB", "RB", "FB", "WR", "WR1", "WR2", "TE", "LT", "LG", "C", "RG", "RT",
  "LDE", "RDE", "LDT", "RDT", "NT", "LOLB", "LILB", "RILB", "ROLB", "MLB",
  "LCB", "RCB", "CB", "FS", "SS", "S",
  "K", "P", "LS", "H", "KR", "PR",
];

function sortedPositions(chart: DepthChart): string[] {
  const known = POSITION_ORDER.filter((p) => p in chart);
  const rest = Object.keys(chart).filter((p) => !POSITION_ORDER.includes(p)).sort();
  return [...known, ...rest];
}

export function GameDetailPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [detail, setDetail] = useState<GameDetailType | null>(null);
  const [error, setError] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);

  useEffect(() => {
    if (!gameId) return;
    setDetail(null);
    setError(false);
    api
      .gameDetail(gameId)
      .then((d) => ("error" in d && d.error ? setError(true) : setDetail(d)))
      .catch(() => setError(true));
  }, [gameId]);

  async function reloadPicks() {
    setPicks(await api.picks());
  }
  useEffect(() => {
    reloadPicks();
  }, [gameId]);

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <BackLink />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-8 text-center text-[var(--text-muted)] text-sm mt-4">
          Couldn't find that game.
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <BackLink />
        <div className="text-[var(--text-muted)] text-sm mt-4">Loading…</div>
      </div>
    );
  }

  const rec = detail.recommendation;
  const isFinal = detail.status === "final";
  const line = rec?.current_line ?? detail.home_spread_close;
  const total = rec?.current_total ?? detail.total_close;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 flex flex-col gap-6">
      <BackLink />


      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-6">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-4">
          <span>
            {detail.season} Season · Week {detail.week}
            {detail.game_type && detail.game_type !== "REG" ? ` · ${detail.game_type}` : ""}
          </span>
          <span className={`uppercase tracking-wide font-semibold ${isFinal ? "text-[var(--text-faint)]" : "text-emerald-400"}`}>
            {isFinal ? "Final" : detail.status.replace("_", " ")}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <TeamScoreColumn team={detail.away} score={detail.final_away_score} align="left" />
          <div className="text-[var(--text-faint)] text-sm font-medium">@</div>
          <TeamScoreColumn team={detail.home} score={detail.final_home_score} align="right" />
        </div>

        <div className="text-center text-sm text-[var(--text-muted)] mt-4">{fmtKickoff(detail.kickoff_time)}</div>
        {detail.stadium && (
          <div className="text-center text-xs text-[var(--text-faint)] mt-1">
            {detail.stadium}
            {detail.roof === "dome" ? " (dome)" : detail.temp !== null ? ` · ${Math.round(detail.temp)}°F` : ""}
            {detail.wind !== null && detail.roof !== "dome" ? `, ${Math.round(detail.wind)} mph wind` : ""}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
          <LinePill label="Spread" value={line !== null ? `${detail.home_team} ${fmtSpread(line)}` : "—"} />
          <LinePill label="Total" value={total !== null ? `${total}` : "—"} />
          {detail.home_ml_close !== null && detail.away_ml_close !== null && (
            <LinePill
              label="Moneyline"
              value={`${detail.away_team} ${fmtSpread(detail.away_ml_close)} / ${detail.home_team} ${fmtSpread(detail.home_ml_close)}`}
            />
          )}
        </div>
      </div>

      <MakePickSection detail={detail} rec={rec} picks={picks} onPickMade={reloadPicks} />

      {rec && !rec.error && <EdgeSection rec={rec} />}

      {rec && !rec.error && (rec.home_qb_status || rec.away_qb_status) && (
        <QbStatusSection homeTeam={detail.home} awayTeam={detail.away} home={rec.home_qb_status} away={rec.away_qb_status} />
      )}

      {rec && !rec.error && (
        <TeamStatsSection
          homeTeam={detail.home}
          awayTeam={detail.away}
          homeForm={rec.home_form}
          awayForm={rec.away_form}
          homeEff={rec.home_efficiency}
          awayEff={rec.away_efficiency}
          homeFpi={rec.home_fpi}
          awayFpi={rec.away_fpi}
          homeGei={rec.home_gei}
          awayGei={rec.away_gei}
        />
      )}

      <DepthChartSection homeTeam={detail.home} awayTeam={detail.away} home={detail.home_depth_chart} away={detail.away_depth_chart} />

      {detail.odds_history.length > 0 && <OddsHistorySection history={detail.odds_history} homeTeam={detail.home_team} />}
    </div>
  );
}

function MakePickSection({
  detail,
  rec,
  picks,
  onPickMade,
}: {
  detail: GameDetailType;
  rec: GameDetailType["recommendation"];
  picks: Pick[];
  onPickMade: () => void;
}) {
  const existingPicks = picks.filter((p) => p.game_id === detail.game_id);
  const { selectionFor, togglePick, locked, error } = usePickToggle(detail, existingPicks, onPickMade);

  const spread = rec?.current_line ?? detail.home_spread_close;
  const total = rec?.current_total ?? detail.total_close;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[var(--text)]">Make Your Pick</h2>
        {locked && <span className="text-xs font-semibold uppercase tracking-wide text-orange-400">🔒 Locked</span>}
      </div>
      <div className="flex flex-col gap-2.5">
        <PickRow label="Straight Up" shortLabel="SU">
          <PickButton
            active={selectionFor("straight_up") === detail.away_team}
            edge={rec?.lean_straight_up === detail.away_team}
            disabled={locked}
            onClick={() => togglePick("straight_up", detail.away_team, null)}
          >
            {detail.away.abbr}
          </PickButton>
          <PickButton
            active={selectionFor("straight_up") === detail.home_team}
            edge={rec?.lean_straight_up === detail.home_team}
            disabled={locked}
            onClick={() => togglePick("straight_up", detail.home_team, null)}
          >
            {detail.home.abbr}
          </PickButton>
        </PickRow>

        <PickRow label="Against the Spread" shortLabel="ATS">
          <PickButton
            active={selectionFor("ats") === detail.away_team}
            edge={rec?.lean_ats === detail.away_team}
            disabled={locked || spread === null}
            onClick={() => togglePick("ats", detail.away_team, spread !== null ? -spread : null)}
          >
            {detail.away.abbr} {spread !== null ? fmtSpread(-spread) : ""}
          </PickButton>
          <PickButton
            active={selectionFor("ats") === detail.home_team}
            edge={rec?.lean_ats === detail.home_team}
            disabled={locked || spread === null}
            onClick={() => togglePick("ats", detail.home_team, spread)}
          >
            {detail.home.abbr} {spread !== null ? fmtSpread(spread) : ""}
          </PickButton>
        </PickRow>

        <PickRow label="Total" shortLabel="O/U">
          <PickButton
            active={selectionFor("total") === "over"}
            edge={rec?.lean_total === "over"}
            disabled={locked || total === null}
            onClick={() => togglePick("total", "over", total)}
          >
            Over {total ?? ""}
          </PickButton>
          <PickButton
            active={selectionFor("total") === "under"}
            edge={rec?.lean_total === "under"}
            disabled={locked || total === null}
            onClick={() => togglePick("total", "under", total)}
          >
            Under {total ?? ""}
          </PickButton>
        </PickRow>
      </div>
      {error && <div className="text-xs text-[var(--destructive)] mt-2">{error}</div>}
    </section>
  );
}

function BackLink() {
  const navigate = useNavigate();
  const canGoBack = typeof window !== "undefined" && (window.history.state?.idx ?? 0) > 0;
  return (
    <button
      onClick={() => (canGoBack ? navigate(-1) : navigate("/games"))}
      className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors inline-flex items-center gap-1"
    >
      ← Back
    </button>
  );
}

function TeamScoreColumn({ team, score, align }: { team: TeamMeta; score: number | null; align: "left" | "right" }) {
  return (
    <div className={`flex items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <TeamLogo team={team} size={64} className="w-12 h-12 sm:w-16 sm:h-16 shrink-0" />
      <div>
        <div className="font-display font-bold text-lg sm:text-xl text-[var(--text)]">{team.abbr}</div>
        <div className="text-xs text-[var(--text-faint)] hidden sm:block">{team.name}</div>
        {score !== null && <div className="font-display text-2xl sm:text-3xl font-bold text-[var(--text)] mt-1">{score}</div>}
      </div>
    </div>
  );
}

function LinePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded-full px-3 py-1.5">
      <span className="text-[var(--text-faint)]">{label}: </span>
      <span className="text-[var(--text)] font-medium">{value}</span>
    </div>
  );
}

function EdgeSection({ rec }: { rec: NonNullable<GameDetailType["recommendation"]> }) {
  return (
    <section className="rounded-2xl border border-[var(--accent)]/20 bg-gradient-to-br from-[var(--accent)]/[0.08] to-[var(--accent)]/[0.04] p-4 sm:p-5">
      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--accent)] mb-3">⬥ The Edge</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <EdgeStat label="Straight Up" value={rec.lean_straight_up} confidence={rec.confidence_straight_up} />
        <EdgeStat label="Against the Spread" value={rec.lean_ats} confidence={rec.confidence_ats} />
        <EdgeStat label="Total" value={rec.lean_total ? (rec.lean_total === "over" ? "Over" : "Under") : null} confidence={rec.confidence_total} />
      </div>
      <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-3">{rec.explanation}</p>
      <details className="group">
        <summary className="text-xs text-[var(--accent)]/90 cursor-pointer select-none list-none flex items-center gap-1 hover:text-[var(--accent)]">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>
          All {rec.reasons.length} factors
        </summary>
        <ul className="text-xs text-[var(--text-muted)] leading-relaxed space-y-1.5 list-disc list-inside marker:text-[var(--accent)]/60 mt-3">
          {rec.reasons.map((r, i) => (
            <li key={i} className={r.highlight ? "font-semibold text-[var(--text)]" : undefined}>
              {r.text}
            </li>
          ))}
        </ul>
      </details>
      {rec.news_note && <p className="text-xs text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border)]">📰 {rec.news_note}</p>}
    </section>
  );
}

function EdgeStat({ label, value, confidence }: { label: string; value: string | null; confidence: number }) {
  const strength = confidence >= 1.5 ? "strong" : confidence >= 0.5 ? "moderate" : "slight";
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1">{label}</div>
      {value ? (
        <div className="font-display font-bold text-[var(--text)]">
          {value} <span className="text-xs font-normal text-[var(--text-muted)]">({strength})</span>
        </div>
      ) : (
        <div className="text-sm text-[var(--text-muted)]">No clear edge</div>
      )}
    </div>
  );
}

function QbStatusSection({
  homeTeam,
  awayTeam,
  home,
  away,
}: {
  homeTeam: TeamMeta;
  awayTeam: TeamMeta;
  home: QbStatus;
  away: QbStatus;
}) {
  if (!home.starter_out && !away.starter_out && !home.starter_questionable && !away.starter_questionable) return null;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-5">
      <h2 className="text-sm font-bold text-[var(--text)] mb-3">QB Status</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <QbStatusCard team={awayTeam} qb={away} />
        <QbStatusCard team={homeTeam} qb={home} />
      </div>
    </section>
  );
}

function QbStatusCard({ team, qb }: { team: TeamMeta; qb: QbStatus }) {
  return (
    <div className="flex items-center gap-3">
      <TeamLogo team={team} size={32} />
      <div>
        <div className="text-sm font-semibold text-[var(--text)]">{team.abbr}</div>
        {qb.starter_out && qb.likely_starter ? (
          <div className="text-xs text-orange-400">
            {qb.starter?.player_name} out — likely starter {qb.likely_starter.player_name} (QB{qb.likely_starter.depth_rank})
          </div>
        ) : qb.starter_out ? (
          <div className="text-xs text-rose-400">No healthy QB on the depth chart</div>
        ) : qb.starter_questionable ? (
          <div className="text-xs text-orange-400/90">{qb.starter?.player_name} questionable</div>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">{qb.starter?.player_name ?? "—"}</div>
        )}
      </div>
    </div>
  );
}

function TeamStatsSection({
  homeTeam,
  awayTeam,
  homeForm,
  awayForm,
  homeEff,
  awayEff,
  homeFpi,
  awayFpi,
  homeGei,
  awayGei,
}: {
  homeTeam: TeamMeta;
  awayTeam: TeamMeta;
  homeForm: TeamForm;
  awayForm: TeamForm;
  homeEff: TeamEfficiency | null;
  awayEff: TeamEfficiency | null;
  homeFpi: { fpi: number | null; rank: number | null };
  awayFpi: { fpi: number | null; rank: number | null };
  homeGei: { gei: number | null; rank: number | null };
  awayGei: { gei: number | null; rank: number | null };
}) {
  const rows: { label: string; away: string; home: string }[] = [
    {
      label: "FPI (rank)",
      away: awayFpi.fpi !== null ? `${fmtSigned(awayFpi.fpi)} (#${awayFpi.rank})` : "—",
      home: homeFpi.fpi !== null ? `${fmtSigned(homeFpi.fpi)} (#${homeFpi.rank})` : "—",
    },
    {
      label: "Gridiron Efficiency Index (rank)",
      away: awayGei.gei !== null ? `${fmtSigned(awayGei.gei, 3)} (#${awayGei.rank})` : "—",
      home: homeGei.gei !== null ? `${fmtSigned(homeGei.gei, 3)} (#${homeGei.rank})` : "—",
    },
    {
      label: "Straight Up (L8)",
      away: `${awayForm.su_wins}-${awayForm.su_decided - awayForm.su_wins}`,
      home: `${homeForm.su_wins}-${homeForm.su_decided - homeForm.su_wins}`,
    },
    {
      label: "ATS (L8)",
      away: `${awayForm.ats_covers}-${awayForm.ats_decided - awayForm.ats_covers}${awayForm.ats_pct !== null ? ` (${awayForm.ats_pct}%)` : ""}`,
      home: `${homeForm.ats_covers}-${homeForm.ats_decided - homeForm.ats_covers}${homeForm.ats_pct !== null ? ` (${homeForm.ats_pct}%)` : ""}`,
    },
    {
      label: "Avg Margin (L8)",
      away: awayForm.avg_margin !== null ? fmtSigned(awayForm.avg_margin) : "—",
      home: homeForm.avg_margin !== null ? fmtSigned(homeForm.avg_margin) : "—",
    },
    {
      label: "Streak",
      away: awayForm.streak_kind ? `${awayForm.streak_kind}${awayForm.streak_len}` : "—",
      home: homeForm.streak_kind ? `${homeForm.streak_kind}${homeForm.streak_len}` : "—",
    },
    {
      label: "Off EPA/play",
      away: awayEff?.off_epa_play != null ? fmtSigned(awayEff.off_epa_play, 3) : "—",
      home: homeEff?.off_epa_play != null ? fmtSigned(homeEff.off_epa_play, 3) : "—",
    },
    {
      label: "Def EPA/play (allowed)",
      away: awayEff?.def_epa_play != null ? fmtSigned(awayEff.def_epa_play, 3) : "—",
      home: homeEff?.def_epa_play != null ? fmtSigned(homeEff.def_epa_play, 3) : "—",
    },
    {
      label: "3rd Down %",
      away: awayEff?.third_down_pct != null ? `${awayEff.third_down_pct.toFixed(0)}%` : "—",
      home: homeEff?.third_down_pct != null ? `${homeEff.third_down_pct.toFixed(0)}%` : "—",
    },
    {
      label: "Red Zone TD %",
      away: awayEff?.red_zone_td_pct != null ? `${awayEff.red_zone_td_pct.toFixed(0)}%` : "—",
      home: homeEff?.red_zone_td_pct != null ? `${homeEff.red_zone_td_pct.toFixed(0)}%` : "—",
    },
    {
      label: "Turnover Margin",
      away: awayEff?.turnover_margin != null ? fmtSigned(awayEff.turnover_margin, 2) : "—",
      home: homeEff?.turnover_margin != null ? fmtSigned(homeEff.turnover_margin, 2) : "—",
    },
    {
      label: "CPOE",
      away: awayEff?.cpoe != null ? `${fmtSigned(awayEff.cpoe)}%` : "—",
      home: homeEff?.cpoe != null ? `${fmtSigned(homeEff.cpoe)}%` : "—",
    },
    {
      label: "Avg Separation",
      away: awayEff?.avg_separation != null ? `${awayEff.avg_separation.toFixed(1)} yds` : "—",
      home: homeEff?.avg_separation != null ? `${homeEff.avg_separation.toFixed(1)} yds` : "—",
    },
    {
      label: "Rush YOE/att",
      away: awayEff?.rush_yards_over_expected_per_att != null ? fmtSigned(awayEff.rush_yards_over_expected_per_att, 2) : "—",
      home: homeEff?.rush_yards_over_expected_per_att != null ? fmtSigned(homeEff.rush_yards_over_expected_per_att, 2) : "—",
    },
  ];

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-5 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <TeamLogo team={awayTeam} size={22} />
          <span className="text-sm font-semibold text-[var(--text)]">{awayTeam.abbr}</span>
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-faint)]">Team Stats</span>
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm font-semibold text-[var(--text)]">{homeTeam.abbr}</span>
          <TeamLogo team={homeTeam} size={22} />
        </div>
      </div>
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-5 py-2.5 text-sm">
            <span className="text-[var(--text)] tabular-nums">{r.away}</span>
            <span className="text-[11px] text-[var(--text-faint)] text-center px-2">{r.label}</span>
            <span className="text-[var(--text)] tabular-nums text-right">{r.home}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DepthChartSection({
  homeTeam,
  awayTeam,
  home,
  away,
}: {
  homeTeam: TeamMeta;
  awayTeam: TeamMeta;
  home: DepthChart;
  away: DepthChart;
}) {
  if (!Object.keys(home).length && !Object.keys(away).length) return null;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-5">
      <h2 className="text-sm font-bold text-[var(--text)] mb-4">Depth Chart</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <DepthChartColumn team={awayTeam} chart={away} />
        <DepthChartColumn team={homeTeam} chart={home} />
      </div>
    </section>
  );
}

function DepthChartColumn({ team, chart }: { team: TeamMeta; chart: DepthChart }) {
  const positions = sortedPositions(chart);
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <TeamLogo team={team} size={24} />
        <span className="text-sm font-semibold text-[var(--text)]">{team.abbr}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {positions.map((pos) => (
          <div key={pos} className="flex items-start gap-2 text-xs">
            <span className="text-[var(--text-faint)] font-medium w-9 shrink-0 pt-0.5">{pos}</span>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {chart[pos].map((p: DepthChartEntry) => (
                <span
                  key={p.depth_rank}
                  className={`${p.depth_rank === 1 ? "text-[var(--text)] font-medium" : "text-[var(--text-muted)]"}`}
                >
                  {p.player_name}
                  {p.injury_status && <span className="text-orange-400 font-semibold ml-0.5">{p.injury_status}</span>}
                  {p !== chart[pos][chart[pos].length - 1] && <span className="text-[var(--text-faint)]">,</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OddsHistorySection({ history, homeTeam }: { history: GameDetailType["odds_history"]; homeTeam: string }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4 sm:p-5">
      <h2 className="text-sm font-bold text-[var(--text)] mb-3">Line Movement</h2>
      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
        {[...history].reverse().map((o) => (
          <div key={o.id} className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs py-1 border-b border-[var(--border)] last:border-0">
            <span className="text-[var(--text-faint)]">
              {new Date(o.captured_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="text-[var(--text-muted)] tabular-nums">
              {o.home_spread !== null ? `${homeTeam} ${fmtSpread(o.home_spread)}` : "—"}
            </span>
            <span className="text-[var(--text-muted)] tabular-nums">{o.total !== null ? `O/U ${o.total}` : "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
