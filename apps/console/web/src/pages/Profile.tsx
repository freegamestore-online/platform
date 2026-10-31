import { useState } from 'react';
import { AISettings } from '../components/AISettings';
import { KidModeSetting } from '../components/KidModeSetting';
import { Nav } from '../components/Nav';
import { LoadingShell, SignInShell } from '../components/PageShell';
import { TextSizeSetting } from '../components/TextSizeSetting';
import { ThemeSetting } from '../components/ThemeSetting';
import { useAuth } from '../hooks/useAuth';
import { useUsage } from '../hooks/useUsage';
import { formatTokens } from '../lib/sessions';

export function Profile() {
  const { user, creator, loading, signIn, signOut } = useAuth();
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { totals, games: usageGames } = useUsage();
  if (loading) return <LoadingShell />;
  if (!user) return <SignInShell onSignIn={signIn} message="Sign in to view your profile." />;

  const gamesCount = creator?.games.length ?? 0;

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/auth/delete', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        agent?: { error?: string };
        auth?: { error?: string };
      };

      if (!res.ok || !data.ok) {
        const errorMsg =
          data.error || data.agent?.error || data.auth?.error || 'Account deletion failed';
        setDeleteError(errorMsg);
        setDeleting(false);
      } else {
        // Success: sign out and redirect
        signOut();
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Network error during deletion');
      setDeleting(false);
    }
  }

  return (
    <>
      <Nav />
      <div className="max-w-xl mx-auto px-4 py-12">
        {/* AI Providers — first thing on the profile: it's the setting users come
            here to manage (keys live in the encrypted vault, never the browser). */}
        <div className="mb-8">
          <AISettings />
        </div>

        {/* Appearance — theme and text size for the whole studio. */}
        <div className="mb-8">
          <ThemeSetting />
        </div>
        <div className="mb-8">
          <TextSizeSetting />
        </div>

        {/* Kid mode — rewrite the AI's replies for a kid, funny and simple. */}
        <div className="mb-8">
          <KidModeSetting />
        </div>

        {/* Avatar + name card */}
        <div className="flex items-center gap-4 p-6 rounded-2xl border border-line bg-panel mb-8">
          <img
            src={user.avatarUrl}
            alt={user.github}
            className="size-12 rounded-full border-2 border-line shrink-0"
          />
          {/* min-w-0 so a long @username wraps inside the card instead of
              overflowing the panel on a narrow phone. */}
          <div className="min-w-0">
            <h2 className="text-xl font-bold mb-0.5 break-words">@{user.github}</h2>
            <p className="text-sm text-muted">GitHub creator account</p>
          </div>
        </div>

        {/* Account details */}
        <div className="mb-8">
          <h3 className="text-base font-bold mb-3 pb-2 border-b border-line">Account Details</h3>
          <DetailRow label="Provider" value="GitHub" />
          <DetailRow label="Username" value={`@${user.github}`} />
          {user.name && <DetailRow label="Name" value={user.name} />}
          <DetailRow label="User ID" value={user.sub ?? 'unknown'} mono copyable={!!user.sub} />
          {user.githubId != null && (
            <DetailRow label="GitHub ID" value={String(user.githubId)} mono copyable />
          )}
          {user.email && <DetailRow label="Email" value={user.email} />}
          {user.createdAt && (
            <DetailRow label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
          )}
          <DetailRow
            label="Published games"
            value={String(gamesCount)}
            valueClassName={gamesCount > 0 ? 'text-accent' : 'text-muted'}
          />
          {creator && (
            <DetailRow
              label="Slots remaining"
              value={`${creator.remaining} of ${creator.maxGames}`}
            />
          )}
        </div>

        {/* Token usage — how much AI the account has spent, in total and per game.
            Reads the agent session index (same source as the studio picker), so
            it's free to show. Hidden entirely until there's something to report. */}
        {totals && totals.input + totals.output > 0 && (
          <div className="mb-8">
            <h3 className="text-base font-bold mb-3 pb-2 border-b border-line">AI Usage</h3>
            <DetailRow
              label="Tokens used (total)"
              value={formatTokens(totals.input + totals.output)}
              valueClassName="text-accent"
            />
            <DetailRow
              label="Input / Output"
              value={`${formatTokens(totals.input)} in · ${formatTokens(totals.output)} out`}
            />
            {usageGames.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-muted">
                  By game
                </p>
                {usageGames.map((g) => (
                  <div
                    key={g.id}
                    className="flex justify-between items-center gap-3 py-2 border-b border-line text-sm"
                  >
                    <span className="truncate min-w-0">{g.name}</span>
                    <span
                      className="shrink-0 font-mono text-xs tabular-nums text-muted"
                      title={`${(g.input + g.output).toLocaleString()} tokens (${g.input.toLocaleString()} in / ${g.output.toLocaleString()} out)`}
                    >
                      {formatTokens(g.input + g.output)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Session */}
        <div className="mb-8">
          <h3 className="text-base font-bold mb-3 pb-2 border-b border-line">Session</h3>
          <button
            onClick={() => signOut()}
            className="min-h-11 cursor-pointer px-5 py-2 rounded-xl text-sm font-semibold border border-line bg-transparent text-ink"
          >
            Sign out
          </button>
        </div>

        {/* Account deletion — permanent and irreversible. */}
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h3 className="text-base font-bold mb-1">Delete account</h3>
          <p className="text-sm mb-4 text-muted">
            Permanently delete your account and all associated data. This action cannot be undone.
            You will be signed out immediately.
          </p>

          {deleteError && (
            <div className="rounded-lg p-3 mb-4 text-sm bg-danger/10 border-l-[3px] border-danger text-danger">
              {deleteError}
            </div>
          )}

          {!deleteConfirming ? (
            <button
              onClick={() => setDeleteConfirming(true)}
              className="min-h-11 cursor-pointer px-5 py-2 rounded-xl text-sm font-semibold border border-danger bg-danger/10 text-danger"
            >
              Delete my account
            </button>
          ) : (
            <div>
              <p className="text-sm mb-4 font-semibold">Are you absolutely sure? This will:</p>
              <ul className="text-sm mb-4 list-disc list-inside text-muted">
                <li>Delete all your AI chat sessions and transcripts</li>
                <li>Delete your saved API keys</li>
                <li>Delete your account profile and all personal data</li>
                <li>Sign you out immediately</li>
              </ul>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setDeleteConfirming(false);
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  className={`min-h-11 px-5 py-2 rounded-xl text-sm font-semibold border border-line bg-transparent text-ink ${
                    deleting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className={`min-h-11 px-5 py-2 rounded-xl text-sm font-semibold border border-danger text-danger-soft ${
                    deleting
                      ? 'cursor-not-allowed bg-danger/50 opacity-80'
                      : 'cursor-pointer bg-danger'
                  }`}
                >
                  {deleting ? 'Deleting...' : 'Yes, delete everything'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  valueClassName,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="flex justify-between items-start gap-3 py-2.5 border-b border-line text-sm">
      <span className="font-medium shrink-0 pt-px text-muted">{label}</span>
      <span className="flex items-start gap-2 min-w-0">
        {/* Long mono IDs (User ID / GitHub ID) wrap and stay inside the panel
            rather than truncating with an ellipsis — the whole value is readable
            on mobile. Plain values still truncate to one tidy line. */}
        <span
          className={`font-semibold text-right${mono ? ' font-mono text-xs break-all' : ' truncate'}${
            valueClassName ? ` ${valueClassName}` : ''
          }`}
        >
          {value}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            className={`shrink-0 cursor-pointer px-2 py-0.5 rounded-md text-xs font-medium border border-line bg-transparent ${
              copied ? 'text-accent' : 'text-muted'
            }`}
            title="Copy to clipboard"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </span>
    </div>
  );
}
