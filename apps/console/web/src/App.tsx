import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthContext, useAuthProvider } from "./hooks/useAuth";
import { Dashboard } from "./pages/Dashboard";
import { Profile } from "./pages/Profile";
import { Create } from "./pages/Create";
import { GameSettings } from "./pages/GameSettings";

export default function App() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {/* One route with an optional param — two separate <Route> entries
              would remount the studio (killing an in-flight stream) every time
              the URL canonicalizes between /create and /create/<id>. */}
          <Route path="/create/:id?" element={<Create />} />
          <Route path="/game/:id" element={<GameSettings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
