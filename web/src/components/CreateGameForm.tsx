import { useState } from "react";

interface ProvisionStep {
  name: string;
  status: string;
  detail: string;
}

const CATEGORIES = [
  { value: "strategy", label: "Strategy" },
  { value: "brain-training", label: "Brain Training" },
  { value: "arcade", label: "Arcade" },
  { value: "racing", label: "Racing" },
  { value: "sports", label: "Sports" },
  { value: "cards", label: "Cards" },
  { value: "casual", label: "Casual" },
];

const TEMPLATES = [
  { value: "canvas", label: "Canvas", desc: "HTML5 Canvas for 2D arcade, platformers, and action games" },
  { value: "grid", label: "Grid", desc: "Tile-based grid for puzzles, board games, and strategy" },
  { value: "cards", label: "Cards", desc: "Card layout for solitaire, memory, and card games" },
  { value: "3d", label: "3D", desc: "Three.js for 3D racing, flying, and 3D worlds" },
];

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateId(id: string): string | null {
  if (!id) return null;
  if (id.length > 58) return "58 chars max";
  if (!/^[a-z0-9-]*$/.test(id)) return "Lowercase letters, numbers, dashes only";
  if (!ID_RE.test(id)) return "Cannot start or end with a dash";
  if (id.startsWith("free") || id.startsWith("pro")) return "Cannot start with 'free' or 'pro'";
  return null;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ok" ? "bg-emerald-500" :
    status === "skip" ? "bg-yellow-500" :
    "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

const inputStyle = { minHeight: 44, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)" };

interface CreateGameFormProps {
  /** Called on a successful create with the new game id — the Dashboard reloads
   *  its game list so the new game appears (no more full-page reload needed). */
  onCreated: (id: string) => void | Promise<void>;
  /** Close the form and return to the game list. */
  onClose: () => void;
}

/** Self-contained game creation form with validation, provisioning, and result display. */
export function CreateGameForm({ onCreated, onClose }: CreateGameFormProps) {
  const [gameId, setGameId] = useState("");
  const [gameName, setGameName] = useState("");
  const [category, setCategory] = useState("casual");
  const [icon, setIcon] = useState("\uD83C\uDFAE");
  const [iconBg, setIconBg] = useState("#1a2e26");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("canvas");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ steps: ProvisionStep[]; success: boolean } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const idError = validateId(gameId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);

    try {
      const createRes = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gameId, name: gameName, category, icon, iconBg, description, template }),
      });
      const createData = await createRes.json().catch(() => ({} as { steps?: ProvisionStep[]; success?: boolean; error?: string }));
      if (!createRes.ok || createData.error) {
        setSubmitError(createData.error || `Create failed (${createRes.status})`);
      } else if (createData.steps) {
        setResult({ steps: createData.steps, success: createData.success ?? false });
        if (createData.success) await onCreated(gameId);
      } else {
        setSubmitError("Unexpected response from the server");
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? `Request failed: ${e.message}` : "Network error");
    } finally {
      setSubmitting(false);
    }
  };


  if (result) {
    return (
      <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-lg font-semibold">
          {result.success ? "Game Created" : "Provisioning Failed"}
        </h3>
        <div className="space-y-2">
          {result.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <StatusDot status={step.status} />
              <span className="font-medium w-28 shrink-0">{step.name}</span>
              <span style={{ color: "var(--muted)" }}>{step.detail}</span>
            </div>
          ))}
        </div>
        {result.success && (
          <div className="pt-2 text-sm space-y-1" style={{ color: "var(--muted)" }}>
            <p>Your game is live at <a href={`https://${gameId}.freegamestore.online`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }} className="hover:underline">{gameId}.freegamestore.online</a></p>
            <p>Edit your code at <a href={`https://github.com/freegamestore-online/${gameId}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }} className="hover:underline">github.com/freegamestore-online/{gameId}</a></p>
          </div>
        )}
        <button onClick={onClose} className="px-6 font-semibold rounded-xl" style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl p-6 space-y-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-lg font-semibold">Create a New Game</h3>

      <div>
        <label htmlFor="game-id" className="block text-sm font-medium mb-1.5">Game ID</label>
        <input id="game-id" type="text" value={gameId}
          onChange={(e) => setGameId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="my-game" required
          className="w-full px-3 rounded-lg outline-none focus:ring-2"
          style={{ ...inputStyle, ...(idError ? { borderColor: "var(--error)" } : {}) }}
        />
        {idError && <p className="text-sm mt-1" style={{ color: "var(--error)" }}>{idError}</p>}
        {gameId && !idError && <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>{gameId}.freegamestore.online</p>}
      </div>

      <div>
        <label htmlFor="game-name" className="block text-sm font-medium mb-1.5">Display Name</label>
        <input id="game-name" type="text" value={gameName} onChange={(e) => setGameName(e.target.value)}
          placeholder="My Game" required className="w-full px-3 rounded-lg outline-none focus:ring-2" style={inputStyle} />
      </div>

      <div>
        <label htmlFor="game-category" className="block text-sm font-medium mb-1.5">Category</label>
        <select id="game-category" value={category} onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 rounded-lg outline-none focus:ring-2 appearance-none" style={inputStyle}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label htmlFor="game-icon" className="block text-sm font-medium mb-1.5">Icon (emoji)</label>
          <input id="game-icon" type="text" value={icon} onChange={(e) => setIcon(e.target.value)}
            className="w-full px-3 rounded-lg outline-none focus:ring-2 text-center text-2xl" style={inputStyle} />
        </div>
        <div className="flex-1">
          <label htmlFor="game-icon-bg" className="block text-sm font-medium mb-1.5">Icon Background</label>
          <div className="flex items-center gap-2">
            <input type="color" value={iconBg} onChange={(e) => setIconBg(e.target.value)}
              aria-label="Icon background color picker" className="w-11 h-11 rounded-lg border-0 cursor-pointer p-0" />
            <input id="game-icon-bg" type="text" value={iconBg} onChange={(e) => setIconBg(e.target.value)}
              className="flex-1 px-3 rounded-lg outline-none focus:ring-2 font-mono text-sm" style={inputStyle} />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="game-desc" className="block text-sm font-medium mb-1.5">One-line Description</label>
        <input id="game-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="A fun and addictive puzzle game" className="w-full px-3 rounded-lg outline-none focus:ring-2" style={inputStyle} />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium mb-2">Template</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <label key={t.value} className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
              style={{ background: template === t.value ? "var(--accent-soft)" : "var(--bg)", border: `1px solid ${template === t.value ? "var(--accent)" : "var(--border)"}` }}>
              <input type="radio" name="template" value={t.value} checked={template === t.value}
                onChange={(e) => setTemplate(e.target.value)} className="mt-1 accent-emerald-500" />
              <div>
                <p className="font-medium text-sm">{t.label}</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{t.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {submitError && <p className="text-sm font-medium" style={{ color: "var(--error)" }}>{submitError}</p>}

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={submitting || !gameId || !gameName || !!idError}
          className="px-6 font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}>
          {submitting ? "Creating..." : "Create Game"}
        </button>
        <button type="button" onClick={onClose} disabled={submitting}
          className="px-6 font-semibold rounded-xl"
          style={{ minHeight: 44, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
