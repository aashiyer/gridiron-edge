import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSport } from "../lib/SportContext";
import type { PlayerStatsResponse, StatPlayerRow, TeamStatsResponse } from "../lib/types";
import { StatTable, TextTabs, fmtFixed } from "../components/StatTable";
import type { StatCol } from "../components/StatTable";

type Tab = "players" | "teams";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const ADV: Record<string, string> = { passing: "adv_pass", rushing: "adv_rush", receiving: "adv_rec" };
const isAdv = (v: string) => v.startsWith("adv_");
const base = (v: string) => Object.keys(ADV).find((k) => ADV[k] === v) ?? v;

function PlayersTab({ sport }: { sport: "nfl" | "nba" }) {
  const navigate = useNavigate();
  const [view, setView] = useState<string>("");
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [qualified, setQualified] = useState(true);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<PlayerStatsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setView("");
    setSeason(undefined);
    setData(null);
  }, [sport]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .statsPlayers({ view: view || undefined, season, qualified })
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (!view) setView(r.view);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [sport, view, season, qualified]);

  const columns = useMemo<StatCol<StatPlayerRow>[]>(
    () => (data ? data.columns.map((c, i) => ({ key: c.key, label: c.label, desc: c.desc, dec: c.dec, value: (r) => r.v[i] })) : []),
    [data]
  );
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return q ? data.rows.filter((r) => r.name.toLowerCase().includes(q) || r.team.toLowerCase() === q) : data.rows;
  }, [data, query]);

  return (
    <div className="flex flex-col gap-4">
      {data && sport === "nfl" && (
        <div className="flex flex-col gap-3">
          <TextTabs
            value={base(data.view)}
            options={data.views.filter((v) => !v.id.startsWith("adv_")).map((v) => ({ id: v.id, label: v.label }))}
            onChange={(v) => setView(isAdv(data.view) && ADV[v] ? ADV[v] : v)}
          />
          {ADV[base(data.view)] && (
            <TextTabs
              value={isAdv(data.view) ? "adv" : "std"}
              options={[
                { id: "std", label: "Standard" },
                { id: "adv", label: "Advanced" },
              ]}
              onChange={(m) => setView(m === "adv" ? ADV[base(data.view)] : base(data.view))}
            />
          )}
        </div>
      )}
      {data && sport === "nba" && <TextTabs value={data.view} options={data.views.map((v) => ({ id: v.id, label: v.label }))} onChange={(v) => setView(v)} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player or team" className="input w-full sm:w-64" aria-label="Search players" />
        {data && (
          <select value={data.season} onChange={(e) => setSeason(Number(e.target.value))} className="input" aria-label="Season">
            {data.seasons.map((s) => (
              <option key={s.year} value={s.year}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] cursor-pointer select-none">
          <input type="checkbox" checked={qualified} onChange={(e) => setQualified(e.target.checked)} className="accent-[var(--accent)]" />
          Qualified players only
        </label>
        {data && <span className="text-[12px] text-[var(--text-faint)] sm:ml-auto">{rows.length} players{!data.qualified && qualified ? " · too few qualify yet, showing everyone" : ""}</span>}
      </div>
      {error && <div className="text-sm text-[var(--text-muted)]">Stats are unavailable right now.</div>}
      {!data && !error && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
      {data && (
        <StatTable
          key={`${data.view}-${data.season}`}
          rows={rows}
          columns={columns}
          ranked
          rowKey={(r) => r.id}
          onRow={data.linkable ? (r) => navigate(`/stats/player/${sport}/${r.id}`) : undefined}
          initialSort={{ key: data.sort, dir: "desc" }}
          leadLabel="Player"
          lead={(r) => (
            <span className="flex items-center gap-2.5">
              <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[var(--surface)]">{r.headshot && <img src={r.headshot} alt="" loading="lazy" className="h-6 w-6 object-cover" />}</span>
              <span className="text-[var(--text)] font-medium">{r.name}</span>
              <span className="text-[11px] text-[var(--text-faint)]">
                {r.pos} · {r.team}
              </span>
            </span>
          )}
        />
      )}
    </div>
  );
}

function TeamsTab({ sport }: { sport: "nfl" | "nba" }) {
  const navigate = useNavigate();
  const [view, setView] = useState("offense");
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [data, setData] = useState<TeamStatsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api
      .statsTeams({ season })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [sport, season]);

  const current = data?.views.find((v) => v.id === view) ?? data?.views[0];
  const columns = useMemo<StatCol<TeamStatsResponse["teams"][number]>[]>(
    () =>
      current
        ? current.columns.map((c) => ({
            key: c.key,
            label: c.label,
            desc: c.desc,
            lowerBetter: c.lower,
            dec: c.dec,
            value: (t) => t.v[c.key] ?? null,
            render: (t, d) => (
              <span>
                {fmtFixed(t.v[c.key], d)}
                {c.ranks[t.abbr] && <span className="ml-1 text-[10px] text-[var(--text-faint)]">{ordinal(c.ranks[t.abbr])}</span>}
              </span>
            ),
          }))
        : [],
    [current]
  );

  return (
    <div className="flex flex-col gap-4">
      {data && <TextTabs value={current?.id ?? "offense"} options={data.views.map((v) => ({ id: v.id, label: v.label }))} onChange={setView} />}
      {data && (
        <div className="flex items-center gap-4">
          <select value={data.season} onChange={(e) => setSeason(Number(e.target.value))} className="input" aria-label="Season">
            {data.seasons.map((s) => (
              <option key={s.year} value={s.year}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-[12px] text-[var(--text-faint)]">Small superscript is the league rank.</span>
        </div>
      )}
      {error && <div className="text-sm text-[var(--text-muted)]">Stats are unavailable right now.</div>}
      {!data && !error && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
      {data && current && (
        <StatTable
          key={`${current.id}-${data.season}`}
          rows={data.teams}
          columns={columns}
          ranked
          pageSize={40}
          rowKey={(t) => t.abbr}
          onRow={(t) => navigate(`/stats/team/${sport}/${t.abbr}`)}
          initialSort={{ key: current.columns[0].key, dir: current.columns[0].lower ? "asc" : "desc" }}
          leadLabel="Team"
          lead={(t) => (
            <span className="flex items-center gap-2.5">
              {t.logo && <img src={t.logo} alt="" className="h-5 w-5 object-contain" />}
              <span className="text-[var(--text)] font-medium">{t.name}</span>
            </span>
          )}
        />
      )}
    </div>
  );
}

export function StatsPage() {
  const { sport } = useSport();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "teams" ? "teams" : "players";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text)]">Stats</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">{sport === "nba" ? "NBA" : "NFL"} season stats for every player and team. Click a column to sort, a row to open it.</p>
      </div>
      <TextTabs
        value={tab}
        options={[
          { id: "players", label: "Players" },
          { id: "teams", label: "Teams" },
        ]}
        onChange={(t) => setParams(t === "teams" ? { tab: "teams" } : {}, { replace: true })}
      />
      {tab === "players" ? <PlayersTab sport={sport} /> : <TeamsTab sport={sport} />}
    </div>
  );
}
