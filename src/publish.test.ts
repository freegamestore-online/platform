import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySession } from "./auth";
import { handlePublish, handleUpdateGame } from "./publish";

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
});
