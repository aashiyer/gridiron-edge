import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";
import { HomeIcon, TargetIcon, ListIcon, ChartIcon, ScaleIcon, CalendarIcon, TrophyIcon, PersonIcon, SunIcon, MoonIcon, LogoMark, RankIcon, MoreIcon, ShieldIcon } from "./icons";

const baseTabs = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/picker", label: "Picker", icon: TargetIcon },
  { to: "/my-picks", label: "My Picks", icon: ListIcon },
  { to: "/leaderboard", label: "Leaderboard", icon: TrophyIcon },
  { to: "/power-rankings", label: "Power Rankings", icon: RankIcon },
  { to: "/record", label: "Record", icon: ChartIcon },
  { to: "/vs-model", label: "vs. Model", icon: ScaleIcon },
  { to: "/games", label: "Games", icon: CalendarIcon },
];

const ADMIN_TAB = { to: "/admin/users", label: "Users", icon: ShieldIcon, end: false };

export function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const tabs = user.is_admin ? [...baseTabs, ADMIN_TAB] : baseTabs;
  const primaryMobileTabs = tabs.filter((t) => ["/", "/picker", "/my-picks", "/leaderboard"].includes(t.to));
  const moreTabs = tabs.filter((t) => !primaryMobileTabs.includes(t));

  function doLogout() {
    logout();
    navigate("/login");
  }

  return (
    <>

      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-[var(--border)] bg-[var(--card)] shadow-sm backdrop-blur z-20">
        <div className="px-5 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-[var(--text)]">
            <LogoMark className="w-6 h-6 shrink-0 text-[var(--accent)]" bg="var(--card)" />
            PICK<span className="text-[var(--accent)]">SIX</span>
          </Link>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
          >
            {theme === "dark" ? <SunIcon className="w-[18px] h-[18px]" /> : <MoonIcon className="w-[18px] h-[18px]" />}
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-0.5 px-3">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-[var(--accent)]/12 text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <t.icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`} />
                  {t.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-[var(--border)] flex flex-col gap-0.5">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-[var(--accent)]/12 text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
              }`
            }
          >
            <PersonIcon className="w-[18px] h-[18px] shrink-0 text-[var(--text-faint)]" />
            <span className="truncate">{user.display_name}</span>
          </NavLink>
          <button
            onClick={doLogout}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-faint)] hover:text-rose-400 hover:bg-[var(--surface-hover)] transition-colors text-left"
          >
            Log out
          </button>
        </div>
      </aside>


      <header className="md:hidden sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 font-display text-base font-bold tracking-tight text-[var(--text)]">
            <LogoMark className="w-5 h-5 shrink-0 text-[var(--accent)]" bg="var(--bg)" />
            PICK<span className="text-[var(--accent)]">SIX</span>
          </Link>
          <div className="flex items-center gap-3">
            <button onClick={toggleTheme} className="text-[var(--text-muted)]">
              {theme === "dark" ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]")}>
              <PersonIcon className="w-5 h-5" />
            </NavLink>
            <button onClick={doLogout} className="text-xs font-medium text-[var(--text-faint)] hover:text-rose-400 transition-colors">
              Log out
            </button>
          </div>
        </div>
      </header>


      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-black/40" onClick={() => setMoreOpen(false)} />
      )}
      <div
        className={`md:hidden fixed bottom-16 inset-x-0 z-20 border-t border-[var(--border)] bg-[var(--card)] shadow-sm transition-transform duration-150 ${
          moreOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
        }`}
      >
        <div className="grid grid-cols-4 gap-1 p-3">
          {moreTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1.5 py-3 rounded-xl text-[11px] font-medium transition-colors ${
                  isActive ? "text-[var(--accent)] bg-[var(--accent)]/10" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                }`
              }
            >
              <t.icon className="w-5 h-5" />
              <span className="text-center leading-tight">{t.label}</span>
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            onClick={() => setMoreOpen(false)}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1.5 py-3 rounded-xl text-[11px] font-medium transition-colors ${
                isActive ? "text-[var(--accent)] bg-[var(--accent)]/10" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              }`
            }
          >
            <PersonIcon className="w-5 h-5" />
            <span className="text-center leading-tight">Settings</span>
          </NavLink>
        </div>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
        <div className="grid grid-cols-5">
          {primaryMobileTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
                }`
              }
            >
              <t.icon className="w-5 h-5" />
              {t.label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              moreOpen ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
            }`}
          >
            <MoreIcon className="w-5 h-5" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
