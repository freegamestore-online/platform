import { useState } from "react";
import { Link } from "react-router-dom";
import { Settings, Bot, Plus, ChevronDown, Copy, Check, Play, ArrowLeft } from "lucide-react";
import { Button, buttonClass } from "./ui";
import type { useAgent, Project } from "../hooks/useAgent";
import type { useKeys } from "../hooks/useKeys";
import { StudioSettingsDialog } from "./StudioSettingsDialog";
import { GameVersion } from "./GameVersion";

interface StudioToolbarProps {
  agent: ReturnType<typeof useAgent>;
  currentProject: Project | undefined;
  provider: string;
  setProvider: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  temperature: number;
  setTemperature: (v: number) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  setPickerOpen: (v: boolean) => void;
  onNewGame: () => void;
  keys: ReturnType<typeof useKeys>;
}

export function StudioToolbar({
  agent,
  currentProject,
  provider,
  setProvider,
  model,
  setModel,
  temperature,
  setTemperature,
  settingsOpen,
  setSettingsOpen,
  setPickerOpen,
  onNewGame,
  keys,
}: StudioToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-2 shrink-0 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        {/* Mobile only: the global nav is hidden on small screens, so this is the
            way back to the games overview. Desktop uses the top nav bar instead. */}
        <Link
          to="/"
          className={buttonClass("secondary", "sm", "md:hidden no-underline")}
          title="My Games"
          aria-label="My Games"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={agent.isStreaming} className="max-w-[190px]" title={agent.isStreaming ? "Finish the current build to switch games" : "Switch game"}>
          {currentProject?.deployed && <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />}
          <span className="truncate">{currentProject?.name || "Select game"}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </Button>
        {/* Desktop only — on mobile the toolbar is tight, and a new game can be
            started from the game list ("My Games") or the picker's "New" tab. */}
        <span className="hidden sm:inline-flex">
          <Button size="sm" onClick={onNewGame} disabled={agent.isStreaming} title="Start a new game" aria-label="Start a new game">
            <Plus className="w-4 h-4" />
          </Button>
        </span>
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
        {/* Deployed version + "deployed X ago" (hover for the exact timestamp),
            read from the live game's version.json. Keyed on the deploy phase so a
            fresh deploy re-fetches the new stamp instead of showing the old one.
            Desktop-only to keep the mobile toolbar tight. */}
        {currentProject?.appId && (
          <span className="hidden md:inline-flex items-center text-[0.62rem] text-[var(--muted)] tabular-nums">
            <GameVersion
              key={agent.deployState?.phase === "live" ? "live" : currentProject.appId}
              liveUrl={currentProject.appUrl || `https://${currentProject.appId}.freegamestore.online`}
            />
          </span>
        )}
        {/* Stacked + tiny so the token counts never grow the toolbar height. */}
        <span className="ml-auto hidden sm:flex flex-col items-end leading-none text-[0.62rem] text-[var(--muted)] tabular-nums">
          <span>In <strong className="text-[var(--ink)]">{agent.tokensIn.toLocaleString()}</strong></span>
          <span className="mt-0.5">Out <strong className="text-[var(--ink)]">{agent.tokensOut.toLocaleString()}</strong></span>
        </span>
        {/* Debug/export affordance — desktop only; hidden on mobile to keep the
            single studio bar from overflowing. */}
        <span className="hidden sm:inline-flex">
          <CopyLogButton agent={agent} provider={provider} model={model} />
        </span>
        <Button size="sm" onClick={() => setSettingsOpen(!settingsOpen)} title="AI model & API key" aria-label="AI settings">
          <Bot className="w-4 h-4" />
        </Button>
      </div>
      <StudioSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        provider={provider}
        setProvider={setProvider}
        model={model}
        setModel={setModel}
        temperature={temperature}
        setTemperature={setTemperature}
        keys={keys}
      />
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
    <Button size="sm" onClick={copy} title="Copy conversation as JSON" aria-label="Copy conversation as JSON" className={copied ? "text-[var(--success)] border-[var(--success)]" : "text-[var(--muted)]"}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}
