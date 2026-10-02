"""Static NFL team metadata: canonical abbreviation, full name, ESPN logo slug, primary color.

Canonical abbreviations follow nflverse convention (e.g. "WAS", "LA" for the Rams).
`ESPN_ABBR_ALIASES` maps alternate abbreviations seen in ESPN API responses back to
the canonical code, since ESPN uses "WSH" for Washington and "LAR" for the Rams.
"""

TEAMS = {
    "ARI": {"name": "Arizona Cardinals", "espn_slug": "ari", "color": "#97233F"},
    "ATL": {"name": "Atlanta Falcons", "espn_slug": "atl", "color": "#A71930"},
    "BAL": {"name": "Baltimore Ravens", "espn_slug": "bal", "color": "#241773"},
    "BUF": {"name": "Buffalo Bills", "espn_slug": "buf", "color": "#00338D"},
    "CAR": {"name": "Carolina Panthers", "espn_slug": "car", "color": "#0085CA"},
    "CHI": {"name": "Chicago Bears", "espn_slug": "chi", "color": "#0B162A"},
    "CIN": {"name": "Cincinnati Bengals", "espn_slug": "cin", "color": "#FB4F14"},
    "CLE": {"name": "Cleveland Browns", "espn_slug": "cle", "color": "#311D00"},
    "DAL": {"name": "Dallas Cowboys", "espn_slug": "dal", "color": "#041E42"},
    "DEN": {"name": "Denver Broncos", "espn_slug": "den", "color": "#FB4F14"},
    "DET": {"name": "Detroit Lions", "espn_slug": "det", "color": "#0076B6"},
    "GB": {"name": "Green Bay Packers", "espn_slug": "gb", "color": "#203731"},
    "HOU": {"name": "Houston Texans", "espn_slug": "hou", "color": "#03202F"},
    "IND": {"name": "Indianapolis Colts", "espn_slug": "ind", "color": "#002C5F"},
    "JAX": {"name": "Jacksonville Jaguars", "espn_slug": "jax", "color": "#101820"},
    "KC": {"name": "Kansas City Chiefs", "espn_slug": "kc", "color": "#E31837"},
    "LA": {"name": "Los Angeles Rams", "espn_slug": "lar", "color": "#003594"},
    "LAC": {"name": "Los Angeles Chargers", "espn_slug": "lac", "color": "#0080C6"},
    "LV": {"name": "Las Vegas Raiders", "espn_slug": "lv", "color": "#000000"},
    "MIA": {"name": "Miami Dolphins", "espn_slug": "mia", "color": "#008E97"},
    "MIN": {"name": "Minnesota Vikings", "espn_slug": "min", "color": "#4F2683"},
    "NE": {"name": "New England Patriots", "espn_slug": "ne", "color": "#002244"},
    "NO": {"name": "New Orleans Saints", "espn_slug": "no", "color": "#D3BC8D"},
    "NYG": {"name": "New York Giants", "espn_slug": "nyg", "color": "#0B2265"},
    "NYJ": {"name": "New York Jets", "espn_slug": "nyj", "color": "#125740"},
    "PHI": {"name": "Philadelphia Eagles", "espn_slug": "phi", "color": "#004C54"},
    "PIT": {"name": "Pittsburgh Steelers", "espn_slug": "pit", "color": "#FFB612"},
    "SEA": {"name": "Seattle Seahawks", "espn_slug": "sea", "color": "#002244"},
    "SF": {"name": "San Francisco 49ers", "espn_slug": "sf", "color": "#AA0000"},
    "TB": {"name": "Tampa Bay Buccaneers", "espn_slug": "tb", "color": "#D50A0A"},
    "TEN": {"name": "Tennessee Titans", "espn_slug": "ten", "color": "#4B92DB"},
    "WAS": {"name": "Washington Commanders", "espn_slug": "wsh", "color": "#5A1414"},
}

ESPN_ABBR_ALIASES = {
    "WSH": "WAS",
    "LAR": "LA",
    "JAC": "JAX",
}


def normalize_abbr(abbr: str) -> str:
    abbr = abbr.upper()
    return ESPN_ABBR_ALIASES.get(abbr, abbr)


def logo_url(abbr: str) -> str:
    canonical = normalize_abbr(abbr)
    slug = TEAMS.get(canonical, {}).get("espn_slug", canonical.lower())
    return f"https://a.espncdn.com/i/teamlogos/nfl/500/{slug}.png"


def team_meta(abbr: str) -> dict:
    canonical = normalize_abbr(abbr)
    info = TEAMS.get(canonical, {"name": canonical, "espn_slug": canonical.lower(), "color": "#333333"})
    return {
        "abbr": canonical,
        "name": info["name"],
        "logo": logo_url(canonical),
        "color": info["color"],
    }
