import type { TeamMeta } from "./types";

const TEAMS: Record<string, { name: string; slug: string; color: string }> = {
  ARI: { name: "Arizona Cardinals", slug: "ari", color: "#97233F" },
  ATL: { name: "Atlanta Falcons", slug: "atl", color: "#A71930" },
  BAL: { name: "Baltimore Ravens", slug: "bal", color: "#241773" },
  BUF: { name: "Buffalo Bills", slug: "buf", color: "#00338D" },
  CAR: { name: "Carolina Panthers", slug: "car", color: "#0085CA" },
  CHI: { name: "Chicago Bears", slug: "chi", color: "#0B162A" },
  CIN: { name: "Cincinnati Bengals", slug: "cin", color: "#FB4F14" },
  CLE: { name: "Cleveland Browns", slug: "cle", color: "#311D00" },
  DAL: { name: "Dallas Cowboys", slug: "dal", color: "#041E42" },
  DEN: { name: "Denver Broncos", slug: "den", color: "#FB4F14" },
  DET: { name: "Detroit Lions", slug: "det", color: "#0076B6" },
  GB: { name: "Green Bay Packers", slug: "gb", color: "#203731" },
  HOU: { name: "Houston Texans", slug: "hou", color: "#03202F" },
  IND: { name: "Indianapolis Colts", slug: "ind", color: "#002C5F" },
  JAX: { name: "Jacksonville Jaguars", slug: "jax", color: "#101820" },
  KC: { name: "Kansas City Chiefs", slug: "kc", color: "#E31837" },
  LA: { name: "Los Angeles Rams", slug: "lar", color: "#003594" },
  LAC: { name: "Los Angeles Chargers", slug: "lac", color: "#0080C6" },
  LV: { name: "Las Vegas Raiders", slug: "lv", color: "#000000" },
  MIA: { name: "Miami Dolphins", slug: "mia", color: "#008E97" },
  MIN: { name: "Minnesota Vikings", slug: "min", color: "#4F2683" },
  NE: { name: "New England Patriots", slug: "ne", color: "#002244" },
  NO: { name: "New Orleans Saints", slug: "no", color: "#D3BC8D" },
  NYG: { name: "New York Giants", slug: "nyg", color: "#0B2265" },
  NYJ: { name: "New York Jets", slug: "nyj", color: "#125740" },
  PHI: { name: "Philadelphia Eagles", slug: "phi", color: "#004C54" },
  PIT: { name: "Pittsburgh Steelers", slug: "pit", color: "#FFB612" },
  SEA: { name: "Seattle Seahawks", slug: "sea", color: "#002244" },
  SF: { name: "San Francisco 49ers", slug: "sf", color: "#AA0000" },
  TB: { name: "Tampa Bay Buccaneers", slug: "tb", color: "#D50A0A" },
  TEN: { name: "Tennessee Titans", slug: "ten", color: "#4B92DB" },
  WAS: { name: "Washington Commanders", slug: "wsh", color: "#5A1414" },
};

const ALIASES: Record<string, string> = { WSH: "WAS", LAR: "LA", JAC: "JAX" };

export function team_meta_lookup(abbr: string): TeamMeta {
  const canonical = ALIASES[abbr?.toUpperCase()] ?? abbr?.toUpperCase() ?? "";
  const info = TEAMS[canonical];
  if (!info) return { abbr: canonical, name: canonical, logo: "", color: "#333333" };
  return {
    abbr: canonical,
    name: info.name,
    logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${info.slug}.png`,
    color: info.color,
  };
}
