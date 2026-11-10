import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { Sidebar } from "./components/Sidebar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { TeamAccentSync } from "./components/TeamAccentSync";
import { Home } from "./pages/Home";
import { Picker } from "./pages/Picker";
import { RecordPage } from "./pages/Record";
import { VsModelPage } from "./pages/VsModel";
import { LeaguePage } from "./pages/League";
import { LivePage } from "./pages/Live";
import { LiveGamePage } from "./pages/LiveGame";
import { LeaderboardPage } from "./pages/Leaderboard";
import { PowerRankingsPage } from "./pages/PowerRankings";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { AdminUsersPage } from "./pages/AdminUsers";

function RedirectToLive() {
  const { gameId } = useParams<{ gameId: string }>();
  return <Navigate to={`/live/${gameId}`} replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      <TeamAccentSync />
      <Sidebar />

      <div className={user ? "md:pl-56 pb-20 md:pb-0" : ""}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/picker" element={<ProtectedRoute><Picker /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
          <Route path="/power-rankings" element={<ProtectedRoute><PowerRankingsPage /></ProtectedRoute>} />
          <Route path="/record" element={<ProtectedRoute><RecordPage /></ProtectedRoute>} />
          <Route path="/games" element={<Navigate to="/live" replace />} />
          <Route path="/games/:gameId" element={<ProtectedRoute><RedirectToLive /></ProtectedRoute>} />
          <Route path="/live" element={<ProtectedRoute><LivePage /></ProtectedRoute>} />
          <Route path="/live/:gameId" element={<ProtectedRoute><LiveGamePage /></ProtectedRoute>} />
          <Route path="/league" element={<ProtectedRoute><LeaguePage /></ProtectedRoute>} />
          <Route path="/vs-model" element={<ProtectedRoute><VsModelPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          {user?.is_admin && (
            <Route path="/admin/users" element={<ProtectedRoute><AdminUsersPage /></ProtectedRoute>} />
          )}
        </Routes>
      </div>
    </div>
  );
}
