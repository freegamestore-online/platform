import { describe, expect, it, vi } from "vitest";

// Stub the deploy layer: these tests assert what executeDeploy HANDS to it
// (the engine → template passthrough), not the deploy itself.
vi.mock("./deploy", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deploy")>();
  return { ...real, deployApp: vi.fn().mockResolvedValue(undefined) };
});

import { getConfig } from "./config";
import { deployApp } from "./deploy";
import { executeInfraTool } from "./infra-exec";

const gamesConfig = getConfig("games");

function makeCtx(engine?: string) {
  return {
    appId: null,
    files: new Map<string, string>(),
    env: { GITHUB_TOKEN: "t", CF_API_TOKEN: "t", CF_ACCOUNT_ID: "t" },
    config: gamesConfig,
    engine,
    onDeployStatus: vi.fn(),
    onAppBound: vi.fn(),
    onAppDeployed: vi.fn(),
  };
}

function deployCall(engine?: string) {
  // Repo-uniqueness precheck: 404 = id free.
  globalThis.fetch = vi.fn().mockResolvedValue({ status: 404, json: () => Promise.resolve({}) }) as never;
  return executeInfraTool(
    { id: "1", name: "deploy", input: { id: "hop-test", name: "Hop Test", category: "arcade", description: "d" } },
    makeCtx(engine) as never,
  );
}

describe("executeDeploy — engine template passthrough", () => {
  it("forwards the session's engine as DeployConfig.template", async () => {
    await deployCall("babylon");
    const cfg = vi.mocked(deployApp).mock.calls.at(-1)![0];
    expect(cfg.template).toBe("babylon");
  });

  it("leaves template undefined for legacy sessions with no engine", async () => {
    await deployCall(undefined);
    const cfg = vi.mocked(deployApp).mock.calls.at(-1)![0];
    expect(cfg.template).toBeUndefined();
  });
});
