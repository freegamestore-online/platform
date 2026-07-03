import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Nav } from "../components/Nav";
import { LoadingShell, SignInShell, ErrorShell } from "../components/PageShell";
import { useAuth } from "../hooks/useAuth";
import { decodeIcon, formatDate, formatRelative } from "../lib/format";

const CATEGORIES = ["arcade", "puzzle", "strategy", "racing", "sports", "cards", "board", "rpg", "action", "casual"];

export function GameSettings() {
  const { id } = useParams<{ id: string }>();
  const { user, creator, creatorError, loading, fetchCreator, reloadCreator, signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { fetchCreator(); }, [fetchCreator]);

  const game = creator?.games.find((g) => g.id === id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("arcade");
  const [icon, setIcon] = useState("");
  const [iconBg, setIconBg] = useState("#10b981");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Seed the form once the game loads.
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

  if (loading) return <LoadingShell />;
  if (!user) return <SignInShell onSignIn={signIn} message="Sign in to manage your games." />;
  if (!creator) return creatorError ? <ErrorShell message={creatorError} /> : <LoadingShell />;
  if (!game) {
    return (
      <>
        <Nav />
        <main className="max-w-2xl mx-auto px-4 py-10 text-center">
          <h1 className="text-2xl font-bold mb-2">Game not found</h1>
          <p className="mb-4" style={{ color: "var(--muted)" }}>“{id}” isn't one of your games.</p>
          <Link to="/" className="font-semibold" style={{ color: "var(--accent)" }}>← Back to My Games</Link>
        </main>
      </>
    );
  }

  const save = async () => {
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

  const label: React.CSSProperties = { fontSize: "0.8rem", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 };
  const input: React.CSSProperties = { width: "100%", padding: "0.5rem 0.7rem", borderRadius: "0.6rem", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.9rem" };

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
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--accent-soft, #1a2e26)", color: "var(--accent)" }}>Live</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2 mb-6" style={{ color: "var(--muted)" }}>
          <a href={game.liveUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>Play</a>
          <a href={game.repoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Code</a>
          <Link to={`/create?game=${game.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>Edit in VibeCode</Link>
          {game.createdAt && <span>Created {formatDate(game.createdAt)}</span>}
          {game.lastEditedAt && <span>Last edited {formatRelative(game.lastEditedAt)}</span>}
        </div>

        {msg && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: msg.kind === "ok" ? "color-mix(in srgb, #22c55e 12%, transparent)" : "color-mix(in srgb, #ef4444 12%, transparent)", color: msg.kind === "ok" ? "#22c55e" : "#ef4444" }}>
            {msg.text}
          </div>
        )}

        {/* Details */}
        <section className="flex flex-col gap-4 p-5 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h2 className="text-lg font-semibold">Details</h2>
          <div>
            <label style={label} htmlFor="g-name">Name</label>
            <input id="g-name" style={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div>
            <label style={label} htmlFor="g-desc">Description</label>
            <textarea id="g-desc" style={{ ...input, minHeight: 80, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </div>
          <div>
            <label style={label} htmlFor="g-cat">Category</label>
            <select id="g-cat" style={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex gap-4">
            <div style={{ flex: "0 0 auto" }}>
              <label style={label} htmlFor="g-icon">Icon</label>
              <input id="g-icon" style={{ ...input, width: 72, textAlign: "center", fontSize: "1.3rem" }} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🎮" maxLength={4} />
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <label style={label} htmlFor="g-bg">Icon background</label>
              <input id="g-bg" type="color" style={{ ...input, width: 72, height: 40, padding: 2 }} value={iconBg || "#10b981"} onChange={(e) => setIconBg(e.target.value)} />
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Icon + background are the game's artwork in the store. Free-tier games use an emoji icon (no image uploads).</p>
          <div>
            <button onClick={save} disabled={saving} className="px-6 rounded-xl font-semibold disabled:opacity-50" style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        {/* Danger zone */}
        <section className="flex flex-col gap-3 p-5 rounded-2xl mt-6" style={{ background: "color-mix(in srgb, #ef4444 5%, var(--surface))", border: "1px solid color-mix(in srgb, #ef4444 30%, var(--border))" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#ef4444" }}>Delete game</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Delists “{game.name}” from the store, stops it serving at {game.id}.freegamestore.online, and archives its repo. This frees a slot. It can't be undone from here.
          </p>
          {!confirmDelete ? (
            <div>
              <button onClick={() => setConfirmDelete(true)} className="px-5 rounded-xl font-semibold" style={{ minHeight: 44, background: "transparent", color: "#ef4444", border: "1px solid #ef4444", cursor: "pointer" }}>
                Delete this game
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">Really delete “{game.name}”?</span>
              <button onClick={del} disabled={deleting} className="px-5 rounded-xl font-semibold disabled:opacity-50" style={{ minHeight: 44, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer" }}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="px-5 rounded-xl font-semibold" style={{ minHeight: 44, background: "transparent", color: "var(--ink)", border: "1px solid var(--border)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
