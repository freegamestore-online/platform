import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import { addBreadcrumb } from './lib/breadcrumbs';
import { Create } from './pages/Create';
import { Dashboard } from './pages/Dashboard';
import { GameSettings } from './pages/GameSettings';
import { Profile } from './pages/Profile';

/** Records a breadcrumb on every route change (pathname only — no PII). */
function RouteTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    addBreadcrumb('route', pathname);
  }, [pathname]);
  return null;
}

export default function App() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <RouteTracker />
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
