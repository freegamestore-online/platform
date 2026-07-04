import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Settings } from "lucide-react";
import { Nav } from "../components/Nav";
import { CreateGameForm } from "../components/CreateGameForm";
import { GameVersion } from "../components/GameVersion";
import { LoadingShell, SignInShell, ErrorShell } from "../components/PageShell";
import { useAuth, type GameRepo } from "../hooks/useAuth";
import { useDraftSessions, type DraftSession } from "../hooks/useDraftSessions";
import { decodeIcon, formatDate, formatRelative } from "../lib/format";
import { Button, Badge, buttonClass } from "../components/ui";

export function Dashboard() {
  const { user, creator, creatorError, loading, error, fetchCreator, reloadCreator, signIn } = useAuth();
  const { drafts, discard } = useDraftSessions();
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();

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
    return creatorError ? <ErrorShell message={creatorError} onRetry={reloadCreator} /> : <LoadingShell />;
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
          <Badge tone="accent" className="shrink-0 text-sm px-3 py-1.5">
            {creator.remaining} of {creator.maxGames} slots
          </Badge>
        </div>

        {creator.games.length > 0 && <GameList games={creator.games} />}

        {drafts.length > 0 && <DraftList drafts={drafts} onDiscard={discard} />}

        {!showForm && (
          <>
            <Button
              variant="primary"
              onClick={() => setShowForm(true)}
              disabled={creator.remaining <= 0}
              className="w-full sm:w-auto px-6"
            >
              Create Game
            </Button>
            {creator.remaining <= 0 && (
              <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                You've used all your slots. Request more by opening an issue on GitHub.
              </p>
            )}
          </>
        )}

        {showForm && (
          <CreateGameForm
            onCreated={async (id) => {
              // The game is provisioned + listed; refresh the dashboard list,
              // then jump straight into the studio bound to it (imports its
              // files) — the single create→build flow.
              await reloadCreator();
              navigate(`/create?game=${id}`);
            }}
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
            className="flex items-center gap-2 p-3 rounded-xl"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {/* Tapping anywhere on the game opens it in the editor. Play + Settings
                are separate sibling controls (not nested in this Link) so they keep
                their own actions. */}
            <Link
              to={`/create?game=${game.id}`}
              aria-label={`Edit ${game.name}`}
              className="flex items-center gap-3 flex-1 min-w-0 no-underline"
              style={{ color: "inherit" }}
            >
              <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: game.iconBg || "var(--bg)", fontSize: "1.3rem" }}>
                {decodeIcon(game.icon) || "🎮"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold break-words">{game.name}</p>
                  <Badge tone="accent" className="shrink-0">Live</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-1" style={{ color: "var(--muted)" }}>
                  {game.createdAt && <span title={`Created ${new Date(game.createdAt).toLocaleString()}`}>Created {formatDate(game.createdAt)}</span>}
                  {game.lastEditedAt && <span title={`Last edited ${new Date(game.lastEditedAt).toLocaleString()}`}>Edited {formatRelative(game.lastEditedAt)}</span>}
                  <GameVersion liveUrl={game.liveUrl} />
                </div>
              </div>
            </Link>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={game.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Play ${game.name}`}
                title="Play"
                className={buttonClass("secondary", "md", "w-11 px-0")}
              >
                <Play className="w-5 h-5" />
              </a>
              <Link
                to={`/game/${game.id}`}
                aria-label={`Settings for ${game.name}`}
                title="Settings"
                className={buttonClass("secondary", "md", "w-11 px-0")}
              >
                <Settings className="w-5 h-5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// In-progress VibeCode sessions that haven't deployed yet. They live in the
// studio, not the registry, so they'd otherwise be invisible here — which made
// a game you were still building look lost. "Open" resumes the exact session.
function DraftList({ drafts, onDiscard }: { drafts: DraftSession[]; onDiscard: (id: string) => void }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-lg font-semibold">Drafts</h3>
        <span className="text-sm" style={{ color: "var(--muted)" }}>in progress — not published yet</span>
      </div>
      <div className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="flex items-center justify-between p-4 rounded-xl gap-3"
            style={{ background: "var(--surface)", border: "1px dashed var(--border)" }}
          >
            <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: "var(--bg)", fontSize: "1.3rem" }}>
              🚧
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold truncate">{draft.name}</p>
                <Badge tone="muted" className="shrink-0">Draft</Badge>
              </div>
              {draft.createdAt && (
                <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
                  <span title={new Date(draft.createdAt).toLocaleString()}>Started {formatDate(draft.createdAt)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to={`/create?session=${draft.id}`} className={buttonClass("primary", "md")}>
                Open
              </Link>
              <Button
                variant="secondary"
                onClick={() => { if (confirm(`Discard draft "${draft.name}"? This can't be undone.`)) onDiscard(draft.id); }}
                aria-label={`Discard draft ${draft.name}`}
              >
                Discard
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
