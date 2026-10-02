import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AdminUser } from "../lib/types";

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminUsers()
      .then(setUsers)
      .catch(() => setError("Couldn't load users — admin access required."));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Registered Users</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Everyone signed up on this instance. Admin-only — not visible to other accounts.
        </p>
      </div>

      {error && <div className="text-sm text-[var(--destructive)]">{error}</div>}

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
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--text)]">{u.display_name}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{u.email}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-muted)]">{u.pick_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
