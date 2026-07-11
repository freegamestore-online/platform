import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Nav } from "../components/Nav";
import { LoadingShell, SignInShell, ErrorShell } from "../components/PageShell";
import { useAuth } from "../hooks/useAuth";
import { useDraftSessions, type DraftSession } from "../hooks/useDraftSessions";
import { decodeIcon, formatDate, formatRelative } from "../lib/format";
import { Button, Card, Badge, Field, Input, Select, Textarea } from "../components/ui";

const CATEGORIES = ["arcade", "puzzle", "strategy", "racing", "sports", "cards", "board", "rpg", "action", "casual"];

export function GameSettings() {
  const { id } = useParams<{ id: string }>();
  const { user, creator, creatorError, loading, fetchCreator, reloadCreator, signIn } = useAuth();
  const drafts = useDraftSessions();
  const navigate = useNavigate();

  useEffect(() => { fetchCreator(); }, [fetchCreator]);

  const game = creator?.games.find((g) => g.id === id);
  const draft = drafts.drafts.find((d) => d.id === id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("arcade");
  const [icon, setIcon] = useState("");
  const [iconBg, setIconBg] = useState("#10b981");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Seed the form once the live game loads. (No-op for drafts — they render a
  // separate, lighter settings view below.)
  useEffect(() => {
    if (!game) return;
    setName(game.name);
    setDescription(game.description);
    setCategory(game.category || "arcade");
    // Normalize the agent's HTML-entity icons to the raw emoji so the field is
    // editable and a save stores clean data going forward.
    setIcon(decodeIcon(game.icon));
    setIconBg(game.iconBg || "#10b981");
  }, [game?.id]);

  const save = async () => {
    if (!game) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), description: description.trim(), category, icon: icon.trim(), iconBg }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        await reloadCreator();
        setMsg({ kind: "ok", text: "Saved." });
      } else {
        setMsg({ kind: "err", text: data.error || `Save failed (${res.status}).` });
      }
    } catch (e) {
      setMsg({ kind: "err", text: `Save failed: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!game) return;
    setDeleting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/games/${game.id}`, { method: "DELETE", credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        await reloadCreator();
        navigate("/");
      } else {
        setMsg({ kind: "err", text: data.error || `Delete failed (${res.status}).` });
        setDeleting(false);
      }
    } catch (e) {
      setMsg({ kind: "err", text: `Delete failed: ${(e as Error).message}` });
      setDeleting(false);
    }
  };

  if (loading) return <LoadingShell />;
  if (!user) return <SignInShell onSignIn={signIn} message="Sign in to manage your games." />;

  // A draft (in-progress VibeCode session that hasn't deployed to a live game)
  // has its own, lighter settings — rename + discard. It isn't in the registry,
  // so it doesn't depend on `creator` loading at all.
  if (!game && draft) {
    return <DraftSettings draft={draft} onRename={drafts.rename} onDiscard={drafts.discard} />;
  }

  if (!game) {
    // Neither a live game nor a draft (yet). Still loading one of the sources?
    if ((!creator && !creatorError) || drafts.loading) return <LoadingShell />;
    // Registry unreachable — a live game may exist but we can't see it. Offer a retry.
    if (!creator && creatorError) return <ErrorShell message={creatorError} onRetry={reloadCreator} />;
    // Both sources loaded and it's in neither.
    return (
      <>
        <Nav />
        <main className="max-w-2xl mx-auto px-4 py-10 text-center">
          <h1 className="text-2xl font-bold mb-2">Game not found</h1>
          <p className="mb-4" style={{ color: "var(--muted)" }}>“{id}” isn't one of your games or drafts.</p>
          <Link to="/" className="font-semibold" style={{ color: "var(--accent)" }}>← Back to My Games</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm font-semibold no-underline" style={{ color: "var(--muted)" }}>← My Games</Link>

        <div className="flex items-center gap-3 mt-3 mb-1">
          <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 48, height: 48, background: iconBg || "var(--surface)", fontSize: "1.6rem" }}>
            {icon || "🎮"}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{name || game.id}</h1>
            <Badge tone="accent">Live</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2 mb-6" style={{ color: "var(--muted)" }}>
          <a href={game.liveUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>Play</a>
          <a href={game.repoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Code</a>
          <Link to={`/create/${game.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>Edit in VibeCode</Link>
          {game.createdAt && <span>Created {formatDate(game.createdAt)}</span>}
          {game.lastEditedAt && <span>Last edited {formatRelative(game.lastEditedAt)}</span>}
        </div>

        {msg && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: msg.kind === "ok" ? "color-mix(in srgb, #22c55e 12%, transparent)" : "color-mix(in srgb, #ef4444 12%, transparent)", color: msg.kind === "ok" ? "#22c55e" : "#ef4444" }}>
            {msg.text}
          </div>
        )}

        {/* Details */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Details</h2>
          <Field label="Name" htmlFor="g-name">
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Description" htmlFor="g-desc">
            <Textarea id="g-desc" className="min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Category" htmlFor="g-cat">
            <Select id="g-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </Select>
          </Field>
          <div className="flex gap-4">
            <Field label="Icon" htmlFor="g-icon">
              <Input id="g-icon" style={{ width: 72, textAlign: "center", fontSize: "1.3rem" }} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🎮" maxLength={4} />
            </Field>
            <Field label="Icon background" htmlFor="g-bg">
              <Input id="g-bg" type="color" style={{ width: 72, height: 40, padding: 2 }} value={iconBg || "#10b981"} onChange={(e) => setIconBg(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Icon + background are the game's artwork in the store. Free-tier games use an emoji icon (no image uploads).</p>
          <div>
            <Button variant="primary" onClick={save} disabled={saving} className="px-6">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Card>

        {/* Conversation — reset the AI chat without touching the game. */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold mb-1">Conversation</h2>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
            Start a fresh chat for “{game.name}”. This clears the current AI conversation and reloads the game's real files into a clean chat — the game, its code, and its live site are untouched. Use it if a chat gets stuck or confused.
          </p>
          <Button variant="secondary" onClick={() => navigate(`/create?game=${encodeURIComponent(game.id)}&fresh=1`)} className="px-5">
            Start a fresh chat
          </Button>
        </Card>

        {/* Danger zone */}
        <section className="flex flex-col gap-3 p-5 rounded-2xl mt-6" style={{ background: "color-mix(in srgb, #ef4444 5%, var(--surface))", border: "1px solid color-mix(in srgb, #ef4444 30%, var(--border))" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#ef4444" }}>Delete game</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Delists “{game.name}” from the store, stops it serving at {game.id}.freegamestore.online, and archives its repo. This frees a slot. It can't be undone from here.
          </p>
          {!confirmDelete ? (
            <div>
              <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} className="px-5">
                Delete this game
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">Really delete “{game.name}”?</span>
              <Button variant="danger" onClick={del} disabled={deleting} className="px-5">
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} className="px-5">
                Cancel
              </Button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/** Settings for a draft (undeployed VibeCode session): rename, continue building,
 *  or discard. Drafts aren't in the store registry, so there's no artwork /
 *  category / live URL until they deploy. */
function DraftSettings({
  draft,
  onRename,
  onDiscard,
}: {
  draft: DraftSession;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDiscard: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(draft.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const ok = await onRename(draft.id, name.trim() || "Untitled");
    setSaving(false);
    setMsg(ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: "Couldn't rename the draft. Try again." });
  };

  const discard = async () => {
    setDeleting(true);
    await onDiscard(draft.id);
    navigate("/");
  };

  return (
    <>
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm font-semibold no-underline" style={{ color: "var(--muted)" }}>← My Games</Link>

        <div className="flex items-center gap-3 mt-3 mb-1">
          <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 48, height: 48, background: "var(--surface)", fontSize: "1.6rem" }}>🎮</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{name || "Untitled"}</h1>
            <Badge tone="muted">Draft</Badge>
          </div>
        </div>

        <p className="text-sm mt-2 mb-6" style={{ color: "var(--muted)" }}>
          This game hasn't been published yet. Keep building it in VibeCode and deploy it
          to make it live in the store — artwork, category, and its play URL appear then.
          {" "}
          <Link to={`/create/${draft.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>Continue in VibeCode →</Link>
        </p>

        {msg && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: msg.kind === "ok" ? "color-mix(in srgb, #22c55e 12%, transparent)" : "color-mix(in srgb, #ef4444 12%, transparent)", color: msg.kind === "ok" ? "#22c55e" : "#ef4444" }}>
            {msg.text}
          </div>
        )}

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Details</h2>
          <Field label="Name" htmlFor="d-name">
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <div>
            <Button variant="primary" onClick={save} disabled={saving} className="px-6">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Card>

        <section className="flex flex-col gap-3 p-5 rounded-2xl mt-6" style={{ background: "color-mix(in srgb, #ef4444 5%, var(--surface))", border: "1px solid color-mix(in srgb, #ef4444 30%, var(--border))" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#ef4444" }}>Discard draft</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Removes this in-progress game and its build session. Nothing is published, so
            nothing goes offline — but the work in this draft can't be recovered.
          </p>
          {!confirmDelete ? (
            <div>
              <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} className="px-5">
                Discard this draft
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">Really discard “{name || "Untitled"}”?</span>
              <Button variant="danger" onClick={discard} disabled={deleting} className="px-5">
                {deleting ? "Discarding…" : "Yes, discard"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} className="px-5">
                Cancel
              </Button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
