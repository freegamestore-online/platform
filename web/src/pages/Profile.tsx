import { useState } from "react";
import { Nav } from "../components/Nav";
import { AISettings } from "../components/AISettings";
import { TextSizeSetting } from "../components/TextSizeSetting";
import { KidModeSetting } from "../components/KidModeSetting";
import { LoadingShell, SignInShell } from "../components/PageShell";
import { useAuth } from "../hooks/useAuth";

export function Profile() {
  const { user, creator, loading, signIn, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    if (!confirm("This will permanently remove all your data. Last chance -- continue?")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/auth/delete", { method: "POST", credentials: "include" });
      if (!res.ok) {
        // Never redirect as if it worked — a silent "/" redirect made a failed
        // delete look successful, so the account was actually still live.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(data.error || `Couldn't delete your account (${res.status}). Please try again.`);
        setDeleting(false);
        return;
      }
      window.location.href = "/";
    } catch (e) {
      setDeleteError(`Couldn't delete your account: ${e instanceof Error ? e.message : "network error"}`);
      setDeleting(false);
    }
  }

  if (loading) return <LoadingShell />;
  if (!user) return <SignInShell onSignIn={signIn} message="Sign in to view your profile." />;

  const gamesCount = creator?.games.length ?? 0;

  return (
    <>
      <Nav />
      <div className="max-w-xl mx-auto px-4 py-12">
        {/* AI Providers — first thing on the profile: it's the setting users come
            here to manage (keys live in the encrypted vault, never the browser). */}
        <div className="mb-8">
          <AISettings />
        </div>

        {/* Appearance — text size for the whole studio. */}
        <div className="mb-8">
          <TextSizeSetting />
        </div>

        {/* Kid mode — rewrite the AI's replies for a kid, funny and simple. */}
        <div className="mb-8">
          <KidModeSetting />
        </div>

        {/* Avatar + name card */}
        <div
          className="flex items-center gap-4 p-6 rounded-2xl border mb-8"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <img
            src={user.avatarUrl}
            alt={user.github}
            className="rounded-full border-2 shrink-0"
            style={{ width: 48, height: 48, borderColor: "var(--border)" }}
          />
          {/* min-w-0 so a long @username wraps inside the card instead of
              overflowing the panel on a narrow phone. */}
          <div className="min-w-0">
            <h2 className="text-xl font-bold mb-0.5 break-words">@{user.github}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              GitHub publisher account
            </p>
          </div>
        </div>

        {/* Account details */}
        <div className="mb-8">
          <h3
            className="text-base font-bold mb-3 pb-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            Account Details
          </h3>
          <DetailRow label="Provider" value="GitHub" />
          <DetailRow label="Username" value={`@${user.github}`} />
          {user.name && <DetailRow label="Name" value={user.name} />}
          <DetailRow
            label="User ID"
            value={user.sub ?? "unknown"}
            mono
            copyable={!!user.sub}
          />
          {user.githubId != null && (
            <DetailRow label="GitHub ID" value={String(user.githubId)} mono copyable />
          )}
          {user.email && <DetailRow label="Email" value={user.email} />}
          {user.createdAt && (
            <DetailRow
              label="Member since"
              value={new Date(user.createdAt).toLocaleDateString()}
            />
          )}
          <DetailRow
            label="Published games"
            value={String(gamesCount)}
            valueStyle={{ color: gamesCount > 0 ? "var(--accent)" : "var(--muted)" }}
          />
          {creator && (
            <DetailRow
              label="Slots remaining"
              value={`${creator.remaining} of ${creator.maxGames}`}
            />
          )}
        </div>

        {/* Session */}
        <div className="mb-8">
          <h3
            className="text-base font-bold mb-3 pb-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            Session
          </h3>
          <button
            onClick={() => signOut()}
            className="px-5 py-2 rounded-xl text-sm font-semibold border"
            style={{
              minHeight: 44,
              background: "transparent",
              color: "var(--ink)",
              borderColor: "var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>

        {/* Danger zone */}
        <div
          className="rounded-2xl border p-6"
          style={{
            background: "color-mix(in srgb, var(--error) 6%, var(--surface))",
            borderColor: "color-mix(in srgb, var(--error) 25%, var(--border))",
          }}
        >
          <h3 className="text-base font-bold mb-1" style={{ color: "var(--error)" }}>
            Danger Zone
          </h3>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            Permanently delete your account and all stored data. Your published games will remain live but you will lose publisher access.
          </p>
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white"
            style={{
              minHeight: 44,
              background: "var(--error)",
              border: "none",
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            {deleting ? "Deleting..." : "Delete my account"}
          </button>
          {deleteError && (
            <p className="text-sm mt-3 font-medium" style={{ color: "var(--error)" }}>{deleteError}</p>
          )}
        </div>
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  valueStyle,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  valueStyle?: React.CSSProperties;
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
    <div
      className="flex justify-between items-start gap-3 py-2.5 border-b text-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="font-medium shrink-0 pt-px" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="flex items-start gap-2 min-w-0">
        {/* Long mono IDs (User ID / GitHub ID) wrap and stay inside the panel
            rather than truncating with an ellipsis — the whole value is readable
            on mobile. Plain values still truncate to one tidy line. */}
        <span
          className={`font-semibold text-right${mono ? " font-mono text-xs break-all" : " truncate"}`}
          style={valueStyle}
        >
          {value}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            className="shrink-0 px-2 py-0.5 rounded-md text-xs font-medium border"
            style={{
              background: "transparent",
              color: copied ? "var(--accent)" : "var(--muted)",
              borderColor: "var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="Copy to clipboard"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </span>
    </div>
  );
}
