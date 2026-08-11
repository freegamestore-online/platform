import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUp, ExternalLink, Plus, Send, X } from "lucide-react";
import { Button, buttonClass } from "../components/ui";
import { Nav } from "../components/Nav";
import { ChatMessage } from "../components/ChatMessage";
import { DeployLog } from "../components/DeployLog";
import { DeployErrorNotice } from "../components/DeployErrorNotice";
import { GameVersion } from "../components/GameVersion";
import { ProjectPicker } from "../components/ProjectPicker";
import { StudioToolbar } from "../components/StudioToolbar";
import { StatusBar } from "../components/StatusBar";
import { NewGameModal } from "../components/NewGameModal";
import { useAuth } from "../hooks/useAuth";
import { useAgent, type AIConfig } from "../hooks/useAgent";
import { useKeys } from "../hooks/useKeys";
import { resolveInitialProvider, PROVIDERS } from "../lib/ai-keys";
import { resolveModel, firstModelFor } from "../lib/models";
import { getKidMode } from "../lib/kidMode";
import { clearInitialBuild, isInitialBuildComplete, readInitialBuild, type InitialBuild } from "../lib/initialBuild";
import { RETRY_DEPLOY_PROMPT } from "../lib/deployError";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Kid mode preference (Profile → Kid mode). Read on mount; changing it in the
  // Profile route remounts Create, so a fresh value is picked up on return.
  const [kidMode] = useState(getKidMode);
  const openedGameRef = useRef<string | null>(null);
  const openedSessionRef = useRef<string | null>(null);
  const autoInitialPromptRef = useRef<string | null>(null);
  const [initialBuild, setInitialBuild] = useState<InitialBuild | null>(null);
  const [providerResolved, setProviderResolved] = useState(false);
  const keySignature = [...keys.providers].sort().join("|");
  const { id: urlKey } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The key whose resolution the routing effect has already started — re-entry
  // protection, so an unrelated re-render can't fire a second openGame for it.
  const resolvedKeyRef = useRef<string | null>(null);
  // A SELF-WRITE whose URL has not landed yet: `undefined` = none pending,
  // `null` = navigating to the empty state, a string = navigating to that key.
  //
  // The picker no longer changes currentProjectId (#16), but delete and fresh-chat
  // still must — deleteProject promotes a survivor, startFreshChat mints a
  // session — and then catch the URL up. Between those two updates urlKey still
  // names the OLD game while the open session is already the new one, and this
  // effect depends on both. Without this guard it "resolves" that stale key and
  // re-imports the game the user just deleted.
  const pendingSelfNavRef = useRef<string | null | undefined>(undefined);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const currentProject = agent.projects.find((p) => p.id === agent.currentProjectId);
  const legacyGameParam = searchParams.get("game");
  const legacySessionParam = searchParams.get("session");

  const routeKeyForProject = useCallback((project: { id: string; appId?: string } | undefined | null) => project?.appId || project?.id || null, []);

  /** Point the address bar at a project.
   *
   *  `alreadyOpen` distinguishes the two kinds of caller, which used to be
   *  conflated (#16):
   *   - SELF-WRITE (`alreadyOpen: true`) — the session is already the open one
   *     and we are only catching the URL up (delete picked a survivor,
   *     startFreshChat minted a session). Pre-marking the key as resolved tells
   *     the routing effect there is nothing to open.
   *   - USER INTENT (default) — the user asked for a different game. We write
   *     ONLY the URL and let the routing effect do the opening, so there is
   *     exactly one code path that opens a game. Pre-marking here would suppress
   *     that open entirely. */
  const navigateToProject = useCallback((
    project: { id: string; appId?: string } | undefined | null,
    opts: { replace?: boolean; alreadyOpen?: boolean } = {},
  ) => {
    const { replace = false, alreadyOpen = false } = opts;
    const key = routeKeyForProject(project);
    if (!key) {
      if (alreadyOpen) { resolvedKeyRef.current = null; pendingSelfNavRef.current = null; }
      navigate("/create", { replace });
      return;
    }
    if (alreadyOpen) { resolvedKeyRef.current = key; pendingSelfNavRef.current = key; }
    navigate(`/create/${key}`, { replace });
  }, [navigate, routeKeyForProject]);

  // Path routing: /create/<key> opens that game or session — the key is the
  // game id once deployed (/create/tetris), or the session id for a draft.
  //
  // THE URL IS THE SINGLE AUTHORITATIVE TRIGGER for opening a game (#16). This is
  // the ONLY place that opens one. Everything that wants to change which game is
  // open — the picker, a My Games link, the back button — writes the URL and
  // lets this effect resolve it.
  //
  // #3/#4/#5/#6 were all the same root cause: the picker imperatively did BOTH
  // switchProject (currentProjectId) AND navigateToProject (the URL) in one
  // non-batched callback, so there was a transient render where currentProjectId
  // was already the NEW game while urlKey still named the OLD one — and this
  // effect, which depends on both, treated the stale urlKey as "needs opening"
  // and re-opened the previous game. The picker no longer touches
  // currentProjectId, so that transient cannot occur and lastUrlKeyRef (which
  // existed only to detect it) is gone.
  //
  // resolvedKeyRef remains, doing one job: latching the key whose resolution has
  // already been STARTED. Re-entry protection, not race arbitration — without it
  // an unrelated re-render (projects updating, an import settling) would fire a
  // second openGame for the same key.
  useEffect(() => {
    if (loading || !user || agent.projectsLoading || agent.isStreaming) return;
    // A self-write is in flight — ignore every run until the URL actually lands,
    // because until then urlKey names the PREVIOUS game.
    if (pendingSelfNavRef.current !== undefined) {
      if (pendingSelfNavRef.current !== (urlKey ?? null)) return;
      pendingSelfNavRef.current = undefined;
    }
    if (!urlKey) return;
    if (resolvedKeyRef.current === urlKey) return;
    resolvedKeyRef.current = urlKey;
    const project = agent.projects.find((p) => p.appId === urlKey || p.id === urlKey);
    if (project?.id === agent.currentProjectId) return; // already open
    if (project && !project.appId) { agent.switchProject(project.id); return; } // draft
    // A deployed game (known or not-yet-listed): openGame re-syncs its repo
    // files and dedupes to its existing session. A UUID with no index row is a
    // session whose transcript still lives in the DO — just switch to it.
    const gameId = project?.appId ?? (UUID_RE.test(urlKey) ? null : urlKey);
    if (!gameId) { agent.switchProject(urlKey); return; }
    setResolvingUrl(true);
    // Capture the revert target SYNCHRONOUSLY before the async openGame call.
    // Reading currentProject inside the .then() callback would use a potentially
    // stale closure value if the component re-rendered while the import was in
    // flight — e.g. if a stale openGame from a DIFFERENT call had already mutated
    // currentProjectId. Capturing here ensures the revert always points at the
    // game that was genuinely open when the user initiated this navigation.
    const revertKey = currentProject?.appId || currentProject?.id || null;
    void agent.openGame(gameId).then((openedId) => {
      // openGame resolves to null when the import fails (game not found / no
      // access / a build in progress) — it has already surfaced the reason on
      // the error banner. See freegamestore-online/platform#3.
      // Do NOT leave the user parked on /create/<gameId> while
      // the studio still shows the PREVIOUS game: that URL↔session mismatch is
      // silent and dangerous — their next prompt would edit the previous game.
      // Point the address bar back at whatever is actually open (or the empty
      // state). Crucially, DON'T rewrite resolvedKeyRef here: it is already
      // latched to the failed key (above), which stops this effect from
      // re-firing openGame in a loop; when the reverted URL lands, the effect
      // re-runs once and re-latches to the open game — so re-selecting the
      // failed game later still RETRIES.
      if (openedId) return;
      // Guard against reverting a superseded open: if the user switched to a
      // different game while this openGame was in flight, this effect has since
      // re-run for the new key and re-latched resolvedKeyRef to it. Don't clobber
      // the URL the user deliberately landed on. Only revert for genuine failures
      // where this effect is still the active resolution. See issue #5.
      if (resolvedKeyRef.current !== urlKey) return;
      navigate(revertKey ? `/create/${revertKey}` : "/create", { replace: true });
    }).finally(() => setResolvingUrl(false));
  }, [urlKey, loading, user, agent.projectsLoading, agent.isStreaming, agent.projects, agent.currentProjectId, agent.switchProject, agent.openGame, currentProject, navigate]);

  // Canonical URL: keep the address bar on the open game's unique URL. Same
  // project (bare /create on load, or a draft URL right after deploy) is a
  // rewrite — replace. A different project is a navigation — push, so Back
  // returns to the previous game.
  //
  // Since #16 this is a FEEDBACK loop only — it reports which session is open
  // (chiefly the draft→deployed promotion, /create/<sessionId> → /create/<gameId>)
  // and never opens anything. The routing effect above is the sole opener.
  useEffect(() => {
    if (loading || !user || agent.projectsLoading || resolvingUrl) return;
    if (searchParams.get("game") || searchParams.get("session")) return; // legacy deep-link still resolving
    if (pendingSelfNavRef.current !== undefined) return; // an earlier self-write hasn't landed
    if (urlKey && resolvedKeyRef.current !== urlKey) return; // path still resolving
    const current = agent.projects.find((p) => p.id === agent.currentProjectId);
    if (urlKey) {
      const routeMatchesCurrent = current?.appId === urlKey || current?.id === urlKey || (UUID_RE.test(urlKey) && agent.currentProjectId === urlKey);
      if (!routeMatchesCurrent) return;
    }
    const canonical = current?.appId || agent.currentProjectId;
    if (canonical === (urlKey ?? null)) return;
    if (!canonical) {
      resolvedKeyRef.current = null;
      pendingSelfNavRef.current = null;
      navigate("/create", { replace: true });
      return;
    }
    const urlProject = urlKey ? agent.projects.find((p) => p.appId === urlKey || p.id === urlKey) : undefined;
    const sameProject = !urlKey || urlProject?.id === agent.currentProjectId;
    // Our own write — nothing to re-open, and urlKey stays stale until it lands.
    resolvedKeyRef.current = canonical;
    pendingSelfNavRef.current = canonical;
    navigate(`/create/${canonical}`, { replace: sameProject });
  }, [urlKey, loading, user, agent.projectsLoading, resolvingUrl, agent.projects, agent.currentProjectId, searchParams, navigate]);

  // Deep-link: /create?game=<id> opens an existing game in the studio. Wait for
  // the session list to load first (so an already-open game switches instead of
  // importing a duplicate), open once, then drop the param so a reload / new
  // message doesn't re-import.
  useEffect(() => {
    const gameId = searchParams.get("game");
    // Wait for identity to resolve. Without `!user || loading`, this fires during
    // the auth-loading window when projectsLoading is already false and the
    // project list is still empty — so openGame finds no match and mints a
    // duplicate session for a game that already has one.
    if (!gameId || loading || !user || agent.projectsLoading || agent.isStreaming || openedGameRef.current === gameId) return;
    openedGameRef.current = gameId;
    // ?fresh=1 (from a game's settings) starts a CLEAN chat for the game instead
    // of reopening its existing conversation — the escape hatch for a session
    // whose history has gone bad. Otherwise open/resume the game normally.
    const fresh = searchParams.get("fresh") === "1";
    const open = fresh ? agent.startFreshChat(gameId) : agent.openGame(gameId);
    void open.finally(() => {
      setSearchParams({}, { replace: true });
    });
  }, [searchParams, loading, user, agent.projectsLoading, agent.isStreaming, agent.openGame, agent.startFreshChat, setSearchParams]);

  // Deep-link: /create?session=<id> resumes an in-progress draft session (opened
  // from My Games). Unlike ?game=, a draft has no live repo to
  // import — its transcript already lives in the DO keyed by this id, so we just
  // switch to it and loadHistory() fills in the messages.
  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (!sessionId || loading || !user || agent.projectsLoading || agent.isStreaming || openedSessionRef.current === sessionId) return;
    openedSessionRef.current = sessionId;
    agent.switchProject(sessionId);
    setSearchParams({}, { replace: true });
  }, [searchParams, loading, user, agent.projectsLoading, agent.isStreaming, agent.switchProject, setSearchParams]);

  useEffect(() => {
    if (!agent.currentProjectId || agent.projectsLoading || resolvingUrl) return;
    if (legacyGameParam || legacySessionParam) return;
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
    legacyGameParam,
    legacySessionParam,
    urlKey,
    currentProject?.appId,
    currentProject?.id,
  ]);
  useEffect(() => {
    // While a build is streaming, only stick to the bottom when the user is
    // already near it — don't yank them back down after they've scrolled up to
    // read history. Otherwise (first load, game switch, a finished turn) always
    // land at the newest message, even on a long transcript. Gating on
    // isStreaming — not a consumable flag — is what makes the load-time jump
    // survive the intermediate default-message render before history arrives.
    const c = scrollRef.current;
    if (agent.isStreaming && c && c.scrollHeight - c.scrollTop - c.clientHeight > 120) return;
    const behavior = agent.messages.length <= 1 ? "instant" : "smooth";
    // Cleared on the next message so a streaming build (a delta per token)
    // doesn't stack dozens of pending timers.
    const t = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: behavior as ScrollBehavior }), 50);
    return () => clearTimeout(t);
  }, [agent.messages]);
  useEffect(() => { localStorage.setItem("fgs_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("fgs_model", model); }, [model]);

  useEffect(() => {
    setInitialBuild(readInitialBuild(currentProject?.appId));
  }, [currentProject?.appId]);

  const autoPickedRef = useRef(false);
  const lastKeySignatureRef = useRef("");
  useEffect(() => {
    autoPickedRef.current = false;
    lastKeySignatureRef.current = "";
    setProviderResolved(false);
  }, [user?.sub]);

  // Once the vault's key state loads, use whatever provider the user actually
  // has a key for. If no paid provider is usable, fall back to the free GitHub
  // Models tier so a first build is not blocked by a stale paid preference.
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
    if (keys.hasKey(provider)) {
      setProviderResolved(true);
      return;
    }
    const keyed = PROVIDERS.find((p) => keys.hasKey(p.type));
    if (keyed) {
      setProvider(keyed.type);
      setModel(firstModelFor(keyed.type));
    } else if (!keys.providerUsable(provider)) {
      setProvider("github");
      setModel(firstModelFor("github"));
    }
    setProviderResolved(true);
  }, [keys.loading, keys.hasKey, keys.providerUsable, keySignature, provider, user?.sub]);

  const sendPrompt = useCallback(async (msg: string) => {
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
  }, [agent.isStreaming, agent.sendMessage, keys.providerUsable, provider, model, temperature]);

  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg || agent.isStreaming) return;
    if (!keys.providerUsable(provider)) {
      await sendPrompt(msg);
      return;
    }
    setInputValue("");
    await sendPrompt(msg);
  }, [inputValue, agent.isStreaming, keys.providerUsable, provider, sendPrompt]);

  useEffect(() => {
    const gameId = currentProject?.appId;
    if (!gameId || !initialBuild) return;

    const hasUserMessage = agent.messages.some((m) => m.role === "user");
    if (isInitialBuildComplete(agent.deployState?.phase, hasUserMessage)) {
      clearInitialBuild(gameId);
      setInitialBuild(null);
      return;
    }

    const key = `${gameId}:${initialBuild.createdAt}`;
    if (autoInitialPromptRef.current === key || agent.isStreaming || loading || !user || agent.projectsLoading || !providerResolved) return;
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
    setInputValue("");
    void sendPrompt(initialBuild.prompt);
  }, [
    currentProject?.appId,
    initialBuild,
    agent.deployState?.phase,
    agent.isStreaming,
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

  // The studio is a fixed, full-height app shell where ONLY the chat scrolls.
  // Lock the page itself while it's mounted so mobile Safari can't scroll the
  // whole layout (both bars included) when the transcript overflows — html/body
  // otherwise only lock overflow-x and #root is min-height:100dvh (can grow).
  // Restored on unmount so the other routes (Dashboard, Profile) scroll normally.
  useEffect(() => {
    const body = document.body.style;
    const html = document.documentElement.style;
    const prev = { body: body.overflow, html: html.overflow };
    body.overflow = "hidden";
    html.overflow = "hidden";
    return () => { body.overflow = prev.body; html.overflow = prev.html; };
  }, []);

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

  // Preview URL: the deployed game's own URL. FGS games are Path B — they serve
  // from R2 at https://<id>.freegamestore.online (NOT pages.dev). Prefer the
  // persisted project URL; during a live deploy fall back to the deploy status's
  // appUrl so the preview appears before markDeployed persists.
  const previewUrl = currentProject?.appUrl || agent.deployState?.appUrl || agent.deployState?.deployUrl || null;
  const hasBuilt = agent.messages.some((m) => m.role === "tool");
  const initialBuildTerminal = isInitialBuildComplete(agent.deployState?.phase, agent.messages.some((m) => m.role === "user"));
  const initialBuildQueued = !!initialBuild && !initialBuildTerminal;
  const initialBuildPromptSent = initialBuildQueued && agent.messages.some((m) => m.role === "user");
  const initialBuildInProgress = initialBuildQueued && (!!agent.deployState || agent.isStreaming || !initialBuildPromptSent);
  const showPreview = !!previewUrl && (agent.deployState?.phase === "live" || (!agent.deployState && currentProject?.deployed && !initialBuildQueued));
  const versionUrl = showPreview ? previewUrl : null;
  const previewStatusState = agent.deployState ?? (initialBuildInProgress ? {
    phase: agent.isStreaming ? "pushing" : "provisioning",
    appUrl: previewUrl ?? undefined,
    hint: agent.isStreaming
      ? "The AI is building the first playable version. The preview appears after it deploys."
      : "Opening the new game and starting the first build. The preview appears after deploy.",
  } : null);
  const firstBuildNeedsDeploy = initialBuildQueued && !initialBuildInProgress && initialBuildPromptSent && hasBuilt;
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
  const deployFailed = agent.deployState?.phase === "error";
  const canRetryDeploy = deployFailed && !agent.isStreaming && !!currentProject?.appId;

  if (!user) {
    return (
      <>
        <Nav />
        <main className="flex flex-col items-center justify-center text-center" style={{ minHeight: "60vh", padding: "4rem 1.5rem", maxWidth: 640, margin: "0 auto" }}>
          <h1 className="text-4xl font-extrabold tracking-tight mb-3" style={{ fontFamily: "Fraunces, serif" }}>Studio</h1>
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
          <h1 className="text-3xl font-extrabold tracking-tight mb-3" style={{ fontFamily: "Fraunces, serif" }}>Studio</h1>
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
      {/* grid-rows-[minmax(0,1fr)] bounds the single row to the container height
          (an `auto` row would size to content and let the chat push past the
          viewport). Each column then owns its own overflow. */}
      <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2 grid-rows-[minmax(0,1fr)]">
        {/* Chat — min-h-0 so it can shrink to the row height and its inner
            overflow-y-auto region becomes the only scroll surface. */}
        <div className="flex flex-col overflow-hidden border-r min-h-0" style={{ borderColor: "var(--border)" }}>
          <StudioToolbar
            agent={agent} currentProject={currentProject} switching={resolvingUrl}
            provider={provider} setProvider={setProvider}
            model={model} setModel={setModel}
            temperature={temperature} setTemperature={setTemperature}
            settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
            setPickerOpen={setPickerOpen}
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
            {(() => {
              const start = Math.max(0, agent.messages.length - agent.visibleCount);
              const lastIdx = agent.messages.length - 1;
              return agent.messages.slice(start).map((m, i) => {
                const idx = start + i;
                const live = agent.isStreaming && idx === lastIdx && m.role === "assistant";
                return <ChatMessage key={idx} role={m.role} content={m.content} kid={kidMode} live={live} />;
              });
            })()}
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
            {previewUrl ? (
              <>
                <a href={previewUrl} target="_blank" rel="noopener" className="text-xs truncate min-w-0 flex-1" style={{ color: "var(--accent)", fontFamily: "monospace" }}>{previewUrl.replace("https://", "")}</a>
                {versionUrl && (
                  <span className="hidden lg:inline-flex items-center shrink-0 text-[0.62rem] text-[var(--muted)] tabular-nums">
                    <GameVersion
                      key={agent.deployState?.phase === "live" ? "live" : versionUrl}
                      liveUrl={versionUrl}
                    />
                  </span>
                )}
                <a href={previewUrl} target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab" className="shrink-0 inline-flex items-center justify-center" style={{ color: "var(--accent)", width: 28, height: 28 }}>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </>
            ) : (
              <span className="text-xs" style={{ color: "var(--muted)" }}>Preview</span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center" style={{ background: "#000", minHeight: 0, overflow: "hidden" }}>
            {showPreview ? <iframe src={previewUrl} title="Preview" className="w-full h-full border-0" style={{ background: "#000" }} /> :
             previewStatusState ? <DeployLog state={previewStatusState} appId={currentProject?.appId} /> :
             <div className="text-center p-8 flex flex-col items-center gap-3 max-w-sm" style={{ color: "var(--muted)" }}>
               {hasBuilt || firstBuildNeedsDeploy ? (
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
          onCreate={() => { setPickerOpen(false); setNewOpen(true); }}
          onDelete={(id) => {
            const deletingCurrent = id === agent.currentProjectId;
            const next = agent.projects.find((p) => p.id !== id) ?? null;
            // deleteProject already promotes the survivor to current, so this is
            // a self-write catching the URL up — not a request to open it.
            agent.deleteProject(id);
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
