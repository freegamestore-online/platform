// #457 — the deploy budget was never enforced: executeInfraRound passed `deps`
// (not `env.DB`) to allowDeploy, the limiter threw on `deps.prepare`, and its
// fail-open catch waved every deploy through. These tests drive the round with
// a D1-shaped `env.DB` so the real call signature is what's exercised.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { executeInfraRound, type InfraRoundDeps } from "./infra-round";
import { DEPLOY_LIMIT } from "./ratelimit";

vi.mock("./infra-exec", () => ({
  executeInfraTool: vi.fn(async () => "Update deployed and LIVE at https://game.freegamestore.online."),
}));

import { executeInfraTool } from "./infra-exec";

/** In-memory D1 stub: models the INSERT … ON CONFLICT … RETURNING count upsert. */
function mockDb() {
  const counts = new Map<string, number>();
  return {
    prepare(sql: string) {
      return {
        run: async () => ({ success: true }),
        bind(...args: unknown[]) {
          return {
            run: async () => ({ success: true }),
            first: async <T>() => {
              if (sql.includes("INSERT INTO rate_limits")) {
                const bucket = String(args[0]);
                const n = (counts.get(bucket) ?? 0) + 1;
                counts.set(bucket, n);
                return { count: n } as unknown as T;
              }
              return null as unknown as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function makeDeps(db: D1Database, toolCall: { name: string; input: Record<string, unknown> }): InfraRoundDeps {
  return {
    session: { appId: "game", appName: "Game", deployStatus: null },
    files: new Map(),
    deletedFiles: new Set(),
    deployEnv: { GITHUB_TOKEN: "t", CF_API_TOKEN: "c", CF_ACCOUNT_ID: "a" },
    config: getConfig("games"),
    env: { DB: db } as unknown as InfraRoundDeps["env"],
    userId: "github:1",
    sessionId: "s1",
    infraRequests: [{ id: "tc1", toolCall: { id: "tc1", ...toolCall } }],
    newMessages: [],
    fence: { isCurrent: () => true, guard: (fn) => fn },
    sendSSE: vi.fn(),
    setActivity: vi.fn(),
    logError: vi.fn(),
    logDeploy: vi.fn(),
    appendAssistantError: vi.fn(),
    sendPush: vi.fn(),
    persistNow: vi.fn(async () => {}),
  };
}

const PUSH = { name: "push_update", input: { id: "game", message: "tweak" } };

describe("executeInfraRound — deploy budget", () => {
  beforeEach(() => vi.mocked(executeInfraTool).mockClear());

  it("refuses the (DEPLOY_LIMIT + 1)th push_update in an hour and does not run the tool", async () => {
    const db = mockDb();
    for (let i = 0; i < DEPLOY_LIMIT; i++) {
      const deps = makeDeps(db, PUSH);
      const out = await executeInfraRound(deps);
      expect(out.successfulDeploy, `deploy #${i + 1}`).toBe(true);
    }
    expect(executeInfraTool).toHaveBeenCalledTimes(DEPLOY_LIMIT);

    const deps = makeDeps(db, PUSH);
    const out = await executeInfraRound(deps);
    expect(out.successfulDeploy).toBe(false);
    expect(executeInfraTool).toHaveBeenCalledTimes(DEPLOY_LIMIT); // not run
    expect(deps.logError).toHaveBeenCalledWith("ratelimit", expect.stringContaining("github:1"));
    const result = (deps.newMessages[0] as { toolResults: { content: string }[] }).toolResults[0].content;
    expect(result).toMatch(/deploy limit/);
  });

  it("refuses (rather than allows) when the limiter's DB errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = {
        prepare() {
          throw new Error("D1 unavailable");
        },
      } as unknown as D1Database;
      const deps = makeDeps(broken, { name: "deploy", input: { id: "game", name: "Game" } });
      const out = await executeInfraRound(deps);
      expect(out.successfulDeploy).toBe(false);
      expect(executeInfraTool).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/deploy budget check failed/));
    } finally {
      error.mockRestore();
    }
  });

  it("does not budget tools that don't spend the shared token", async () => {
    const broken = {
      prepare() {
        throw new Error("must not be consulted");
      },
    } as unknown as D1Database;
    const deps = makeDeps(broken, { name: "check_deploy_status", input: { id: "game" } });
    await executeInfraRound(deps);
    expect(executeInfraTool).toHaveBeenCalledTimes(1);
  });
});
