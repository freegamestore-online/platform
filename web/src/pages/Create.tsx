import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUp, Plus, Send, X } from "lucide-react";
import { Button, buttonClass } from "../components/ui";
import { Nav } from "../components/Nav";
import { ChatMessage } from "../components/ChatMessage";
import { DeployLog } from "../components/DeployLog";
import { ProjectPicker } from "../components/ProjectPicker";
import { StudioToolbar } from "../components/StudioToolbar";
import { StatusBar } from "../components/StatusBar";
import { NewGameModal } from "../components/NewGameModal";
import { useAuth } from "../hooks/useAuth";
import { useAgent, type AIConfig } from "../hooks/useAgent";
import { useKeys } from "../hooks/useKeys";
import { resolveInitialProvider, PROVIDERS } from "../lib/ai-keys";
import { resolveModel, firstModelFor } from "../lib/models";

export function Create() {
  const { user, loading, signIn } = useAuth();
  const agent = useAgent();
  const keys = useKeys();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start on the user's stored provider choice, else free GitHub Models. Whether
  // that provider has a *key* is answered by the vault (keys.providerUsable),
  // since key state is now server-side/async — not a localStorage lookup.
  const [provider, setProvider] = useState(resolveInitialProvider);
  const [model, setModel] = useState(() => resolveModel(resolveInitialProvider(), localStorage.getItem("fgs_model")));
  const [temperature, setTemperature] = useState(0.7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const openedGameRef = useRef<string | null>(null);
  const openedSessionRef = useRef<string | null>(null);

  // Deep-link: /create?game=<id> opens an existing game in the studio. Wait for
  // the session list to load first (so an already-open game switches instead of
  // importing a duplicate), open once, then drop the param so a reload / new
  // message doesn't re-import.
  useEffect(() => {
    const gameId = searchParams.get("game");
    if (!gameId || agent.projectsLoading || openedGameRef.current === gameId) return;
    openedGameRef.current = gameId;
    void agent.openGame(gameId).finally(() => {
      setSearchParams({}, { replace: true });
    });
  }, [searchParams, agent.projectsLoading, agent.openGame, setSearchParams]);

  // Deep-link: /create?session=<id> resumes an in-progress draft session (opened
  // from the dashboard's Drafts list). Unlike ?game=, a draft has no live repo to
  // import — its transcript already lives in the DO keyed by this id, so we just
  // switch to it and loadHistory() fills in the messages.
  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (!sessionId || agent.projectsLoading || openedSessionRef.current === sessionId) return;
    openedSessionRef.current = sessionId;
    agent.switchProject(sessionId);
    setSearchParams({}, { replace: true });
  }, [searchParams, agent.projectsLoading, agent.switchProject, setSearchParams]);

  // Force a jump to the newest message on first load and on every game switch,
  // even when the transcript is long — otherwise the "near bottom?" guard below
  // sees scrollTop=0 on a tall history and leaves you stranded at the top.
  const forceScrollRef = useRef(true);
  useEffect(() => { forceScrollRef.current = true; agent.loadHistory(); }, [agent.currentProjectId]);
  useEffect(() => {
    // On load/switch always land at the bottom. During a streaming build, only
    // stick to the bottom when the user is already near it — don't yank them
    // back down while they've scrolled up to read history.
    const force = forceScrollRef.current;
    const c = scrollRef.current;
    if (!force && c && c.scrollHeight - c.scrollTop - c.clientHeight > 120) return;
    const behavior = force || agent.messages.length <= 1 ? "instant" : "smooth";
    forceScrollRef.current = false;
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: behavior as ScrollBehavior }), 50);
  }, [agent.messages]);
  useEffect(() => { localStorage.setItem("fgs_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("fgs_model", model); }, [model]);

  // Once the vault's key state loads, use whatever provider the user actually
  // has a key for — don't sit on a keyless default and fail mid-build. Runs once
  // (keys.loading → false); if the current provider already has a key, keep it.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (keys.loading || autoPickedRef.current) return;
    autoPickedRef.current = true;
    if (keys.hasKey(provider)) return;
    const keyed = PROVIDERS.find((p) => keys.hasKey(p.type));
    if (keyed) {
      setProvider(keyed.type);
      setModel(firstModelFor(keyed.type));
    }
  }, [keys.loading, keys.hasKey, provider]);

  if (loading) {
    return (
      <>
        <Nav />
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div style={{ width: 32, height: 32, border: "3px solid rgba(16,185,129,0.3)", borderTopColor: "#10b981", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  const sendPrompt = async (msg: string) => {
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
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || agent.isStreaming) return;
    setInputValue("");
    await sendPrompt(msg);
  };

  // Preview URL: the deployed game's own URL. FGS games are Path B — they serve
  // from R2 at https://<id>.freegamestore.online (NOT pages.dev). Prefer the
  // persisted project URL; during a live deploy fall back to the deploy status's
  // appUrl so the preview appears before markDeployed persists.
  const currentProject = agent.projects.find((p) => p.id === agent.currentProjectId);
  const previewUrl = currentProject?.appUrl || agent.deployState?.appUrl || null;
  const showPreview = previewUrl && (agent.deployState?.phase === "live" || agent.deployState?.phase === "building" || currentProject?.deployed);
  // Only offer "Deploy now" once the AI has actually built something (wrote files
  // via a tool call). A bare user message + an error (e.g. no key) must NOT show
  // a deploy prompt — there's nothing to deploy yet.
  const hasBuilt = agent.messages.some((m) => m.role === "tool");
  // Bring-your-own-key: nag only when the current provider is unusable — no key
  // saved and not the free tier (GitHub Models, which runs on the platform token).
  // Default is Claude; the auto-pick effect moves to whatever provider the user
  // has a key for, so this rarely fires for someone who's added a key.
  const needsKey = !keys.loading && !keys.providerUsable(provider);

  if (!user) {
    return (
      <>
        <Nav />
        <main className="flex flex-col items-center justify-center text-center" style={{ minHeight: "60vh", padding: "4rem 1.5rem", maxWidth: 640, margin: "0 auto" }}>
          <h1 className="text-4xl font-extrabold tracking-tight mb-3" style={{ fontFamily: "Fraunces, serif" }}>VibeCode</h1>
          <p className="text-lg mb-8" style={{ color: "var(--muted)", maxWidth: 480 }}>
            Describe the game you want. An AI agent builds it, deploys it, and you get a live game on FreeGameStore — in minutes.
          </p>
          <button onClick={signIn} className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold" style={{ background: "var(--accent)", color: "#000", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "1rem", minHeight: 44 }}>
            Sign in with GitHub to start
          </button>
          <p className="text-sm mt-3" style={{ color: "var(--muted)" }}>Free to use. Bring your own API key (OpenRouter, Anthropic, OpenAI, Google, or GitHub Models).</p>
        </main>
      </>
    );
  }

  // No session open (fresh account, or every session was deleted). Show a clear
  // start point instead of a bare, broken-looking chat — the phantom "New Game"
  // auto-create used to hide this and spawn unbound blank sessions.
  if (!agent.currentProjectId) {
    return (
      <div className="flex flex-col" style={{ height: "100dvh", overflow: "hidden" }}>
        <Nav />
        <main className="flex flex-col items-center justify-center text-center flex-1" style={{ padding: "2rem 1.5rem" }}>
          <h1 className="text-3xl font-extrabold tracking-tight mb-3" style={{ fontFamily: "Fraunces, serif" }}>VibeCode</h1>
          <p className="text-base mb-6" style={{ color: "var(--muted)", maxWidth: 420 }}>
            Start a new game and describe it to the AI, or open one of your games to keep editing it.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4" /> New Game
            </Button>
            <a href="/" className={buttonClass("secondary", "md", "no-underline")}>My Games</a>
          </div>
        </main>
        <NewGameModal open={newOpen} onClose={() => setNewOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "100dvh", overflow: "hidden" }}>
      {/* Desktop keeps the global nav on top of the studio toolbar. On mobile the
          two collapse into one: the nav is hidden and StudioToolbar carries a
          back-to-My-Games button (like the FAS studio bar). */}
      <div className="hidden md:block"><Nav /></div>
      <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2">
        {/* Chat */}
        <div className="flex flex-col overflow-hidden border-r" style={{ borderColor: "var(--border)" }}>
          <StudioToolbar
            agent={agent} currentProject={currentProject}
            provider={provider} setProvider={setProvider}
            model={model} setModel={setModel}
            temperature={temperature} setTemperature={setTemperature}
            settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
            setPickerOpen={setPickerOpen}
            onNewGame={() => setNewOpen(true)}
            keys={keys}
          />
          <StatusBar isStreaming={agent.isStreaming} deployState={agent.deployState} messages={agent.messages} />
          {needsKey && (
            <div
              className="shrink-0 flex items-center gap-2 px-3 py-2 text-sm"
              style={{ background: "rgba(217,119,6,0.12)", borderBottom: "1px solid var(--warning, #d97706)", color: "var(--warning, #d97706)" }}
            >
              <span style={{ flex: 1 }}>Add an API key to start building — sends are blocked until then.</span>
              <button
                onClick={() => setSettingsOpen(true)}
                className="shrink-0 inline-flex items-center rounded-md px-3 h-9 text-sm font-semibold"
                style={{ background: "var(--warning, #d97706)", color: "#000", border: "none", cursor: "pointer" }}
              >
                Add key
              </button>
            </div>
          )}
          {agent.error && (
            <div
              role="alert"
              className="shrink-0 flex items-start gap-2 px-3 py-2 text-sm"
              style={{ background: "rgba(239,68,68,0.12)", borderBottom: "1px solid var(--error, #ef4444)", color: "var(--error, #ef4444)" }}
            >
              <span style={{ flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{agent.error}</span>
              <button
                onClick={agent.dismissError}
                aria-label="Dismiss error"
                className="shrink-0 p-0.5 rounded hover:bg-black/10"
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" style={{ minHeight: 0 }}>
            <div className="flex-1" />
            {agent.messages.length > agent.visibleCount && (
              <button
                onClick={agent.showEarlier}
                className="self-center inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-4 py-1.5 mb-1 hover:bg-[var(--bg)]"
                style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                <ArrowUp className="w-4 h-4" /> Load earlier messages ({agent.messages.length - agent.visibleCount} older)
              </button>
            )}
            {agent.messages.slice(Math.max(0, agent.messages.length - agent.visibleCount)).map((m, i) => (
              <ChatMessage key={Math.max(0, agent.messages.length - agent.visibleCount) + i} role={m.role} content={m.content} />
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="flex gap-2 shrink-0" style={{ padding: "0.5rem 0.75rem", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Build me a space invaders game..."
              aria-label="Describe your game"
              rows={1}
              className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] text-sm px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-[var(--accent)]"
              style={{ minHeight: 44, maxHeight: 100, fontFamily: "Manrope, system-ui, sans-serif" }}
            />
            <Button variant="primary" onClick={handleSend} disabled={agent.isStreaming} className="self-end w-11 px-0" title="Send" aria-label="Send">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {/* Preview */}
        <div className="hidden md:flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 shrink-0" style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", background: "var(--surface)", fontSize: "0.85rem" }}>
            <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>Preview</span>
            {previewUrl && (
              <>
                <a href={previewUrl} target="_blank" rel="noopener" className="text-xs" style={{ color: "var(--accent)", fontFamily: "monospace" }}>{previewUrl.replace("https://", "")}</a>
                <a href={previewUrl} target="_blank" rel="noopener" className="ml-auto text-xs font-semibold" style={{ color: "var(--accent)" }}>Open in new tab</a>
              </>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bg)", minHeight: 0, overflow: "hidden" }}>
            {showPreview ? <iframe src={previewUrl} title="Preview" className="w-full h-full border-0" style={{ background: "var(--bg)" }} /> :
             agent.deployState ? <DeployLog state={agent.deployState} /> :
             <div className="text-center p-8 flex flex-col items-center gap-3 max-w-sm" style={{ color: "var(--muted)" }}>
               {hasBuilt ? (
                 <>
                   <p className="text-sm">This game <strong>hasn't been deployed yet</strong> — that's why there's no preview. The AI builds in-session; it only goes live once it deploys.</p>
                   <Button variant="primary" onClick={() => sendPrompt("Deploy the game now so I can see the live preview.")} disabled={agent.isStreaming}>
                     <Send className="w-4 h-4" /> Deploy now
                   </Button>
                   <p className="text-xs">…or just type <span className="font-mono">deploy</span> in the chat.</p>
                 </>
               ) : (
                 <p className="text-sm">Describe your game in the chat to start building — a preview appears here once the AI has built and deployed it.</p>
               )}
             </div>}
          </div>
        </div>
      </div>
      {pickerOpen && (
        <ProjectPicker
          projects={agent.projects}
          currentId={agent.currentProjectId}
          loadError={agent.projectsError}
          onRetry={agent.reloadProjects}
          onSelect={(id) => agent.switchProject(id)}
          // Unified: "new" from the picker opens the one template picker, not a
          // blank canvas session.
          onCreate={() => { setPickerOpen(false); setNewOpen(true); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <NewGameModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
