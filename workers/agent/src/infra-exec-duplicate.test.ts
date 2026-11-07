import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { deployApp } from "./deploy";
import { executeInfraTool } from "./infra-exec";

// #526: the agent answered "id taken" by inventing a near-duplicate id
// (royal-heist -> royalheist). A creator's own matching game must be reused.
vi.mock("./deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deploy")>();
  return { ...actual, deployApp: vi.fn() };
});

const config = getConfig("games");
const env = { GITHUB_TOKEN: "ghp_test", CF_API_TOKEN: "x", CF_ACCOUNT_ID: "y" };

const REGISTRY = {
  games: [
    { id: "royal-heist", name: "Royal Heist", creatorGithub: "Crystal12341" },
    { id: "chess", name: "Chess", creatorGithub: "someone-else" },
  ],
};

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/contents/")) return new Response(JSON.stringify(REGISTRY), { status: 200 });
    return new Response('{"message":"Not Found"}', { status: 404 }); // the repo id is free
  }) as unknown as typeof fetch;
  vi.mocked(deployApp).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(id: string, name: string, creatorLogin: string, appId: string | null = null) {
  return executeInfraTool(
    { id: "1", name: "deploy", input: { id, name, category: "arcade", icon: "x", iconBg: "#fff", description: "d" } },
    {
      appId,
      files: new Map<string, string>(),
      env,
      config,
      creatorLogin,
      onDeployStatus: vi.fn(),
      onAppBound: vi.fn(),
      onAppDeployed: vi.fn(),
    },
  );
}

describe("deploy duplicate guard (#526)", () => {
  it("refuses royalheist when the same creator already has royal-heist", async () => {
    const out = await run("royalheist", "Royal Heist 2", "crystal12341");
    expect(out).toMatch(/already has a game "royal-heist"/);
    expect(out).toMatch(/Do NOT invent a different ID/);
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("refuses a different id with the same display name", async () => {
    const out = await run("heist-the-sequel", "royal heist", "Crystal12341");
    expect(out).toMatch(/royal-heist/);
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("allows a different creator to use the same name", async () => {
    const out = await run("royalheist", "Royal Heist", "another-creator");
    expect(out).not.toMatch(/already has/);
    expect(deployApp).toHaveBeenCalledOnce();
  });

  it("does not run when the session is opened on a game", async () => {
    await run("royalheist", "Royal Heist", "Crystal12341", "royalheist");
    expect(deployApp).toHaveBeenCalledOnce();
  });

  it("the taken-id refusal no longer tells the model to choose another id", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"archived":false}', { status: 200 })) as unknown as typeof fetch;
    const out = await run("chess", "Chess", "Crystal12341");
    expect(out).toMatch(/ask the user/);
    expect(out).not.toMatch(/choose a different ID/i);
  });
});
