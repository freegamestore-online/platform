import { afterEach, describe, expect, it, vi } from "vitest";
import { reportPlatformError } from "./errlog";

// #21: agent deploy failures must reach the shared error_log the admin console
// reads. The agent cannot INSERT the row — its `DB` binding is the leaderboard
// database, while error_log lives in admin's freegamestore database — so the
// report goes over the ADMIN service binding.

function makeAdmin(res: () => Response = () => new Response("{}", { status: 200 })) {
  const calls: Array<{ url: string; token: string | null; body: any }> = [];
  return {
    calls,
    ADMIN: {
      fetch: async (input: any, init?: any) => {
        calls.push({
          url: typeof input === "string" ? input : input.url,
          token: init?.headers?.["X-Internal-Token"] ?? null,
          body: JSON.parse(init?.body ?? "{}"),
        });
        return res();
      },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("reportPlatformError", () => {
  it("posts the row to admin's internal endpoint with the internal token", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportPlatformError({ ADMIN, INTERNAL_TOKEN: "secret" } as any, "freegamestore.online", {
      source: "agent/deploy",
      user: "u1",
      context: "gameId=candy-shop sessionId=s1",
      message: "Deploy workflow failure: deploy › Smoke test built game",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/internal/error");
    expect(calls[0]!.token).toBe("secret");
    expect(calls[0]!.body.source).toBe("agent/deploy");
    expect(calls[0]!.body.user).toBe("u1");
    expect(calls[0]!.body.context).toContain("gameId=candy-shop");
    expect(calls[0]!.body.context).toContain("sessionId=s1");
    expect(calls[0]!.body.message).toContain("Smoke test built game");
  });

  it("no-ops without the admin binding or the internal token", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportPlatformError({ ADMIN } as any, "d", { source: "agent/deploy", message: "x" });
    await reportPlatformError({ INTERNAL_TOKEN: "s" } as any, "d", { source: "agent/deploy", message: "x" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a row with no source or no message", async () => {
    const { calls, ADMIN } = makeAdmin();
    const env = { ADMIN, INTERNAL_TOKEN: "s" } as any;
    await reportPlatformError(env, "d", { source: "", message: "x" });
    await reportPlatformError(env, "d", { source: "agent/deploy", message: "" });
    expect(calls).toHaveLength(0);
  });

  it("clamps an enormous message rather than posting it whole", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportPlatformError({ ADMIN, INTERNAL_TOKEN: "s" } as any, "d", {
      source: "agent/deploy",
      message: "e".repeat(9000),
      stack: "s".repeat(9000),
    });
    expect(calls[0]!.body.message.length).toBe(2000);
    expect(calls[0]!.body.stack.length).toBe(4000);
  });

  it("swallows a thrown admin call — reporting a failure must not become one", async () => {
    const ADMIN = {
      fetch: async () => {
        throw new Error("admin down");
      },
    };
    await expect(
      reportPlatformError({ ADMIN, INTERNAL_TOKEN: "s" } as any, "d", { source: "agent/deploy", message: "x" }),
    ).resolves.toBeUndefined();
  });

  it("swallows a non-OK admin response", async () => {
    const { ADMIN } = makeAdmin(() => new Response("nope", { status: 500 }));
    await expect(
      reportPlatformError({ ADMIN, INTERNAL_TOKEN: "s" } as any, "d", { source: "agent/deploy", message: "x" }),
    ).resolves.toBeUndefined();
  });
});
