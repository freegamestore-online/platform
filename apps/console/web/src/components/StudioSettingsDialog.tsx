import { useState } from "react";
import { Link } from "react-router-dom";
import { Select, Input, Button } from "./ui";
import { MODEL_OPTIONS, firstModelFor } from "../lib/models";
import { isFreeProvider } from "../lib/ai-keys";
import type { useKeys } from "../hooks/useKeys";

interface Props {
  open: boolean;
  onClose: () => void;
  provider: string;
  setProvider: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  temperature: number;
  setTemperature: (v: number) => void;
  keys: ReturnType<typeof useKeys>;
}

/** AI settings as a proper modal dialog (not a sliding toolbar row). Provider,
 *  model, temperature, and a key that is saved to the ENCRYPTED SERVER VAULT
 *  (via useKeys), so it survives refresh and never sits in the browser. */
export function StudioSettingsDialog({ open, onClose, provider, setProvider, model, setModel, temperature, setTemperature, keys }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return null;

  const free = isFreeProvider(provider);
  const hasKey = keys.hasKey(provider);

  async function persistKey() {
    const k = keyInput.trim();
    if (!k) return;
    setBusy(true);
    setMsg(null);
    const ok = await keys.saveKey(provider, k);
    setBusy(false);
    if (ok) { setKeyInput(""); setMsg("Saved — encrypted on the platform, persists across refreshes."); }
    else setMsg("Couldn't save the key — try again.");
  }
  async function removeKey() {
    setBusy(true);
    await keys.removeKey(provider);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} role="dialog" aria-label="AI settings">
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">AI settings</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "var(--muted)" }}>×</button>
        </div>

        <label className="block text-sm font-semibold mb-1">Provider</label>
        <Select aria-label="AI provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(firstModelFor(e.target.value)); setKeyInput(""); setMsg(null); }} className="w-full mb-3">
          <option value="github">GitHub Models (free)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google</option>
        </Select>

        <label className="block text-sm font-semibold mb-1">Model</label>
        <Select aria-label="AI model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full mb-3">
          {(MODEL_OPTIONS[provider] || []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>

        <label className="block text-sm font-semibold mb-1">API key</label>
        {free ? (
          <p className="text-sm mb-3" style={{ color: "var(--success)" }}>GitHub Models is free — no API key needed.</p>
        ) : hasKey ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm" style={{ color: "var(--success)" }}>✓ Key saved (encrypted)</span>
            <Button size="sm" variant="danger-outline" onClick={removeKey} disabled={busy}>Remove</Button>
          </div>
        ) : (
          <div className="flex gap-2 mb-1">
            <Input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Paste your API key" aria-label="API key" className="flex-1 font-mono" onKeyDown={(e) => { if (e.key === "Enter") persistKey(); }} />
            <Button size="sm" variant="primary" onClick={persistKey} disabled={busy || !keyInput.trim()}>{busy ? "…" : "Save"}</Button>
          </div>
        )}
        {msg && <p className="text-xs mb-2" style={{ color: "var(--success)" }}>{msg}</p>}

        <label className="block text-sm font-semibold mb-1 mt-3">Creativity</label>
        <Select aria-label="Temperature" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full mb-4">
          <option value={0}>Precise (0)</option>
          <option value={0.3}>Balanced (0.3)</option>
          <option value={0.7}>Creative (0.7)</option>
          <option value={1}>Wild (1)</option>
        </Select>

        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Keys are encrypted (AES-256-GCM) on the platform and used only server-side to call the provider — they never sit in your browser. Manage all keys in <Link to="/profile" style={{ color: "var(--accent)" }} className="hover:underline">your Profile</Link>.
        </p>
        <Button variant="primary" onClick={onClose} className="w-full">Done</Button>
      </div>
    </div>
  );
}
