import { ArrowUp, Edit2, ExternalLink, Plus, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChatMessage } from '../components/ChatMessage';
import { DeployErrorNotice } from '../components/DeployErrorNotice';
import { DeployLog } from '../components/DeployLog';
import { GameVersion } from '../components/GameVersion';
import { Nav } from '../components/Nav';
import { NewGameModal } from '../components/NewGameModal';
import { ErrorShell } from '../components/PageShell';
import { ProjectPicker } from '../components/ProjectPicker';
import { StatusBar } from '../components/StatusBar';
import { StudioToolbar } from '../components/StudioToolbar';
import { Button, buttonClass } from '../components/ui';
import { type AIConfig, useAgent } from '../hooks/useAgent';
import { useAuth } from '../hooks/useAuth';
import { UUID_RE, useCreateRouteSync } from '../hooks/useCreateRouteSync';
import { useKeys } from '../hooks/useKeys';
import { useLegacyDeepLinkMigration } from '../hooks/useLegacyDeepLinkMigration';
import { useMessageQueue } from '../hooks/useMessageQueue';
import { useStudioViewportLock } from '../hooks/useStudioViewportLock';
import { resolveInitialProvider } from '../lib/ai-keys';
import { RETRY_DEPLOY_PROMPT } from '../lib/deployError';
import {
  clearInitialBuild,
  type InitialBuild,
  isInitialBuildComplete,
  readInitialBuild,
} from '../lib/initialBuild';
import { getKidMode } from '../lib/kidMode';
import { resolveModel } from '../lib/models';
import { resolveProvider } from '../lib/providerResolution';

export function Create() {
  const { user, loading, signIn, agentError, retryAgentSession } = useAuth();
  const agent = useAgent();
  const keys = useKeys();
  const messageQueue = useMessageQueue();
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueContent, setEditingQueueContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start on the user's stored provider choice, else free GitHub Models. Whether
  // that provider has a *key* is answered by the vault (keys.providerUsable),
  // since key state is now server-side/async — not a localStorage lookup.
  const [provider, setProvider] = useState(resolveInitialProvider);
  const [model, setModel] = useState(() =>
    resolveModel(resolveInitialProvider(), localStorage.getItem('fgs_model')),
  );
  const [temperature, setTemperature] = useState(0.7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Kid mode preference (Profile → Kid mode). Read on mount; changing it in the
  // Profile route remounts Create, so a fresh value is picked up on return.
  const [kidMode] = useState(getKidMode);
  const autoInitialPromptRef = useRef<string | null>(null);
  const [initialBuild, setInitialBuild] = useState<InitialBuild | null>(null);
  const [providerResolved, setProviderResolved] = useState(false);
  const keySignature = [...keys.providers].sort().join('|');
  const { id: urlKey } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const legacyGameParam = searchParams.get('game');
  const legacySessionParam = searchParams.get('session');
  const hasLegacyDeepLink = !!legacyGameParam || !!legacySessionParam;
  useLegacyDeepLinkMigration({
    params: searchParams,
    ready: !loading && !!user && !agent.projectsLoading,
    isStreaming: agent.isStreaming,
    openGame: agent.openGame,
    startFreshChat: agent.startFreshChat,
    switchProject: agent.switchProject,
    clear: () => setSearchParams({}, { replace: true }),
  });
  const { currentProject, navigateToProject, resolvingUrl } = useCreateRouteSync({
    urlKey,
    ready: !loading && !!user,
    isStreaming: agent.isStreaming,
    projectsLoading: agent.projectsLoading,
    projects: agent.projects,
    currentProjectId: agent.currentProjectId,
    hasLegacyDeepLink,
    openGame: agent.openGame,
    switchProject: agent.switchProject,
    navigate,
  });

  // Restore the open session's transcript, deploy state and token totals from
  // the agent whenever the open project changes (open from My Games / picker /
  // URL, or a reload). a2bc968 dropped this effect when route handling moved
  // into hooks, so every opened game showed an empty chat (#75). Waits until the
  // URL has resolved to the routed project, so a stale project's history is
  // never loaded into the view; loadHistory itself skips while streaming.
  useEffect(() => {
    if (!agent.currentProjectId || agent.projectsLoading || resolvingUrl) return;
    if (hasLegacyDeepLink) return; // the migration switches projects first
    if (urlKey) {
      const routedSessionOpen = UUID_RE.test(urlKey) && agent.currentProjectId === urlKey;
      const routedGameOpen = currentProject?.appId === urlKey || currentProject?.id === urlKey;
      if (!routedSessionOpen && !routedGameOpen) return;
    }
    void agent.loadHistory();
  }, [
    agent.currentProjectId,
    agent.projectsLoading,
    agent.loadHistory,
    resolvingUrl,
    hasLegacyDeepLink,
    urlKey,
    currentProject?.appId,
    currentProject?.id,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when messages change; re-running when isStreaming flips would jump a reader who has scrolled up.
  useEffect(() => {
    // While a build is streaming, only stick to the bottom when the user is
    // already near it — don't yank them back down after they've scrolled up to
    // read history. Otherwise (first load, game switch, a finished turn) always
    // land at the newest message, even on a long transcript. Gating on
    // isStreaming — not a consumable flag — is what makes the load-time jump
    // survive the intermediate default-message render before history arrives.
    const c = scrollRef.current;
    if (agent.isStreaming && c && c.scrollHeight - c.scrollTop - c.clientHeight > 120) return;
    const behavior = agent.messages.length <= 1 ? 'instant' : 'smooth';
    // Cleared on the next message so a streaming build (a delta per token)
    // doesn't stack dozens of pending timers.
    const t = setTimeout(
      () => messagesEndRef.current?.scrollIntoView({ behavior: behavior as ScrollBehavior }),
      50,
    );
    return () => clearTimeout(t);
  }, [agent.messages]);
  useEffect(() => {
    localStorage.setItem('fgs_provider', provider);
  }, [provider]);
  useEffect(() => {
    localStorage.setItem('fgs_model', model);
  }, [model]);

  useEffect(() => {
    setInitialBuild(readInitialBuild(currentProject?.appId));
  }, [currentProject?.appId]);

  const autoPickedRef = useRef(false);
  const lastKeySignatureRef = useRef('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: user.sub is the trigger — reset provider auto-pick when the account changes.
  useEffect(() => {
    autoPickedRef.current = false;
    lastKeySignatureRef.current = '';
    setProviderResolved(false);
  }, [user?.sub]);

  // Once the vault's key state loads, use whatever provider the user actually
  // has a key for. If no paid provider is usable, fall back to the free GitHub
  // Models tier so a first build is not blocked by a stale paid preference.
  // biome-ignore lint/correctness/useExhaustiveDependencies: user.sub re-runs provider resolution for a newly signed-in account.
  useEffect(() => {
    if (keys.loading) {
      setProviderResolved(false);
      return;
    }
    if (lastKeySignatureRef.current !== keySignature) {
      autoPickedRef.current = false;
      lastKeySignatureRef.current = keySignature;
    }
    if (autoPickedRef.current) {
      setProviderResolved(true);
      return;
    }
    autoPickedRef.current = true;
    const resolution = resolveProvider({
      provider,
      hasKey: keys.hasKey,
      providerUsable: keys.providerUsable,
    });
    if (resolution) {
      setProvider(resolution.provider);
      setModel(resolution.model);
    }
    setProviderResolved(true);
  }, [keys.loading, keys.hasKey, keys.providerUsable, keySignature, provider, user?.sub]);

  const sendPrompt = useCallback(
    async (msg: string) => {
      if (!msg || agent.isStreaming) return;
      if (!keys.providerUsable(provider)) {
        // No key saved for this (non-free) provider. Open the settings dialog to
        // add one rather than firing a dismissable alert — the banner explains why.
        setSettingsOpen(true);
        return;
      }
      // The API key is NOT sent from the browser — the agent resolves it from the
      // encrypted vault server-side using the signed-in identity.
      await agent.sendMessage(msg, { provider, model, temperature, maxTokens: 16384 } as AIConfig);
    },
    [agent.isStreaming, agent.sendMessage, keys.providerUsable, provider, model, temperature],
  );

  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg) return;

    if (agent.isStreaming) {
      // Queue the message instead of sending while agent is working
      messageQueue.add(msg);
      setInputValue('');
      return;
    }

    if (!keys.providerUsable(provider)) {
      await sendPrompt(msg);
      return;
    }
    setInputValue('');
    await sendPrompt(msg);
  }, [inputValue, agent.isStreaming, keys.providerUsable, provider, sendPrompt, messageQueue]);

  useEffect(() => {
    const gameId = currentProject?.appId;
    if (!gameId || !initialBuild) return;

    const hasUserMessage = agent.messages.some((m) => m.role === 'user');
    if (isInitialBuildComplete(agent.deployState?.phase, hasUserMessage)) {
      clearInitialBuild(gameId);
      setInitialBuild(null);
      return;
    }

    const key = `${gameId}:${initialBuild.createdAt}`;
    if (
      autoInitialPromptRef.current === key ||
      // Never decide before this session's transcript is known: on a reload or
      // revisit the user message is only visible once history has loaded, and
      // sending before that re-ran the whole first build (#76).
      !agent.historyLoaded ||
      agent.isStreaming ||
      loading ||
      !user ||
      agent.projectsLoading ||
      !providerResolved
    )
      return;
    if (hasUserMessage) {
      clearInitialBuild(gameId);
      setInitialBuild(null);
      return;
    }
    if (keys.loading) return;
    if (!keys.providerUsable(provider)) {
      setInputValue(initialBuild.prompt);
      setSettingsOpen(true);
      return;
    }

    autoInitialPromptRef.current = key;
    setInputValue('');
    void sendPrompt(initialBuild.prompt);
    // Sent: from here the agent's transcript is the record, so drop the queued
    // prompt now rather than only when a live/error phase is seen in this same
    // page session — otherwise a reload mid-build re-sent it (#76). The
    // in-memory `initialBuild` is kept so this session's first-build UI (status,
    // template-preview suppression, deploy nudge) still works; the ref above
    // stops a second send in this session.
    clearInitialBuild(gameId);
  }, [
    currentProject?.appId,
    initialBuild,
    agent.deployState?.phase,
    agent.isStreaming,
    agent.historyLoaded,
    agent.messages,
    agent.projectsLoading,
    loading,
    user,
    keys.loading,
    keys.providerUsable,
    providerResolved,
    provider,
    sendPrompt,
  ]);

  // Auto-send queued messages when the agent finishes streaming
  useEffect(() => {
    if (agent.isStreaming || messageQueue.isEmpty) return;
    const next = messageQueue.getFirst();
    if (!next) return;

    messageQueue.removeFirst();
    setInputValue(next.content);
    // Trigger the send on next render
    setTimeout(() => {
      setInputValue((current) => {
        void sendPrompt(current.trim());
        setInputValue('');
        return '';
      });
    }, 0);
  }, [agent.isStreaming, messageQueue, sendPrompt]);

  useStudioViewportLock();

  if (loading) {
    return (
      <>
        <Nav />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 rounded-full border-[3px] border-accent/30 border-t-accent animate-spin [animation-duration:0.6s]" />
        </div>
      </>
    );
  }

  // Preview URL: the deployed game's own URL. FGS games are Path B — they serve
  // from R2 at https://<id>.freegamestore.online (NOT pages.dev). Prefer the
  // persisted project URL; during a live deploy fall back to the deploy status's
  // appUrl so the preview appears before markDeployed persists.
  const previewUrl =
    currentProject?.appUrl || agent.deployState?.appUrl || agent.deployState?.deployUrl || null;
  const hasBuilt = agent.messages.some((m) => m.role === 'tool');
  const initialBuildTerminal = isInitialBuildComplete(
    agent.deployState?.phase,
    agent.messages.some((m) => m.role === 'user'),
  );
  const initialBuildQueued = !!initialBuild && !initialBuildTerminal;
  const initialBuildPromptSent =
    initialBuildQueued && agent.messages.some((m) => m.role === 'user');
  const initialBuildInProgress =
    initialBuildQueued && (!!agent.deployState || agent.isStreaming || !initialBuildPromptSent);
  const showPreview =
    !!previewUrl &&
    (agent.deployState?.phase === 'live' ||
      (!agent.deployState && currentProject?.deployed && !initialBuildQueued));
  const versionUrl = showPreview ? previewUrl : null;
  const previewStatusState =
    agent.deployState ??
    (initialBuildInProgress
      ? {
          phase: agent.isStreaming ? 'pushing' : 'provisioning',
          appUrl: previewUrl ?? undefined,
          hint: agent.isStreaming
            ? 'The AI is building the first playable version. The preview appears after it deploys.'
            : 'Opening the new game and starting the first build. The preview appears after deploy.',
        }
      : null);
  const firstBuildNeedsDeploy =
    initialBuildQueued && !initialBuildInProgress && initialBuildPromptSent && hasBuilt;
  // Only offer "Deploy now" once the AI has actually built something (wrote files
  // via a tool call). A bare user message + an error (e.g. no key) must NOT show
  // a deploy prompt — there's nothing to deploy yet.
  // Bring-your-own-key: nag only when the current provider is unusable — no key
  // saved and not the free tier (GitHub Models, which runs on the platform token).
  // Default is Claude; the auto-pick effect moves to whatever provider the user
  // has a key for, so this rarely fires for someone who's added a key.
  const needsKey = !keys.loading && !keys.providerUsable(provider);
  // A failed deploy gets its own full surface (DeployErrorNotice) in the chat
  // column. The game is provisioned before the session exists, so appId is set
  // even when the FIRST build fails — which is exactly when retry matters most.
  const deployFailed = agent.deployState?.phase === 'error';
  const canRetryDeploy = deployFailed && !agent.isStreaming && !!currentProject?.appId;

  // The Studio is the one surface that needs the agent session: show the
  // handoff failure here, with a retry, rather than failing every agent call.
  if (user && agentError) {
    return <ErrorShell message={agentError} onRetry={() => void retryAgentSession()} />;
  }

  if (!user) {
    return (
      <>
        <Nav />
        <main className="flex flex-col items-center justify-center text-center min-h-[60vh] py-16 px-6 max-w-[640px] mx-auto">
          <h1 className="text-4xl font-extrabold tracking-tight mb-3 font-display">Studio</h1>
          <p className="text-lg mb-8 text-muted max-w-[480px]">
            Describe the game you want. An AI agent builds it, deploys it, and you get a live game
            on FreeGameStore — in minutes.
          </p>
          <button
            onClick={signIn}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold bg-accent text-black border-0 cursor-pointer font-[inherit] text-base min-h-11"
          >
            Sign in with GitHub to start
          </button>
          <p className="text-sm mt-3 text-muted">
            Free to use. Bring your own API key (OpenRouter, Anthropic, OpenAI, Google, or GitHub
            Models).
          </p>
        </main>
      </>
    );
  }

  // No session open (fresh account, or every session was deleted). Show a clear
  // start point instead of a bare, broken-looking chat — the phantom "New Game"
  // auto-create used to hide this and spawn unbound blank sessions.
  if (!agent.currentProjectId) {
    return (
      <div className="flex flex-col h-dvh overflow-hidden">
        <Nav />
        <main className="flex flex-col items-center justify-center text-center flex-1 py-8 px-6">
          <h1 className="text-3xl font-extrabold tracking-tight mb-3 font-display">Studio</h1>
          <p className="text-base mb-6 text-muted max-w-[420px]">
            Start a new game and describe it to the AI, or open one of your games to keep editing
            it.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4" /> New Game
            </Button>
            <a href="/" className={buttonClass('secondary', 'md', 'no-underline')}>
              My Games
            </a>
          </div>
        </main>
        <NewGameModal open={newOpen} onClose={() => setNewOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      {/* Desktop keeps the global nav on top of the studio toolbar. On mobile the
          two collapse into one: the nav is hidden and StudioToolbar carries a
          back-to-My-Games button (like the FAS studio bar). */}
      <div className="hidden md:block">
        <Nav />
      </div>
      {/* grid-rows-[minmax(0,1fr)] bounds the single row to the container height
          (an `auto` row would size to content and let the chat push past the
          viewport). Each column then owns its own overflow. */}
      <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2 grid-rows-[minmax(0,1fr)]">
        {/* Chat — min-h-0 so it can shrink to the row height and its inner
            overflow-y-auto region becomes the only scroll surface. */}
        <div className="flex flex-col overflow-hidden border-r border-line min-h-0">
          <StudioToolbar
            agent={agent}
            currentProject={currentProject}
            switching={resolvingUrl}
            provider={provider}
            setProvider={setProvider}
            model={model}
            setModel={setModel}
            temperature={temperature}
            setTemperature={setTemperature}
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            setPickerOpen={setPickerOpen}
            keys={keys}
          />
          <StatusBar
            isStreaming={agent.isStreaming}
            deployState={agent.deployState}
            messages={agent.messages}
          />
          {needsKey && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 text-sm bg-warning/12 border-b border-warning text-warning">
              <span className="flex-1">
                Add an API key to start building — sends are blocked until then.
              </span>
              <button
                onClick={() => setSettingsOpen(true)}
                className="shrink-0 inline-flex items-center rounded-md px-3 h-9 text-sm font-semibold bg-warning text-black border-0 cursor-pointer"
              >
                Add key
              </button>
            </div>
          )}
          {deployFailed && agent.deployState && (
            <DeployErrorNotice
              state={agent.deployState}
              appId={currentProject?.appId}
              canRetry={canRetryDeploy}
              onRetry={() => sendPrompt(RETRY_DEPLOY_PROMPT)}
            />
          )}
          {/* Suppressed on a deploy failure: agent.error holds the SAME string
              the notice above already shows in full, and stacking both (plus
              DeployLog on desktop) reported one failure three times. */}
          {agent.error && !deployFailed && (
            <div
              role="alert"
              className="shrink-0 flex items-start gap-2 px-3 py-2 text-sm bg-danger/12 border-b border-danger text-danger"
            >
              <span className="flex-1 whitespace-pre-wrap [word-break:break-word]">
                {agent.error}
              </span>
              <button
                onClick={agent.dismissError}
                aria-label="Dismiss error"
                className="shrink-0 p-0.5 rounded hover:bg-black/10 bg-transparent border-0 text-inherit cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
            <div className="flex-1" />
            {agent.messages.length > agent.visibleCount && (
              <button
                onClick={agent.showEarlier}
                className="self-center inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-4 py-1.5 mb-1 hover:bg-paper bg-panel text-muted border border-line cursor-pointer"
              >
                <ArrowUp className="w-4 h-4" /> Load earlier messages (
                {agent.messages.length - agent.visibleCount} older)
              </button>
            )}
            {(() => {
              const start = Math.max(0, agent.messages.length - agent.visibleCount);
              const lastIdx = agent.messages.length - 1;
              return agent.messages.slice(start).map((m, i) => {
                const idx = start + i;
                const live = agent.isStreaming && idx === lastIdx && m.role === 'assistant';
                return (
                  <ChatMessage
                    key={idx}
                    role={m.role}
                    content={m.content}
                    kid={kidMode}
                    live={live}
                  />
                );
              });
            })()}
            <div ref={messagesEndRef} />
          </div>
          {/* Message Queue Display */}
          {messageQueue.size > 0 && (
            <div className="py-2 px-3 border-t border-line bg-accent/5 text-[0.85rem]">
              <div className="text-muted mb-2">Queued ({messageQueue.size}):</div>
              <div className="flex flex-col gap-2">
                {messageQueue.queue.map((msg, _idx) => (
                  <div
                    key={msg.id}
                    className="flex gap-2 items-center p-2 bg-panel border border-line rounded-lg"
                  >
                    <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {msg.content}
                    </div>
                    <button
                      onClick={() => {
                        setEditingQueueId(msg.id);
                        setEditingQueueContent(msg.content);
                      }}
                      className="bg-transparent border-0 cursor-pointer p-1 text-muted shrink-0"
                      title="Edit queued message"
                      aria-label="Edit queued message"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => messageQueue.remove(msg.id)}
                      className="bg-transparent border-0 cursor-pointer p-1 text-muted shrink-0"
                      title="Remove from queue"
                      aria-label="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 shrink-0 py-2 px-3 border-t border-line bg-panel">
            {editingQueueId ? (
              <>
                <textarea
                  value={editingQueueContent}
                  onChange={(e) => setEditingQueueContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingQueueId(null);
                      setEditingQueueContent('');
                    }
                  }}
                  placeholder="Edit your message..."
                  aria-label="Edit queued message"
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-line bg-paper text-ink text-sm px-3 py-2.5 min-h-11 max-h-[100px] font-[Manrope,system-ui,sans-serif] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent"
                />
                <Button
                  variant="primary"
                  onClick={() => {
                    messageQueue.update(editingQueueId, editingQueueContent.trim());
                    setEditingQueueId(null);
                    setEditingQueueContent('');
                  }}
                  className="self-end w-11 px-0"
                  title="Save edit"
                  aria-label="Save edit"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Build me a space invaders game..."
                  aria-label="Describe your game"
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-line bg-paper text-ink text-sm px-3 py-2.5 min-h-11 max-h-[100px] font-[Manrope,system-ui,sans-serif] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent"
                />
                <Button
                  variant="primary"
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="self-end w-11 px-0"
                  title="Send"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
        {/* Preview */}
        <div className="hidden md:flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 shrink-0 py-2 px-3 border-b border-line bg-panel text-[0.85rem]">
            {previewUrl ? (
              <>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-xs truncate min-w-0 flex-1 text-accent font-[monospace]"
                >
                  {previewUrl.replace('https://', '')}
                </a>
                {versionUrl && (
                  <span className="hidden lg:inline-flex items-center shrink-0 text-[0.62rem] text-muted tabular-nums">
                    <GameVersion
                      key={agent.deployState?.phase === 'live' ? 'live' : versionUrl}
                      liveUrl={versionUrl}
                    />
                  </span>
                )}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener"
                  aria-label="Open in new tab"
                  title="Open in new tab"
                  className="shrink-0 inline-flex items-center justify-center text-accent w-7 h-7"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </>
            ) : (
              <span className="text-xs text-muted">Preview</span>
            )}
          </div>
          <div
            className={`flex-1 flex items-center justify-center min-h-0 overflow-hidden ${showPreview ? 'bg-black' : 'bg-paper'}`}
          >
            {showPreview ? (
              <iframe
                src={previewUrl}
                title="Preview"
                className="w-full h-full border-0 bg-black"
              />
            ) : previewStatusState ? (
              <DeployLog state={previewStatusState} appId={currentProject?.appId} />
            ) : (
              <div className="text-center p-8 flex flex-col items-center gap-3 max-w-sm text-muted">
                {hasBuilt || firstBuildNeedsDeploy ? (
                  <>
                    <p className="text-sm">
                      This game <strong>hasn't been deployed yet</strong> — that's why there's no
                      preview. The AI builds in-session; it only goes live once it deploys.
                    </p>
                    <Button
                      variant="primary"
                      onClick={() =>
                        sendPrompt('Deploy the game now so I can see the live preview.')
                      }
                      disabled={agent.isStreaming}
                    >
                      <Send className="w-4 h-4" /> Deploy now
                    </Button>
                    <p className="text-xs">
                      …or just type <span className="font-mono">deploy</span> in the chat.
                    </p>
                  </>
                ) : (
                  <p className="text-sm">
                    Describe your game in the chat to start building — a preview appears here once
                    the AI has built and deployed it.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {pickerOpen && (
        <ProjectPicker
          projects={agent.projects}
          currentId={agent.currentProjectId}
          loadError={agent.projectsError}
          onRetry={agent.reloadProjects}
          onSelect={(id) => {
            // URL ONLY. The routing effect opens it — the same path a My Games
            // link or the back button takes. Calling switchProject here too was
            // the dual-write that caused #3/#4/#5/#6 (see the routing effect).
            if (agent.isStreaming) return;
            const project = agent.projects.find((p) => p.id === id);
            navigateToProject(project ?? { id });
          }}
          // Unified: "new" from the picker opens the one template picker, not a
          // blank canvas session.
          onCreate={() => {
            setPickerOpen(false);
            setNewOpen(true);
          }}
          onDelete={(id) => {
            const deletingCurrent = id === agent.currentProjectId;
            const next = agent.projects.find((p) => p.id !== id) ?? null;
            // deleteProject already promotes the survivor to current (and clears
            // the deleted chat from view), so this is a self-write catching the
            // URL up — not a request to open it. Nothing to catch up if the
            // delete was refused (the open session is mid-stream).
            if (!agent.deleteProject(id)) return;
            if (deletingCurrent) navigateToProject(next, { replace: true, alreadyOpen: true });
          }}
          onFreshChat={(appId) => {
            if (agent.isStreaming) return;
            setPickerOpen(false);
            void agent.startFreshChat(appId).then((id) => {
              // startFreshChat already made the new session current — self-write,
              // so the routing effect must not re-import over it.
              if (id) navigateToProject({ id, appId }, { alreadyOpen: true });
            });
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <NewGameModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
