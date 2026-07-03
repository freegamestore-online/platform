import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings, Bot, Plus, ChevronDown, Copy, Check, ArrowUp, X, Send, Play } from "lucide-react";
import { Button, buttonClass, Select, Input } from "../components/ui";
import { Nav } from "../components/Nav";
import { ChatMessage } from "../components/ChatMessage";
import { DeployLog } from "../components/DeployLog";
import { ProjectPicker } from "../components/ProjectPicker";
import { useAuth } from "../hooks/useAuth";
import { useAgent, type AIConfig, type Project } from "../hooks/useAgent";
import { getKey, resolveInitialProvider } from "../lib/ai-keys";

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  github: [
    { value: "openai/gpt-4.1", label: "GPT-4.1" },
    { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "anthropic/claude-opus-4", label: "Claude Opus 4" },
    { value: "openai/gpt-4.1", label: "GPT-4.1" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  google: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

export function Create() {
  const { user, loading, signIn } = useAuth();
  const agent = useAgent();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Start on a provider the user can actually use (stored choice if it has a
  // key, else any provider they have a key for, else free GitHub Models) — not
  // a hardcoded OpenRouter default that ignores their available keys.
  const [provider, setProvider] = useState(resolveInitialProvider);
  const [model, setModel] = useState(() => {
    const p = resolveInitialProvider();
    const opts = MODEL_OPTIONS[p] ?? [];
    const stored = localStorage.getItem("fgs_model");
    return stored && opts.some((o) => o.value === stored) ? stored : (opts[0]?.value ?? "openai/gpt-4.1");
  });
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
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

  useEffect(() => { agent.loadHistory(); }, [agent.currentProjectId]);
  useEffect(() => {
    // Only stick to the bottom when the user is already near it — don't yank
    // them back down while they've scrolled up to read history (or clicked
    // "Load earlier messages") during a streaming build.
    const c = scrollRef.current;
    if (c && c.scrollHeight - c.scrollTop - c.clientHeight > 120) return;
    const behavior = agent.messages.length <= 1 ? "instant" : "smooth";
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: behavior as ScrollBehavior }), 50);
  }, [agent.messages]);
  useEffect(() => { localStorage.setItem("fgs_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("fgs_model", model); }, [model]);

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
    const key = apiKey || getKey(provider);
    if (!key) {
      // Open the settings panel (where the key input lives) rather than firing a
      // dismissable alert the user misses — the persistent banner explains why.
      setSettingsOpen(true);
      return;
    }
    await agent.sendMessage(msg, { provider, model, apiKey: key, temperature, maxTokens: 16384 } as AIConfig);
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
  // The studio is bring-your-own-key. If none is set for the current provider,
  // every send is blocked before it leaves the browser — so make that the loud,
  // persistent reason nothing happens, not an easy-to-miss alert.
  const needsKey = !apiKey && !getKey(provider);

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
            <Button variant="primary" onClick={() => agent.createProject("New Game")}>
              <Plus className="w-4 h-4" /> New Game
            </Button>
            <a href="/" className={buttonClass("secondary", "md", "no-underline")}>My Games</a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "100dvh", overflow: "hidden" }}>
      <Nav />
      <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2">
        {/* Chat */}
        <div className="flex flex-col overflow-hidden border-r" style={{ borderColor: "var(--border)" }}>
          <Toolbar
            agent={agent} currentProject={currentProject}
            provider={provider} setProvider={setProvider}
            model={model} setModel={setModel}
            apiKey={apiKey} setApiKey={setApiKey}
            temperature={temperature} setTemperature={setTemperature}
            settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
            setPickerOpen={setPickerOpen}
          />
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
            <Button variant="primary" onClick={handleSend} disabled={agent.isStreaming} className="self-end">
              <Send className="w-4 h-4" /> Send
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
               {agent.messages.length > 1 ? (
                 <>
                   <p className="text-sm">This game <strong>hasn't been deployed yet</strong> — that's why there's no preview. The AI builds in-session; it only goes live once it deploys.</p>
                   <Button variant="primary" onClick={() => sendPrompt("Deploy the game now so I can see the live preview.")} disabled={agent.isStreaming}>
                     <Send className="w-4 h-4" /> Deploy now
                   </Button>
                   <p className="text-xs">…or just type <span className="font-mono">deploy</span> in the chat.</p>
                 </>
               ) : (
                 <p className="text-sm">Describe your game in the chat to start building — it appears here once the AI deploys it.</p>
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
          onCreate={(name, appId) => agent.createProject(name, appId)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* -- Sub-components -- */

interface ToolbarProps {
  agent: ReturnType<typeof useAgent>;
  currentProject: Project | undefined;
  provider: string; setProvider: (v: string) => void;
  model: string; setModel: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  temperature: number; setTemperature: (v: number) => void;
  settingsOpen: boolean; setSettingsOpen: (v: boolean) => void;
  setPickerOpen: (v: boolean) => void;
}

function Toolbar({ agent, currentProject, provider, setProvider, model, setModel, apiKey, setApiKey, temperature, setTemperature, settingsOpen, setSettingsOpen, setPickerOpen }: ToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-2 shrink-0 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={agent.isStreaming} className="max-w-[190px]" title={agent.isStreaming ? "Finish the current build to switch games" : "Switch game"}>
          {currentProject?.deployed && <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />}
          <span className="truncate">{currentProject?.name || "Select game"}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </Button>
        <Button size="sm" onClick={() => agent.createProject("New Game")} disabled={agent.isStreaming} title="Start a new game">
          <Plus className="w-4 h-4" /> New
        </Button>
        {/* Settings for THIS game. A deployed game → its own settings page
            (rename / artwork / DELETE) and a Play link. A draft has no live game
            yet, so Settings is disabled with a reason — it never dumps you onto
            the games list, which was the confusing old behavior. */}
        {currentProject?.appId ? (
          <>
            <a
              href={currentProject.appUrl || `https://${currentProject.appId}.freegamestore.online`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "sm", "no-underline")}
              title="Play the live game"
            >
              <Play className="w-4 h-4" /> Play
            </a>
            <Link
              to={`/game/${currentProject.appId}`}
              className={buttonClass("secondary", "sm", "no-underline border-[var(--accent)] text-[var(--accent)]")}
              title={`Settings for ${currentProject.name} — rename, artwork, delete`}
            >
              <Settings className="w-4 h-4" /> Settings
            </Link>
          </>
        ) : (
          <Button
            size="sm"
            disabled
            className="opacity-60"
            title="Deploy this game first — rename, artwork and delete unlock once it's live. To remove a draft, use Discard on My Games."
          >
            <Settings className="w-4 h-4" /> Settings
          </Button>
        )}
        <span className="ml-auto hidden sm:inline text-sm text-[var(--muted)] tabular-nums">
          In <strong className="text-[var(--ink)]">{agent.tokensIn.toLocaleString()}</strong> · Out <strong className="text-[var(--ink)]">{agent.tokensOut.toLocaleString()}</strong>
        </span>
        <CopyLogButton agent={agent} provider={provider} model={model} />
        <Button size="sm" onClick={() => setSettingsOpen(!settingsOpen)} title="AI model & API key">
          <Bot className="w-4 h-4" /> AI
        </Button>
      </div>
      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <Select aria-label="AI provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(MODEL_OPTIONS[e.target.value]?.[0]?.value || ""); }} className="w-auto h-9">
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
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button size="sm" onClick={copy} title="Copy conversation as JSON" className={copied ? "text-[var(--success)] border-[var(--success)]" : "text-[var(--muted)]"}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
