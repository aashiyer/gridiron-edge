import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [showSlowNotice, setShowSlowNotice] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowSlowNotice(false);
      return;
    }
    const t = setTimeout(() => setShowSlowNotice(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-[var(--text-muted)] text-sm">
        Loading…
        {showSlowNotice && (
          <p className="text-xs text-[var(--text-faint)] mt-1">
            The server may be waking up from idle. This can take up to 30 seconds.
          </p>
        )}
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
