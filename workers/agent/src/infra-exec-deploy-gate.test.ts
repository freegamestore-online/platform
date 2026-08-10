import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import type { DeployStatus } from "./deploy";
import { deployApp } from "./deploy";
import { executeInfraTool } from "./infra-exec";

// Regression suite for #9 — "Stop marking games as deployed before CI confirms
// the build succeeded". executeDeploy used to call a single `onAppDeployed`
// BEFORE deployApp ran, so a red CI build still reported a shipped game. The
// callback is now split: onAppBound (authorization, pre-build) vs onAppDeployed
// (shipped, CI-confirmed only).
vi.mock("./deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deploy")>();
  return { ...actual, deployApp: vi.fn() };
});

const gamesConfig = getConfig("games");

const mockEnv = {
  GITHUB_TOKEN: "ghp_test",
  CF_API_TOKEN: "cf_test",
  CF_ACCOUNT_ID: "test-account",
};

const DEPLOY_INPUT = {
  id: "my-game",
  name: "My Game",
  category: "arcade",
  icon: "x",
  iconBg: "#fff",
  description: "test",
};

let originalFetch: typeof fetch;

/** deployApp reports its outcome via onStatus and returns normally (it does not
 *  throw on a failed build) — mirror that contract exactly. */
function deployResolvingTo(...statuses: DeployStatus[]) {
  return vi.mocked(deployApp).mockImplementation((async (
    _cfg: unknown,
    _files: unknown,
    _env: unknown,
    _config: unknown,
    onStatus: (s: DeployStatus) => void,
  ) => {
    for (const s of statuses) onStatus(s);
  }) as unknown as typeof deployApp);
}

function makeCtx() {
  return {
    appId: null,
    files: new Map<string, string>(),
    env: mockEnv,
    config: gamesConfig,
    onDeployStatus: vi.fn(),
    onAppBound: vi.fn(),
    onAppDeployed: vi.fn(),
  };
}

function runDeploy(ctx: ReturnType<typeof makeCtx>) {
  return executeInfraTool({ id: "1", name: "deploy", input: DEPLOY_INPUT }, ctx);
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // Uniqueness check: 404 = id is free, so executeDeploy proceeds.
  globalThis.fetch = vi.fn().mockResolvedValue({
    status: 404,
    json: () => Promise.resolve({ message: "Not Found" }),
  }) as unknown as typeof fetch;
  vi.mocked(deployApp).mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("executeDeploy — deployed state is gated on CI success (#9)", () => {
  it("binds the session id BEFORE the build so push_update/get_build_logs can authorize", async () => {
    deployResolvingTo({ phase: "live", appUrl: "https://my-game.freegamestore.online" } as DeployStatus);
    const ctx = makeCtx();
    await runDeploy(ctx);
    expect(ctx.onAppBound).toHaveBeenCalledWith("my-game", "My Game");
  });

  it("marks the app deployed when CI resolves live", async () => {
    deployResolvingTo({ phase: "live", appUrl: "https://my-game.freegamestore.online" } as DeployStatus);
    const ctx = makeCtx();
    const result = await runDeploy(ctx);
    expect(result).toContain("Deploy succeeded");
    expect(ctx.onAppDeployed).toHaveBeenCalledWith("my-game", "My Game");
  });

  // The incident (candy-shop / squishy-swap, 2026-08-09): CI went red while the
  // session, console, and game_info all reported the game as deployed.
  it("does NOT mark the app deployed when the build fails", async () => {
    deployResolvingTo({ phase: "error", error: "CI red" } as DeployStatus);
    const ctx = makeCtx();
    const result = await runDeploy(ctx);
    expect(result).toContain("Deploy FAILED");
    expect(ctx.onAppDeployed).not.toHaveBeenCalled();
    // …but the session still owns the id, so the agent can self-fix in-session.
    expect(ctx.onAppBound).toHaveBeenCalledWith("my-game", "My Game");
  });

  it("does NOT mark the app deployed while the build is still running", async () => {
    deployResolvingTo({ phase: "building", deployUrl: "https://my-game.freegamestore.online" } as DeployStatus);
    const ctx = makeCtx();
    const result = await runDeploy(ctx);
    expect(result).toContain("still building");
    expect(ctx.onAppDeployed).not.toHaveBeenCalled();
    expect(ctx.onAppBound).toHaveBeenCalled();
  });

  // deployApp reports a terminal failure via onStatus and RETURNS NORMALLY, so
  // the LAST status wins — an early "live" followed by a late "error" is a
  // failed deploy, not a shipped one.
  it("does NOT mark deployed when a live status is superseded by a later error", async () => {
    deployResolvingTo(
      { phase: "live", appUrl: "https://my-game.freegamestore.online" } as DeployStatus,
      { phase: "error", error: "R2 sync failed" } as DeployStatus,
    );
    const ctx = makeCtx();
    const result = await runDeploy(ctx);
    expect(result).toContain("Deploy FAILED");
    expect(ctx.onAppDeployed).not.toHaveBeenCalled();
  });

  it("does NOT mark deployed when deployApp throws", async () => {
    vi.mocked(deployApp).mockRejectedValue(new Error("network down"));
    const ctx = makeCtx();
    const result = await runDeploy(ctx);
    expect(result).toContain("Deploy FAILED");
    expect(ctx.onAppDeployed).not.toHaveBeenCalled();
  });
});
