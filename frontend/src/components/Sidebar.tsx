import { Avatar } from "./Avatar";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";
import { useSport } from "../lib/SportContext";
import { NFL_ONLY_PATHS, SportToggle } from "./SportToggle";
import { HomeIcon, TargetIcon, ChartIcon, ScaleIcon, TrophyIcon, RankIcon, MoreIcon, ShieldIcon, LiveIcon } from "./icons";

const baseTabs = [
  { to: "/", label: "Home", icon: HomeIcon, end: true, group: "" },
  { to: "/picker", label: "Picker", icon: TargetIcon, group: "Play" },
  { to: "/live", label: "Live", icon: LiveIcon, group: "Play" },
  { to: "/leaderboard", label: "Leaderboard", icon: TrophyIcon, group: "Standings" },
  { to: "/league", label: "League", icon: TrophyIcon, group: "Standings" },
  { to: "/record", label: "Record", icon: ChartIcon, group: "Standings" },
  { to: "/stats", label: "Stats", icon: ChartIcon, group: "Analysis" },
  { to: "/power-rankings", label: "Power Rankings", icon: RankIcon, group: "Analysis" },
  { to: "/vs-model", label: "Model", icon: ScaleIcon, group: "Analysis" },
];

const GROUP_ORDER = ["", "Play", "Standings", "Analysis"];

function DeskLink({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block py-[7px] pl-6 pr-3 text-[13px] leading-5 transition-colors ${
          isActive
            ? "text-[var(--text)] font-medium shadow-[inset_2px_0_0_var(--text)]"
            : "text-[var(--text-muted)] hover:text-[var(--text)]"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

const ADMIN_TAB = { to: "/admin/users", label: "Users", icon: ShieldIcon, end: false, group: "Admin" };

export function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { sport } = useSport();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const visibleTabs = sport === "nba" ? baseTabs.filter((t) => !NFL_ONLY_PATHS.includes(t.to)) : baseTabs;
  const tabs = user.is_admin ? [...visibleTabs, ADMIN_TAB] : visibleTabs;
  const primaryMobileTabs = tabs.filter((t) => ["/", "/picker", "/live", "/leaderboard"].includes(t.to));
  const moreTabs = tabs.filter((t) => !primaryMobileTabs.includes(t));

  function doLogout() {
    logout();
    navigate("/login");
  }

  return (
    <>

      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-[var(--border)] bg-[var(--bg)] z-20">
        <div className="px-6 pt-7 pb-6">
          <Link to="/" className="font-display text-[15px] font-bold tracking-[0.22em] text-[var(--text)]">
            PICKSIX
          </Link>
        </div>

        <div className="mx-6 mb-7">
          <SportToggle />
        </div>

        <nav className="flex-1 overflow-y-auto flex flex-col gap-6">
          {GROUP_ORDER.map((g) => {
            const items = visibleTabs.filter((t) => t.group === g);
            if (!items.length) return null;
            return (
              <div key={g || "home"} className="flex flex-col">
                {g && <div className="pl-6 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{g}</div>}
                {items.map((t) => (
                  <DeskLink key={t.to} to={t.to} end={t.end}>
                    {t.label}
                  </DeskLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="px-6 py-5 border-t border-[var(--border)] flex flex-col gap-3">
          {user.is_admin && (
            <NavLink to="/admin/users" className={({ isActive }) => `text-[12px] transition-colors ${isActive ? "text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              Users
            </NavLink>
          )}
          <NavLink to="/settings" className="flex items-center gap-2.5 group min-w-0">
            <Avatar userId={user.user_id} version={user.avatar_version} name={user.display_name} size={24} />
            <span className="truncate text-[13px] text-[var(--text)] group-hover:underline underline-offset-4 decoration-[var(--text-faint)]">{user.display_name}</span>
          </NavLink>
          <div className="flex items-center justify-between text-[12px] text-[var(--text-faint)]">
            <button onClick={toggleTheme} className="hover:text-[var(--text)] transition-colors">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button onClick={doLogout} className="hover:text-[var(--text)] transition-colors">
              Log out
            </button>
          </div>
        </div>
      </aside>


      <header className="md:hidden sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]">
        <div className="px-5 h-12 flex items-center justify-between">
          <Link to="/" className="font-display text-[13px] font-bold tracking-[0.22em] text-[var(--text)]">
            PICKSIX
          </Link>
          <SportToggle compact />
        </div>
      </header>

      {moreOpen && <div className="md:hidden fixed inset-0 z-20 bg-black/50" onClick={() => setMoreOpen(false)} />}
      <div
        className={`md:hidden fixed inset-x-0 bottom-14 z-20 max-h-[70vh] overflow-y-auto border-t border-[var(--border)] bg-[var(--bg)] transition-transform duration-150 ${
          moreOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
        }`}
      >
        {["Standings", "Analysis"].map((g) => {
          const items = moreTabs.filter((t) => t.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{g}</div>
              {items.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => `block px-5 py-3 text-[15px] border-b border-[var(--border)] ${isActive ? "text-[var(--text)] font-medium" : "text-[var(--text-muted)]"}`}
                >
                  {t.label}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Account</div>
        <NavLink to="/settings" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-5 py-3 text-[15px] text-[var(--text)] border-b border-[var(--border)]">
          <Avatar userId={user.user_id} version={user.avatar_version} name={user.display_name} size={24} />
          {user.display_name}
        </NavLink>
        {user.is_admin && (
          <NavLink to="/admin/users" onClick={() => setMoreOpen(false)} className="block px-5 py-3 text-[15px] text-[var(--text-muted)] border-b border-[var(--border)]">
            Users
          </NavLink>
        )}
        <button onClick={toggleTheme} className="block w-full text-left px-5 py-3 text-[15px] text-[var(--text-muted)] border-b border-[var(--border)]">
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button onClick={doLogout} className="block w-full text-left px-5 py-3 text-[15px] text-[var(--text-muted)]">
          Log out
        </button>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-[var(--border)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 h-14">
          {primaryMobileTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 text-[10px] tracking-wide transition-colors ${
                  isActive && !moreOpen ? "text-[var(--text)] shadow-[inset_0_2px_0_var(--text)]" : "text-[var(--text-faint)]"
                }`
              }
            >
              <t.icon className="w-5 h-5" />
              {t.label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] tracking-wide transition-colors ${
              moreOpen ? "text-[var(--text)] shadow-[inset_0_2px_0_var(--text)]" : "text-[var(--text-faint)]"
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
