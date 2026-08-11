import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { reportBuildStatus, waitForActionsDeploy } from "./deploy";

// Build-status reporting (#22). Provisioning lists a game as `pending` BEFORE the
// first build, so the store must not claim it is live until a deploy.yml run
// concludes success. The agent is the fast path for that flip; admin's hourly
// reconcile is the backstop.

const config = getConfig("games");

/** Admin service-binding stub that records what was POSTed to it. */
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("reportBuildStatus", () => {
  it("posts the game id and status to admin with the internal token", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportBuildStatus("chess", "live", { ADMIN, INTERNAL_TOKEN: "secret" } as any, config);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/game-status");
    expect(calls[0]!.token).toBe("secret");
    expect(calls[0]!.body).toEqual({ id: "chess", status: "live" });
  });

  it("reports a failed build too", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportBuildStatus("chess", "failed", { ADMIN, INTERNAL_TOKEN: "secret" } as any, config);
    expect(calls[0]!.body).toEqual({ id: "chess", status: "failed" });
  });

  it("no-ops when the admin binding or internal token is absent", async () => {
    const { calls, ADMIN } = makeAdmin();
    await reportBuildStatus("chess", "live", { ADMIN } as any, config);
    await reportBuildStatus("chess", "live", { INTERNAL_TOKEN: "secret" } as any, config);
    expect(calls).toHaveLength(0);
  });

  it("swallows a thrown admin call — a deploy is not failed by a failed report", async () => {
    const ADMIN = { fetch: async () => { throw new Error("admin down"); } };
    await expect(
      reportBuildStatus("chess", "live", { ADMIN, INTERNAL_TOKEN: "s" } as any, config),
    ).resolves.toBeUndefined();
  });

  it("swallows a non-OK admin response", async () => {
    const { ADMIN } = makeAdmin(() => new Response("nope", { status: 500 }));
    await expect(
      reportBuildStatus("chess", "live", { ADMIN, INTERNAL_TOKEN: "s" } as any, config),
    ).resolves.toBeUndefined();
  });
});

describe("waitForActionsDeploy reports the CI outcome", () => {
  /** Drive one poll of the (8s-sleep) loop with fake timers. */
  async function runOnePoll(conclusion: string, admin: ReturnType<typeof makeAdmin>) {
    vi.useFakeTimers();
    // A real Response: makeGhApi reads the body with res.text(), so a bare
    // { json } stub parses as {} and the poll loop never sees a run at all.
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ workflow_runs: [{ status: "completed", conclusion, id: 1, html_url: "u" }] }),
        { status: 200 },
      ),
    ) as any;

    const statuses: any[] = [];
    const done = waitForActionsDeploy(
      "chess",
      { GITHUB_TOKEN: "t", ADMIN: admin.ADMIN, INTERNAL_TOKEN: "secret" } as any,
      config,
      (s) => statuses.push(s),
      "https://chess.freegamestore.online",
    );
    await vi.advanceTimersByTimeAsync(9000);
    await done;
    return statuses;
  }

  it("flips the registry to live on a successful run", async () => {
    const admin = makeAdmin();
    const statuses = await runOnePoll("success", admin);

    expect(statuses.at(-1).phase).toBe("live");
    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0]!.body).toEqual({ id: "chess", status: "live" });
  });

  it("reports failed on a failed run", async () => {
    const admin = makeAdmin();
    const statuses = await runOnePoll("failure", admin);

    expect(statuses.at(-1).phase).toBe("error");
    expect(admin.calls[0]!.body).toEqual({ id: "chess", status: "failed" });
  });

  it("reports NOTHING for a cancelled run — Path B cancels superseded runs by design", async () => {
    const admin = makeAdmin();
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ workflow_runs: [{ status: "completed", conclusion: "cancelled" }] }),
        { status: 200 },
      ),
    ) as any;

    const statuses: any[] = [];
    const done = waitForActionsDeploy(
      "chess",
      { GITHUB_TOKEN: "t", ADMIN: admin.ADMIN, INTERNAL_TOKEN: "secret" } as any,
      config,
      (s) => statuses.push(s),
      "https://chess.freegamestore.online",
    );
    // Run past the 3-minute deadline: a cancelled run never resolves the deploy.
    await vi.advanceTimersByTimeAsync(200_000);
    await done;

    expect(admin.calls).toHaveLength(0);
    expect(statuses.at(-1).phase).not.toBe("live");
  });
});
