import { useState } from "react";
import { PROVIDERS, getSavedKeys, saveKey, type ProviderConfig } from "../lib/ai-keys";
import { Button, Badge, Input } from "./ui";

/** Reusable AI provider settings panel.
 *  Shows all providers with API key inputs.
 *  Keys are saved to localStorage — never sent to our servers. */
export function AISettings() {
  const [keys, setKeys] = useState<Record<string, string>>(() => getSavedKeys());
  const [editing, setEditing] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  function startEdit(provider: string) {
    setEditing(provider);
    setInputValue(keys[provider] || "");
  }

  function handleSave(provider: string) {
    saveKey(provider, inputValue.trim());
    setKeys(getSavedKeys());
    setEditing(null);
    setInputValue("");
  }

  function handleRemove(provider: string) {
    saveKey(provider, "");
    setKeys(getSavedKeys());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">AI Providers</h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Keys stored locally — never sent to our servers</p>
      </div>

      {PROVIDERS.map((p) => (
        <ProviderRow
          key={p.type}
          provider={p}
          savedKey={keys[p.type] || ""}
          isEditing={editing === p.type}
          inputValue={inputValue}
          onStartEdit={() => startEdit(p.type)}
          onInputChange={setInputValue}
          onSave={() => handleSave(p.type)}
          onRemove={() => handleRemove(p.type)}
          onCancel={() => setEditing(null)}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  provider: p, savedKey, isEditing, inputValue,
  onStartEdit, onInputChange, onSave, onRemove, onCancel,
}: {
  provider: ProviderConfig;
  savedKey: string;
  isEditing: boolean;
  inputValue: string;
  onStartEdit: () => void;
  onInputChange: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const hasKey = !!savedKey;
  const maskedKey = savedKey
    ? savedKey.length > 12 ? `${savedKey.slice(0, 8)}...${savedKey.slice(-4)}` : "••••••••"
    : "";

  return (
    <div className="p-4 rounded-xl border" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <strong className="text-sm">{p.name}</strong>
            {p.free && <Badge tone="success">Free</Badge>}
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

        {!p.free && (
          <div className="shrink-0">
            {hasKey && !isEditing ? (
              <div className="flex items-center gap-2">
                <code className="text-xs" style={{ color: "var(--muted)" }}>{maskedKey}</code>
                <Button variant="ghost" size="sm" onClick={onStartEdit}>Edit</Button>
                <Button variant="danger-outline" size="sm" onClick={onRemove}>Remove</Button>
              </div>
            ) : !isEditing ? (
              <Button variant="primary" size="sm" onClick={onStartEdit}>
                Add Key
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
          <Button variant="primary" size="sm" onClick={onSave}>Save</Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      )}

      {!p.free && (
        <a href={p.docsUrl} target="_blank" rel="noopener" className="text-xs mt-2 inline-block" style={{ color: "var(--accent)" }}>
          Get API key →
        </a>
      )}
    </div>
  );
}
