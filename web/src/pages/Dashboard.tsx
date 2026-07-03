import { useState, useEffect } from "react";
import { Nav } from "../components/Nav";
import { CreateGameForm } from "../components/CreateGameForm";
import { LoadingShell, SignInShell, ErrorShell } from "../components/PageShell";
import { useAuth, type GameRepo } from "../hooks/useAuth";

export function Dashboard() {
  const { user, creator, creatorError, loading, error, fetchCreator, reloadCreator, signIn } = useAuth();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { fetchCreator(); }, [fetchCreator]);

  if (loading) return <LoadingShell />;
  if (error) return <ErrorShell message={error} />;
  // Only prompt sign-in when genuinely signed out. A signed-in user whose game
  // list failed to load is NOT signed out — show the error (with retry), never
  // "Sign in to publish."
  if (!user) {
    return <SignInShell onSignIn={signIn} message="Sign in with GitHub to publish games on FreeGameStore." />;
  }
  if (!creator) {
    return creatorError ? <ErrorShell message={creatorError} /> : <LoadingShell />;
  }

  if (creator.banned) {
    return (
      <>
        <Nav />
        <div className="flex items-center justify-center px-4" style={{ minHeight: "calc(100dvh - 60px)" }}>
          <div className="text-center max-w-md">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--error)" }}>Account Suspended</h1>
            <p style={{ color: "var(--muted)" }}>
              Your publisher account has been suspended. Contact support if you believe this is an error.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8">
          <div>
            <h2 className="text-2xl font-bold">Signed in as @{user.github}</h2>
            <p style={{ color: "var(--muted)" }} className="text-sm mt-1">Publish and manage your games</p>
          </div>
          <span
            className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium shrink-0"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {creator.remaining} of {creator.maxGames} slots
          </span>
        </div>

        {creator.games.length > 0 && <GameList games={creator.games} />}

        {!showForm && (
          <>
            <button
              onClick={() => setShowForm(true)}
              disabled={creator.remaining <= 0}
              className="w-full sm:w-auto px-6 font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}
            >
              Create Game
            </button>
            {creator.remaining <= 0 && (
              <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                You've used all your slots. Request more by opening an issue on GitHub.
              </p>
            )}
          </>
        )}

        {showForm && (
          <CreateGameForm
            onCreated={reloadCreator}
            onClose={() => setShowForm(false)}
          />
        )}
      </main>
    </>
  );
}

function GameList({ games }: { games: GameRepo[] }) {
  // Every game surfaced here comes from the store registry, and provisioning
  // registers a game the instant it's created — so a listed game is always Live.
  // (The old Draft state + inline Publish button were unreachable: registry-
  // primary ownership always returns published=true. In-progress, not-yet-
  // deployed work lives as a VibeCode session in the studio picker, not here.)
  return (
    <section className="mb-8">
      <h3 className="text-lg font-semibold mb-3">Your Games</h3>
      <div className="flex flex-col gap-2">
        {games.map((game) => (
          <div
            key={game.id}
            className="flex items-center justify-between p-4 rounded-xl gap-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold truncate">{game.name}</p>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                  style={{ background: "var(--accent-soft, #1a2e26)", color: "var(--accent)" }}
                >
                  Live
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1" style={{ color: "var(--muted)" }}>
                <a href={game.liveUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>Open</a>
                <a href={game.repoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Code</a>
                {game.createdAt && <span>{game.createdAt}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
