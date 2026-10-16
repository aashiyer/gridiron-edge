import { Fragment, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { AdminUser } from "../lib/types";

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .adminUsers()
      .then(setUsers)
      .catch(() => setError("Couldn't load users — admin access required."));
  }, []);

  function startReset(userId: number) {
    setResetting(userId);
    setNewPassword("");
    setShowPassword(false);
    setNotice(null);
  }

  async function submitReset(user: AdminUser) {
    setBusy(true);
    setNotice(null);
    try {
      await api.adminResetPassword(user.user_id, newPassword);
      setNotice({ ok: true, text: `Password reset for ${user.display_name}. Tell them the new password.` });
      setResetting(null);
      setNewPassword("");
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't reset the password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Registered Users</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Everyone signed up on this instance. Admin-only — not visible to other accounts.
        </p>
      </div>

      {error && <div className="text-sm text-[var(--destructive)]">{error}</div>}
      {notice && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-rose-500/30 bg-rose-500/10 text-rose-500"}`}>
          {notice.text}
        </div>
      )}

      {!users && !error && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}

      {users && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="px-4 py-3 font-semibold text-right">Picks</th>
                <th className="px-4 py-3 font-semibold text-right">Password</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.user_id}>
                  <tr className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--text)]">{u.display_name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{u.email}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{u.pick_count}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => (resetting === u.user_id ? setResetting(null) : startReset(u.user_id))}
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        {resetting === u.user_id ? "Cancel" : "Reset"}
                      </button>
                    </td>
                  </tr>
                  {resetting === u.user_id && (
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
                      <td colSpan={5} className="px-4 py-3">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitReset(u);
                          }}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="text-xs text-[var(--text-muted)]">New password for {u.display_name}</span>
                          <input
                            autoFocus
                            required
                            minLength={8}
                            type={showPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="At least 8 characters"
                            className="input"
                          />
                          <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--accent)]">
                            {showPassword ? "Hide" : "Show"}
                          </button>
                          <button
                            type="submit"
                            disabled={busy || newPassword.length < 8}
                            className="rounded-lg bg-[var(--accent)] text-[var(--accent-text)] text-xs font-semibold px-3 py-2 disabled:opacity-60"
                          >
                            {busy ? "Saving…" : "Set password"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
