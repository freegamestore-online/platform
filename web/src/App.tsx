import { useCallback, useEffect, useState } from "react";
import { ApiError, LOGIN_URL, api } from "./api.ts";
import { Overview } from "./Overview.tsx";
import { GamesList } from "./GamesList.tsx";
import { ErrorsPage } from "./Errors.tsx";
import { UsersPage } from "./Users.tsx";
import { UserDetail } from "./UserDetail.tsx";
import { Sessions } from "./Sessions.tsx";
import { SessionView } from "./SessionView.tsx";
import { ProvisionForm } from "./ProvisionForm.tsx";

type View =
  | { page: "overview" }
  | { page: "games" }
  | { page: "errors" }
  | { page: "users" }
  | { page: "user"; id: string }
  | { page: "sessions" }
  | { page: "session"; id: string }
  | { page: "provision" };

function parseHash(): View {
  const hash = window.location.hash.slice(1);
  if (hash === "/games") return { page: "games" };
  if (hash === "/errors") return { page: "errors" };
  if (hash === "/users") return { page: "users" };
  const user = hash.match(/^\/users\/(.+)$/);
  if (user) return { page: "user", id: user[1]! };
  if (hash === "/sessions") return { page: "sessions" };
  const m = hash.match(/^\/sessions\/(.+)$/);
  if (m) return { page: "session", id: m[1]! };
  if (hash === "/provision") return { page: "provision" };
  return { page: "overview" };
}

export default function App() {
  const [view, setView] = useState<View>(parseHash);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // One probe decides signed-in state; every page's own calls also surface 401s.
  useEffect(() => {
    api("/api/stats")
      .then(() => setAuthed(true))
      .catch((e) => setAuthed(!(e instanceof ApiError && e.status === 401)));
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  if (authed === false) return <SignIn />;

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Header navigate={navigate} view={view} />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {authed === null ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
        ) : (
          <>
            {view.page === "overview" && <Overview />}
            {view.page === "games" && <GamesList />}
            {view.page === "errors" && <ErrorsPage />}
            {view.page === "users" && <UsersPage navigate={navigate} />}
            {view.page === "user" && <UserDetail id={view.id} navigate={navigate} />}
            {view.page === "sessions" && <Sessions navigate={navigate} />}
            {view.page === "session" && <SessionView id={view.id} navigate={navigate} />}
            {view.page === "provision" && <ProvisionForm />}
          </>
        )}
      </main>
    </div>
  );
}

function SignIn() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="rounded-2xl border p-8 max-w-sm w-full text-center" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          Free<span style={{ color: "var(--accent)" }}>Game</span>Store <span className="text-xs align-middle border rounded px-1.5 py-0.5 ml-1" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>ADMIN</span>
        </h1>
        <p className="text-sm mt-3 mb-6" style={{ color: "var(--muted)" }}>Sign in with an allow-listed Google account to continue.</p>
        <a href={LOGIN_URL} className="inline-block w-full rounded-xl py-2.5 font-semibold text-white" style={{ background: "var(--accent)" }}>
          Sign in with Google
        </a>
      </div>
    </div>
  );
}

function Header({ navigate, view }: { navigate: (h: string) => void; view: View }) {
  return (
    <header className="sticky top-0 z-10 border-b px-4 sm:px-6 lg:px-8" style={{ borderColor: "var(--line)", background: "var(--panel-strong)", backdropFilter: "blur(12px)" }}>
      <div className="mx-auto max-w-6xl flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate("/")} className="text-lg font-bold tracking-tight" style={{ color: "var(--ink)" }}>
            Free<span style={{ color: "var(--accent)" }}>Game</span>Store
          </button>
          <nav className="hidden sm:flex items-center gap-1">
            <NavLink label="Overview" hash="/" active={view.page === "overview"} navigate={navigate} />
            <NavLink label="Games" hash="/games" active={view.page === "games"} navigate={navigate} />
            <NavLink label="Errors" hash="/errors" active={view.page === "errors"} navigate={navigate} />
            <NavLink label="Users" hash="/users" active={view.page === "users" || view.page === "user"} navigate={navigate} />
            <NavLink label="Sessions" hash="/sessions" active={view.page === "sessions" || view.page === "session"} navigate={navigate} />
            <NavLink label="Provision" hash="/provision" active={view.page === "provision"} navigate={navigate} />
            <a href="/docs" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: "var(--muted)" }}>API</a>
          </nav>
        </div>
      </div>
    </header>
  );
}

function NavLink({ label, hash, active, navigate }: { label: string; hash: string; active: boolean; navigate: (h: string) => void }) {
  return (
    <button
      onClick={() => navigate(hash)}
      className="px-3 py-1.5 rounded-lg text-sm font-medium"
      style={active ? { background: "var(--accent-soft)", color: "var(--accent-deep)" } : { color: "var(--muted)" }}
    >
      {label}
    </button>
  );
}
