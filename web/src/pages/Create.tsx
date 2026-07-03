import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

  useEffect(() => { agent.loadHistory(); }, [agent.currentProjectId]);
  useEffect(() => {
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

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || agent.isStreaming) return;
    const key = apiKey || getKey(provider);
    if (!key) {
      // Open the settings panel (where the key input lives) rather than firing a
      // dismissable alert the user misses — the persistent banner explains why.
      setSettingsOpen(true);
      return;
    }
    setInputValue("");
    await agent.sendMessage(msg, { provider, model, apiKey: key, temperature, maxTokens: 16384 } as AIConfig);
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
            <button
              onClick={() => agent.createProject("New Game")}
              className="px-6 rounded-full font-semibold"
              style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}
            >
              New Game
            </button>
            <a href="/" className="px-6 rounded-full font-semibold no-underline flex items-center" style={{ minHeight: 44, border: "1px solid var(--border)", color: "var(--ink)" }}>
              My Games
            </a>
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
                style={{ background: "var(--warning, #d97706)", color: "#000", border: "none", borderRadius: "0.375rem", padding: "0.2rem 0.6rem", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem", minHeight: 28 }}
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
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: "0 0.25rem" }}
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" style={{ minHeight: 0 }}>
            <div className="flex-1" />
            {agent.messages.length > agent.visibleCount && (
              <button
                onClick={agent.showEarlier}
                className="self-center text-xs font-semibold rounded-full px-4 py-1.5 mb-1"
                style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                ↑ Load earlier messages ({agent.messages.length - agent.visibleCount} older)
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
              className="flex-1 resize-none"
              style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.4rem 0.6rem", background: "var(--bg)", color: "var(--ink)", fontSize: "0.86rem", minHeight: 44, maxHeight: 100, fontFamily: "Manrope, system-ui, sans-serif" }}
            />
            <button onClick={handleSend} disabled={agent.isStreaming} className="self-end" style={{ padding: "0.4rem 0.85rem", background: "var(--accent)", color: "#000", border: "none", borderRadius: "0.5rem", fontWeight: 600, fontSize: "0.86rem", cursor: "pointer", fontFamily: "inherit", minHeight: 44, opacity: agent.isStreaming ? 0.5 : 1 }}>
              Send
            </button>
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
             <div className="text-center p-8" style={{ color: "var(--muted)" }}><p>Your game will appear here once deployed.</p></div>}
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
  const sel: React.CSSProperties = { padding: "0.2rem 0.4rem", border: "1px solid var(--border)", borderRadius: "0.3rem", background: "var(--bg)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.78rem" };
  const btn: React.CSSProperties = { background: "none", border: "1px solid var(--border)", borderRadius: "0.3rem", padding: "0.15rem 0.4rem", cursor: "pointer", color: "var(--ink)", fontSize: "0.78rem", minHeight: 28 };

  return (
    <>
      <div className="flex items-center gap-2 shrink-0" style={{ padding: "0.35rem 0.75rem", borderBottom: "1px solid var(--border)", background: "var(--surface)", fontSize: "0.78rem" }}>
        <button onClick={() => setPickerOpen(true)} style={{ ...btn, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentProject?.deployed ? "● " : ""}{currentProject?.name || "Select game"} ▾
        </button>
        <button onClick={() => agent.createProject("New Game")} style={btn} title="Start a new game">+ New</button>
        {currentProject?.appId && (
          <Link to={`/game/${currentProject.appId}`} style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }} title="Game settings — name, artwork, delete">
            &#9881; Settings
          </Link>
        )}
        <span className="ml-auto" style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          In: <strong>{agent.tokensIn.toLocaleString()}</strong> Out: <strong>{agent.tokensOut.toLocaleString()}</strong>
        </span>
        <CopyLogButton agent={agent} provider={provider} model={model} />
        <button onClick={() => setSettingsOpen(!settingsOpen)} style={btn} title="AI model & API key">&#129302; AI</button>
      </div>
      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-2 shrink-0" style={{ padding: "0.35rem 0.75rem", borderBottom: "1px solid var(--border)", background: "var(--surface)", fontSize: "0.78rem" }}>
          <select aria-label="AI provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(MODEL_OPTIONS[e.target.value]?.[0]?.value || ""); }} style={sel}>
            <option value="github">GitHub Models</option><option value="openrouter">OpenRouter</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option>
          </select>
          <select aria-label="AI model" value={model} onChange={(e) => setModel(e.target.value)} style={sel}>
            {(MODEL_OPTIONS[provider] || []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {getKey(provider)
            ? <span className="text-xs" style={{ color: "var(--success)" }}>Key saved</span>
            : <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" aria-label="API key" style={{ ...sel, width: 180 }} />
          }
          <select aria-label="Temperature" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} style={sel}>
            <option value={0}>Temp 0</option><option value={0.3}>Temp 0.3</option><option value={0.7}>Temp 0.7</option><option value={1}>Temp 1</option>
          </select>
        </div>
      )}
    </>
  );
}

function CopyLogButton({ agent, provider, model }: { agent: ReturnType<typeof useAgent>; provider: string; model: string }) {
  const [copied, setCopied] = useState(false);
  const btn: React.CSSProperties = { background: "none", border: "1px solid var(--border)", borderRadius: "0.3rem", padding: "0.15rem 0.4rem", cursor: "pointer", color: copied ? "var(--success)" : "var(--muted)", fontSize: "0.72rem", minHeight: 28 };

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

  return <button onClick={copy} title="Copy conversation as JSON" style={btn}>{copied ? "✓" : "Copy"}</button>;
}
