import { Play, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreateGameForm } from '../components/CreateGameForm';
import { GameVersion } from '../components/GameVersion';
import { Nav } from '../components/Nav';
import { ErrorShell, LoadingShell, SignInShell } from '../components/PageShell';
import { Badge, Button, buttonClass } from '../components/ui';
import { type GameRepo, useAuth } from '../hooks/useAuth';
import { type DraftSession, useDraftSessions } from '../hooks/useDraftSessions';
import { decodeIcon, formatDate, formatRelative } from '../lib/format';
import { activityLabel, activityTone, type SessionActivity } from '../lib/sessions';

export function Dashboard() {
  const { user, creator, creatorError, loading, error, fetchCreator, reloadCreator, signIn } =
    useAuth();
  const { drafts, activity, discard } = useDraftSessions();
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCreator();
  }, [fetchCreator]);

  if (loading) return <LoadingShell />;
  if (error) return <ErrorShell message={error} />;
  // Only prompt sign-in when genuinely signed out. A signed-in user whose game
  // list failed to load is NOT signed out — show the error (with retry), never
  // "Sign in to publish."
  if (!user) {
    return (
      <SignInShell
        onSignIn={signIn}
        message="Sign in with GitHub to publish games on FreeGameStore."
      />
    );
  }
  if (!creator) {
    return creatorError ? (
      <ErrorShell message={creatorError} onRetry={reloadCreator} />
    ) : (
      <LoadingShell />
    );
  }

  if (creator.banned) {
    return (
      <>
        <Nav />
        <div
          className="flex items-center justify-center px-4"
          style={{ minHeight: 'calc(100dvh - 60px)' }}
        >
          <div className="text-center max-w-md">
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--error)' }}>
              Account Suspended
            </h1>
            <p style={{ color: 'var(--muted)' }}>
              Your creator account has been suspended. Contact support if you believe this is an
              error.
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
            <p style={{ color: 'var(--muted)' }} className="text-sm mt-1">
              Build, publish, and manage your games
            </p>
          </div>
          <Badge tone="accent" className="shrink-0 text-sm px-3 py-1.5">
            {creator.remaining} of {creator.maxGames} slots
          </Badge>
        </div>

        {(creator.games.length > 0 || drafts.length > 0) && (
          <MyGamesList
            games={creator.games}
            drafts={drafts}
            activity={activity}
            onDiscard={discard}
          />
        )}

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
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
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
              navigate(`/create/${id}`);
            }}
            onClose={() => setShowForm(false)}
          />
        )}
      </main>
    </>
  );
}

type GameRow =
  | { kind: 'live'; id: string; sortAt: number; game: GameRepo }
  | { kind: 'draft'; id: string; sortAt: number; draft: DraftSession };

function rowTime(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function MyGamesList({
  games,
  drafts,
  activity,
  onDiscard,
}: {
  games: GameRepo[];
  drafts: DraftSession[];
  activity: Map<string, SessionActivity>;
  onDiscard: (id: string) => void;
}) {
  const rows: GameRow[] = [
    ...games.map((game) => ({
      kind: 'live' as const,
      id: game.id,
      sortAt: rowTime(game.lastEditedAt || game.createdAt),
      game,
    })),
    ...drafts.map((draft) => ({
      kind: 'draft' as const,
      id: draft.id,
      sortAt: rowTime(draft.createdAt),
      draft,
    })),
  ].sort((a, b) => b.sortAt - a.sortAt || a.id.localeCompare(b.id));

  return (
    <section className="mb-8">
      <h3 className="text-lg font-semibold mb-3">My Games</h3>
      <div className="flex flex-col gap-2">
        {rows.map((row) =>
          row.kind === 'live' ? (
            <LiveGameRow
              key={`live:${row.id}`}
              game={row.game}
              activity={activity.get(row.game.id)}
            />
          ) : (
            <DraftGameRow key={`draft:${row.id}`} draft={row.draft} onDiscard={onDiscard} />
          ),
        )}
      </div>
    </section>
  );
}

function StatusBadge({
  activity,
  deployed = false,
}: {
  activity?: SessionActivity;
  deployed?: boolean;
}) {
  const detail = activity?.detail && activity.phase === 'error' ? activity.detail : undefined;
  return (
    <Badge tone={activityTone(activity, deployed)} className="shrink-0" title={detail}>
      {activityLabel(activity, deployed)}
    </Badge>
  );
}

function LiveGameRow({ game, activity }: { game: GameRepo; activity?: SessionActivity }) {
  return (
    <div
      className="flex items-center gap-2 p-3 rounded-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <Link
        to={`/create/${game.id}`}
        aria-label={`Edit ${game.name}`}
        className="flex items-center gap-3 flex-1 min-w-0 no-underline"
        style={{ color: 'inherit' }}
      >
        <span
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{
            width: 40,
            height: 40,
            background: game.iconBg || 'var(--bg)',
            fontSize: '1.3rem',
          }}
        >
          {decodeIcon(game.icon) || '🎮'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold break-words">{game.name}</p>
            <StatusBadge activity={activity} deployed />
          </div>
          <div
            className="flex flex-wrap gap-x-3 gap-y-1 text-sm mt-1"
            style={{ color: 'var(--muted)' }}
          >
            {game.createdAt && (
              <span title={`Created ${new Date(game.createdAt).toLocaleString()}`}>
                Created {formatDate(game.createdAt)}
              </span>
            )}
            {game.lastEditedAt && (
              <span title={`Last edited ${new Date(game.lastEditedAt).toLocaleString()}`}>
                Edited {formatRelative(game.lastEditedAt)}
              </span>
            )}
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
          className={buttonClass('secondary', 'md', 'w-11 px-0')}
        >
          <Play className="w-5 h-5" />
        </a>
        <Link
          to={`/game/${game.id}`}
          aria-label={`Settings for ${game.name}`}
          title="Settings"
          className={buttonClass('secondary', 'md', 'w-11 px-0')}
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}

function DraftGameRow({
  draft,
  onDiscard,
}: {
  draft: DraftSession;
  onDiscard: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-4 rounded-xl gap-3"
      style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}
    >
      <Link
        to={`/create/${draft.id}`}
        aria-label={`Open ${draft.name}`}
        className="flex items-center gap-3 flex-1 min-w-0 no-underline"
        style={{ color: 'inherit' }}
      >
        <span
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{
            width: 40,
            height: 40,
            background: 'var(--bg)',
            fontSize: '0.9rem',
            color: 'var(--muted)',
          }}
        >
          Draft
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold break-words">{draft.name}</p>
            <StatusBadge activity={draft.activity} />
          </div>
          {draft.createdAt && (
            <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              <span title={new Date(draft.createdAt).toLocaleString()}>
                Started {formatDate(draft.createdAt)}
              </span>
            </div>
          )}
        </div>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <Link to={`/create/${draft.id}`} className={buttonClass('primary', 'md')}>
          Open
        </Link>
        <Button
          variant="secondary"
          onClick={() => {
            if (confirm(`Discard draft "${draft.name}"? This can't be undone.`))
              onDiscard(draft.id);
          }}
          aria-label={`Discard draft ${draft.name}`}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
