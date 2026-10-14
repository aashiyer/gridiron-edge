import type { TeamMeta } from "./types";

const TEAMS: Record<string, { name: string; slug: string; color: string; secondary: string }> = {
  ARI: { name: "Arizona Cardinals", slug: "ari", color: "#97233F", secondary: "#FFB612" },
  ATL: { name: "Atlanta Falcons", slug: "atl", color: "#A71930", secondary: "#000000" },
  BAL: { name: "Baltimore Ravens", slug: "bal", color: "#241773", secondary: "#9E7C0C" },
  BUF: { name: "Buffalo Bills", slug: "buf", color: "#00338D", secondary: "#C60C30" },
  CAR: { name: "Carolina Panthers", slug: "car", color: "#0085CA", secondary: "#101820" },
  CHI: { name: "Chicago Bears", slug: "chi", color: "#0B162A", secondary: "#C83803" },
  CIN: { name: "Cincinnati Bengals", slug: "cin", color: "#FB4F14", secondary: "#000000" },
  CLE: { name: "Cleveland Browns", slug: "cle", color: "#311D00", secondary: "#FF3C00" },
  DAL: { name: "Dallas Cowboys", slug: "dal", color: "#041E42", secondary: "#869397" },
  DEN: { name: "Denver Broncos", slug: "den", color: "#FB4F14", secondary: "#002244" },
  DET: { name: "Detroit Lions", slug: "det", color: "#0076B6", secondary: "#B0B7BC" },
  GB: { name: "Green Bay Packers", slug: "gb", color: "#203731", secondary: "#FFB612" },
  HOU: { name: "Houston Texans", slug: "hou", color: "#03202F", secondary: "#A71930" },
  IND: { name: "Indianapolis Colts", slug: "ind", color: "#002C5F", secondary: "#A2AAAD" },
  JAX: { name: "Jacksonville Jaguars", slug: "jax", color: "#101820", secondary: "#D7A22A" },
  KC: { name: "Kansas City Chiefs", slug: "kc", color: "#E31837", secondary: "#FFB81C" },
  LA: { name: "Los Angeles Rams", slug: "lar", color: "#003594", secondary: "#FFA300" },
  LAC: { name: "Los Angeles Chargers", slug: "lac", color: "#0080C6", secondary: "#FFC20E" },
  LV: { name: "Las Vegas Raiders", slug: "lv", color: "#000000", secondary: "#A5ACAF" },
  MIA: { name: "Miami Dolphins", slug: "mia", color: "#008E97", secondary: "#FC4C02" },
  MIN: { name: "Minnesota Vikings", slug: "min", color: "#4F2683", secondary: "#FFC62F" },
  NE: { name: "New England Patriots", slug: "ne", color: "#002244", secondary: "#C60C30" },
  NO: { name: "New Orleans Saints", slug: "no", color: "#D3BC8D", secondary: "#101820" },
  NYG: { name: "New York Giants", slug: "nyg", color: "#0B2265", secondary: "#A71930" },
  NYJ: { name: "New York Jets", slug: "nyj", color: "#125740", secondary: "#000000" },
  PHI: { name: "Philadelphia Eagles", slug: "phi", color: "#004C54", secondary: "#A5ACAF" },
  PIT: { name: "Pittsburgh Steelers", slug: "pit", color: "#FFB612", secondary: "#101820" },
  SEA: { name: "Seattle Seahawks", slug: "sea", color: "#002244", secondary: "#69BE28" },
  SF: { name: "San Francisco 49ers", slug: "sf", color: "#AA0000", secondary: "#B3995D" },
  TB: { name: "Tampa Bay Buccaneers", slug: "tb", color: "#D50A0A", secondary: "#FF7900" },
  TEN: { name: "Tennessee Titans", slug: "ten", color: "#4B92DB", secondary: "#0C2340" },
  WAS: { name: "Washington Commanders", slug: "wsh", color: "#5A1414", secondary: "#FFB612" },
};

const ALIASES: Record<string, string> = { WSH: "WAS", LAR: "LA", JAC: "JAX" };

export function team_meta_lookup(abbr: string): TeamMeta {
  const canonical = ALIASES[abbr?.toUpperCase()] ?? abbr?.toUpperCase() ?? "";
  const info = TEAMS[canonical];
  if (!info) return { abbr: canonical, name: canonical, logo: "", color: "#333333", secondary: "#666666" };
  return {
    abbr: canonical,
    name: info.name,
    logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${info.slug}.png`,
    color: info.color,
    secondary: info.secondary,
  };
}
