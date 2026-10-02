import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/api";
import { LogoMark } from "../components/icons";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!busy) {
      setShowSlowNotice(false);
      return;
    }
    const t = setTimeout(() => setShowSlowNotice(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, displayName);
      }
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <LogoMark className="w-10 h-10 mx-auto mb-2 text-[var(--accent)]" bg="var(--bg)" />
          <span className="font-display text-2xl font-bold tracking-tight text-[var(--text)]">
            PICK<span className="text-[var(--accent)]">SIX</span>
          </span>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {mode === "login" ? "Welcome back." : "Set up your account."}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-6 flex flex-col gap-4"
        >
          {mode === "signup" && (
            <Field label="Display name">
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="input"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
            />
          </Field>
          <Field label="Password">
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="input"
            />
          </Field>

          {error && <div className="text-xs text-[var(--destructive)]">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold py-2.5 text-sm shadow-sm transition-colors disabled:opacity-60"
          >
            {busy && (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {busy
              ? showSlowNotice
                ? "Still working…"
                : "Working…"
              : mode === "login"
              ? "Log in"
              : "Create account"}
          </button>

          {busy && showSlowNotice && (
            <p className="text-xs text-[var(--text-muted)] text-center -mt-1">
              The server may be waking up from idle. This can take up to 30 seconds. Hang tight.
            </p>
          )}
        </form>

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
          className="w-full text-center text-xs text-[var(--text-muted)] hover:text-[var(--accent)] mt-4 transition-colors"
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}
