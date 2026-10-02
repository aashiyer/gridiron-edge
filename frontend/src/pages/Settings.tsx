import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { TeamMeta } from "../lib/types";
import { TeamLogo } from "../components/TeamBadge";

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [teams, setTeams] = useState<TeamMeta[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  useEffect(() => {
    api.teams().then(setTeams);
  }, []);

  useEffect(() => {
    if (user) setSelected(user.favorite_teams);
  }, [user]);

  useEffect(() => {
    if (user) setDisplayName(user.display_name);
  }, [user]);

  async function saveDisplayName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    const name = displayName.trim();
    if (!name) {
      setNameError("Display name can't be empty");
      return;
    }
    setNameSaving(true);
    try {
      await api.changeDisplayName(name);
      await refreshUser();
      setNameSaved(true);
    } catch (e) {
      setNameError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setNameSaving(false);
    }
  }

  function select(abbr: string) {
    setSaved(false);
    setSelected((prev) => (prev.includes(abbr) ? [] : [abbr]));
  }

  async function save() {
    setSaving(true);
    try {
      await api.setFavoriteTeams(selected);
      await refreshUser();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    setPwSaving(true);
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setPwSaved(true);
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Settings</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Signed in as {user?.display_name} ({user?.email})
        </p>
      </div>

      <section className="max-w-sm">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">Display Name</h2>
        <form onSubmit={saveDisplayName} className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input w-full"
          />
          {nameError && <div className="text-xs text-[var(--destructive)]">{nameError}</div>}
          {nameSaved && <div className="text-xs text-emerald-400">Saved</div>}
          <button
            type="submit"
            disabled={nameSaving}
            className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold py-2 text-sm shadow-sm transition-colors disabled:opacity-60 self-start px-5"
          >
            {nameSaving ? "…" : "Save name"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">Favorite Team</h2>
        <p className="text-xs text-[var(--text-faint)] mb-4">
          Your home page hero highlights your favorite team's next game first, and the app's accent color switches
          to their colors. Click your team again to clear it.
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {teams.map((t) => {
            const active = selected.includes(t.abbr);
            return (
              <button
                key={t.abbr}
                onClick={() => select(t.abbr)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors ${
                  active
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                    : "border-[var(--border)] bg-[var(--card)] shadow-sm hover:border-[var(--ring)]"
                }`}
              >
                <TeamLogo team={t} size={32} />
                <span className="text-[10px] font-medium text-[var(--text-muted)]">{t.abbr}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold px-5 py-2 text-sm shadow-sm transition-colors disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>

      <section className="max-w-sm">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">Change Password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--text-muted)]">Current password</span>
            <div className="relative">
              <input
                required
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors px-1.5 py-1"
              >
                {showPasswords ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--text-muted)]">New password</span>
            <div className="relative">
              <input
                required
                type={showPasswords ? "text" : "password"}
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="input w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors px-1.5 py-1"
              >
                {showPasswords ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          {pwError && <div className="text-xs text-[var(--destructive)]">{pwError}</div>}
          {pwSaved && <div className="text-xs text-emerald-400">Password updated</div>}
          <button
            type="submit"
            disabled={pwSaving}
            className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold py-2 text-sm shadow-sm transition-colors disabled:opacity-60 self-start px-5"
          >
            {pwSaving ? "…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}
