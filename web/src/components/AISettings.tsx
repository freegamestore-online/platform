import { useState } from "react";
import { PROVIDERS, type ProviderConfig } from "../lib/ai-keys";
import { useKeys } from "../hooks/useKeys";
import { Button, Badge, Input } from "./ui";

/** AI provider settings. Keys are stored in the platform's ENCRYPTED vault
 *  (server-side, AES-256-GCM) — never in the browser, and never shown back after
 *  saving (the vault returns only "connected" status). */
export function AISettings() {
  const keys = useKeys();
  const [editing, setEditing] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(provider: string) {
    const v = inputValue.trim();
    if (!v) return;
    setBusy(provider);
    setError(null);
    const ok = await keys.saveKey(provider, v);
    setBusy(null);
    if (ok) { setEditing(null); setInputValue(""); }
    else setError("Couldn't save the key — try again.");
  }

  async function handleRemove(provider: string) {
    setBusy(provider);
    setError(null);
    const ok = await keys.removeKey(provider);
    setBusy(null);
    if (!ok) setError("Couldn't remove the key — try again.");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">AI Providers</h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Stored encrypted on the platform — never in your browser</p>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--error)" }}>{error}</p>}

      {PROVIDERS.map((p) => (
        <ProviderRow
          key={p.type}
          provider={p}
          hasKey={keys.hasKey(p.type)}
          busy={busy === p.type}
          isEditing={editing === p.type}
          inputValue={inputValue}
          onStartEdit={() => { setEditing(p.type); setInputValue(""); }}
          onInputChange={setInputValue}
          onSave={() => handleSave(p.type)}
          onRemove={() => handleRemove(p.type)}
          onCancel={() => { setEditing(null); setInputValue(""); }}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  provider: p, hasKey, busy, isEditing, inputValue,
  onStartEdit, onInputChange, onSave, onRemove, onCancel,
}: {
  provider: ProviderConfig;
  hasKey: boolean;
  busy: boolean;
  isEditing: boolean;
  inputValue: string;
  onStartEdit: () => void;
  onInputChange: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-4 rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <strong className="text-sm">{p.name}</strong>
            {p.free && <Badge tone="success">Free</Badge>}
            {hasKey && p.optionalKey && <Badge tone="accent">Your quota</Badge>}
            {hasKey && !p.free && <Badge tone="accent">Connected</Badge>}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{p.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {p.models.slice(0, 4).map((m) => (
              <span key={m.id} className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--paper)", border: "1px solid var(--line)", color: "var(--muted)" }}>
                {m.name}
              </span>
            ))}
            {p.models.length > 4 && <span className="text-xs py-0.5" style={{ color: "var(--muted)" }}>+{p.models.length - 4} more</span>}
          </div>
        </div>

        {(!p.free || p.optionalKey) && (
          <div className="shrink-0">
            {hasKey && !isEditing ? (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--muted)" }}>••• saved</span>
                <Button variant="ghost" size="sm" onClick={onStartEdit} disabled={busy}>Replace</Button>
                <Button variant="danger-outline" size="sm" onClick={onRemove} disabled={busy}>{busy ? "…" : "Remove"}</Button>
              </div>
            ) : !isEditing ? (
              <Button variant={p.optionalKey ? "secondary" : "primary"} size="sm" onClick={onStartEdit} disabled={busy}>
                {p.optionalKey ? "Use your token" : "Add Key"}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {isEditing && (
        <div className="flex gap-2 mt-3">
          <Input
            type="password"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={p.keyPlaceholder}
            aria-label={`API key for ${p.name}`}
            className="flex-1 font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          />
          <Button variant="primary" size="sm" onClick={onSave} disabled={busy || !inputValue.trim()}>{busy ? "Saving…" : "Save"}</Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
