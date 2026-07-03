import { useState } from "react";
import { Link } from "react-router-dom";
import { Settings, Bot, Plus, ChevronDown, Copy, Check, Play } from "lucide-react";
import { Button, buttonClass, Select, Input } from "./ui";
import type { useAgent, Project } from "../hooks/useAgent";
import { getKey } from "../lib/ai-keys";
import { MODEL_OPTIONS, firstModelFor } from "../lib/models";

interface StudioToolbarProps {
  agent: ReturnType<typeof useAgent>;
  currentProject: Project | undefined;
  provider: string;
  setProvider: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  temperature: number;
  setTemperature: (v: number) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  setPickerOpen: (v: boolean) => void;
  onNewGame: () => void;
}

export function StudioToolbar({
  agent,
  currentProject,
  provider,
  setProvider,
  model,
  setModel,
  apiKey,
  setApiKey,
  temperature,
  setTemperature,
  settingsOpen,
  setSettingsOpen,
  setPickerOpen,
  onNewGame,
}: StudioToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-2 shrink-0 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={agent.isStreaming} className="max-w-[190px]" title={agent.isStreaming ? "Finish the current build to switch games" : "Switch game"}>
          {currentProject?.deployed && <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />}
          <span className="truncate">{currentProject?.name || "Select game"}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </Button>
        <Button size="sm" onClick={onNewGame} disabled={agent.isStreaming} title="Start a new game" aria-label="Start a new game">
          <Plus className="w-4 h-4" />
        </Button>
        {/* Actions for THIS game. Settings is ALWAYS available — for a live game
            it opens rename/artwork/delete; for a draft it opens the draft's
            settings (rename + discard). Play is shown only once the game is live.
            Settings targets the game id when deployed, else the session id — the
            settings page resolves either. */}
        {currentProject && (
          <>
            {currentProject.appId && (
              <a
                href={currentProject.appUrl || `https://${currentProject.appId}.freegamestore.online`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("secondary", "sm", "no-underline")}
                title="Play the live game"
                aria-label="Play the live game"
              >
                <Play className="w-4 h-4" />
              </a>
            )}
            <Link
              to={`/game/${currentProject.appId ?? currentProject.id}`}
              className={buttonClass("secondary", "sm", "no-underline border-[var(--accent)] text-[var(--accent)]")}
              title={`Settings for ${currentProject.name}`}
              aria-label={`Settings for ${currentProject.name}`}
            >
              <Settings className="w-4 h-4" />
            </Link>
          </>
        )}
        {/* Stacked + tiny so the token counts never grow the toolbar height. */}
        <span className="ml-auto hidden sm:flex flex-col items-end leading-none text-[0.62rem] text-[var(--muted)] tabular-nums">
          <span>In <strong className="text-[var(--ink)]">{agent.tokensIn.toLocaleString()}</strong></span>
          <span className="mt-0.5">Out <strong className="text-[var(--ink)]">{agent.tokensOut.toLocaleString()}</strong></span>
        </span>
        <CopyLogButton agent={agent} provider={provider} model={model} />
        <Button size="sm" onClick={() => setSettingsOpen(!settingsOpen)} title="AI model & API key">
          <Bot className="w-4 h-4" /> AI
        </Button>
      </div>
      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <Select aria-label="AI provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(firstModelFor(e.target.value)); setApiKey(""); }} className="w-auto h-9">
            <option value="github">GitHub Models</option><option value="openrouter">OpenRouter</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option>
          </Select>
          <Select aria-label="AI model" value={model} onChange={(e) => setModel(e.target.value)} className="w-auto h-9">
            {(MODEL_OPTIONS[provider] || []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          {getKey(provider)
            ? <span className="text-sm text-[var(--success)]">Key saved</span>
            : <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" aria-label="API key" className="w-48 h-9" />
          }
          <Select aria-label="Temperature" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-auto h-9">
            <option value={0}>Temp 0</option><option value={0.3}>Temp 0.3</option><option value={0.7}>Temp 0.7</option><option value={1}>Temp 1</option>
          </Select>
        </div>
      )}
    </>
  );
}

function CopyLogButton({ agent, provider, model }: { agent: ReturnType<typeof useAgent>; provider: string; model: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const json = JSON.stringify({
      project: agent.projects.find((p) => p.id === agent.currentProjectId)?.name || "unknown",
      sessionId: agent.currentProjectId,
      provider, model,
      tokens: { input: agent.tokensIn, output: agent.tokensOut },
      messages: agent.messages,
      exportedAt: new Date().toISOString(),
    }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — leave button as-is */
    }
  }

  return (
    <Button size="sm" onClick={copy} title="Copy conversation as JSON" className={copied ? "text-[var(--success)] border-[var(--success)]" : "text-[var(--muted)]"}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}
