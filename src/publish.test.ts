import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySession } from "./auth";
import { handleDeleteGame, handlePublish, handleUpdateGame } from "./publish";

// Regression guards for the admin authz fixes:
//  - provision must not grant push on a repo it didn't just create
//  - unowned games are not self-service editable
//  - session verification fails closed without a signing key

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifySession", () => {
  it("fails closed when the signing key is empty", async () => {
    // Never verify against a "undefined"/empty key (which would be forgeable).
    expect(await verifySession("aaa.bbb.ccc", "")).toBeNull();
  });
});

describe("handlePublish collaborator escalation", () => {
  it("does NOT add a push collaborator when the repo already exists", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      // GET on the target repo → it already exists.
      if (method === "GET" && url.endsWith("/repos/freegamestore-online/chess")) {
        return new Response(JSON.stringify({ id: 123 }), { status: 200 });
      }
      // Everything else (registry read/write etc.) → benign 200.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    // An attacker names an existing game and their own login as creatorGithub.
    await handlePublish(
      { id: "chess", name: "Chess", category: "arcade", creatorGithub: "attacker" },
      env,
    );

    const collabPuts = calls.filter((c) => c.url.includes("/collaborators/") && c.method === "PUT");
    expect(collabPuts).toHaveLength(0);
  });
});

describe("handleUpdateGame ownership", () => {
  it("refuses to edit a game that has no recorded owner", async () => {
    const registry = { games: [{ id: "orphan", name: "Orphan" }] }; // no creatorGithub
    const content = btoa(JSON.stringify(registry));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ content, sha: "s" }), { status: 200 }));

    const env = { GITHUB_TOKEN: "x" } as unknown as Parameters<typeof handleUpdateGame>[3];
    const res = await handleUpdateGame("orphan", "anyone", { name: "Hacked" }, env);
    expect(res.error).toMatch(/no recorded owner/i);
  });

  it("matches the owner case-insensitively (GitHub logins are case-insensitive)", async () => {
    const registry = { games: [{ id: "chess", name: "Chess", creatorGithub: "Serge-The-Dev" }] };
    let putBody: any = null;
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") { putBody = JSON.parse(init.body!); return new Response(JSON.stringify({ content: {} }), { status: 200 }); }
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: "s" }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: "x" } as unknown as Parameters<typeof handleUpdateGame>[3];
    const res = await handleUpdateGame("chess", "serge-the-dev", { name: "New Name" }, env);
    expect(res.ok).toBe(true);
    expect(putBody).not.toBeNull(); // a write happened → ownership passed despite casing
  });
});

describe("handleDeleteGame ownership", () => {
  it("refuses to delete a game the caller doesn't own (no registry/repo writes)", async () => {
    const registry = { games: [{ id: "chess", name: "Chess", creatorGithub: "someone-else" }] };
    const writes: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method && init.method !== "GET") writes.push(`${init.method} ${url}`);
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: "s" }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handleDeleteGame>[2];
    const res = await handleDeleteGame("chess", "serge-the-dev", env);
    expect(res.error).toMatch(/only the creator/i);
    expect(writes).toHaveLength(0); // nothing delisted, archived, or route-deleted
  });

  it("deletes a game the caller owns (delists it via a registry PUT)", async () => {
    const registry = { games: [{ id: "chess", name: "Chess", creatorGithub: "serge-the-dev" }] };
    let putBody: any = null;
    const dbRun = vi.fn(async () => {});
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") { putBody = JSON.parse(init.body!); return new Response(JSON.stringify({ content: {} }), { status: 200 }); }
      if (init?.method === "PATCH") return new Response(JSON.stringify({ archived: true }), { status: 200 }); // repo archive
      return new Response(JSON.stringify({ content: btoa(JSON.stringify(registry)), sha: "s" }), { status: 200 });
    });
    const env = {
      GITHUB_TOKEN: "x",
      DB: { prepare: () => ({ bind: () => ({ run: dbRun }) }) },
    } as unknown as Parameters<typeof handleDeleteGame>[2];
    const res = await handleDeleteGame("chess", "serge-the-dev", env);
    expect(res.ok).toBe(true);
    expect(putBody.content).toBeDefined(); // registry rewritten (entry removed)
    expect(dbRun).toHaveBeenCalled(); // route deletion attempted
  });
});

describe("handlePublish reserved-id guard", () => {
  it("rejects reserved infra ids before touching GitHub", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(typeof input === "string" ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    // Exact infra ids + any template-game-* variant must be rejected as reserved.
    for (const id of ["submissions", "brand", "ops", "sdk", "template-game-canvas", "template-game-9000"]) {
      const res = await handlePublish({ id, name: "X", category: "arcade" }, env);
      expect(res.success).toBe(false);
      expect(res.steps[0]!.detail).toMatch(/reserved/i);
    }
    // `freegamestore` is also refused (via the free-prefix rule) — never provisioned.
    const fg = await handlePublish({ id: "freegamestore", name: "X", category: "arcade" }, env);
    expect(fg.success).toBe(false);
    // Not one of these reached GitHub.
    expect(calls).toHaveLength(0);
  });
});

describe("handlePublish repo-existence fail-safe", () => {
  it("aborts (no generate) when the existence check is inconclusive (403 rate-limit)", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      // The existence check returns 403 (rate limit / token issue) — inconclusive.
      if (method === "GET" && url.endsWith("/repos/freegamestore-online/chess")) {
        return new Response(JSON.stringify({ message: "rate limited" }), { status: 403 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    const res = await handlePublish({ id: "chess", name: "Chess", category: "arcade" }, env);
    expect(res.success).toBe(false);
    expect(res.steps[0]!.detail).toMatch(/could not verify/i);
    // Crucially: it did NOT proceed to generate a repo over the unknown state.
    expect(calls.filter((c) => c.url.includes("/generate"))).toHaveLength(0);
  });
});

describe("handlePublish owner validation", () => {
  it("aborts before any repo/registry write when creatorGithub is malformed", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(typeof input === "string" ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    const res = await handlePublish(
      { id: "chess", name: "Chess", category: "arcade", creatorGithub: "bad name!!" },
      env,
    );
    expect(res.success).toBe(false);
    expect(res.steps[0]!.detail).toMatch(/invalid creatorgithub/i);
    // Nothing touched GitHub — no repo check, no generate, no registry write.
    expect(calls).toHaveLength(0);
  });
});
