import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { type DeployStatus, deployApp } from "./deploy";

// #88: admin is the arbiter of who owns an id. When it answers that the id
// belongs to another creator (a concurrent deploy won, or the id was already
// theirs), the agent must neither bind the session nor push any code.

const games = getConfig("games"); // Path B: provision via admin

function adminReturning(status: number, body: Record<string, unknown>) {
  return { fetch: vi.fn(async () => new Response(JSON.stringify(body), { status })) };
}

async function run(ADMIN: ReturnType<typeof adminReturning>) {
  const github = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", github);
  const statuses: DeployStatus[] = [];
  const onProvisioned = vi.fn();
  await deployApp(
    { id: "space-invaders", name: "Space Invaders", category: "arcade", icon: "x", iconBg: "#fff", description: "d" },
    new Map([["web/src/App.tsx", "export default 1"]]),
    { GITHUB_TOKEN: "t", ADMIN, INTERNAL_TOKEN: "secret" } as unknown as Parameters<typeof deployApp>[2],
    games,
    (s) => statuses.push(s),
    "bob",
    undefined,
    onProvisioned,
  );
  return { statuses, onProvisioned, github };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deployApp ownership conflict (#88)", () => {
  it("does not bind or push when admin answers 409 (id owned by another creator)", async () => {
    const { statuses, onProvisioned, github } = await run(
      adminReturning(409, {
        success: false,
        conflict: true,
        steps: [{ name: "GitHub repo", status: "fail", detail: '"space-invaders" is already taken by another creator' }],
      }),
    );
    expect(onProvisioned).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ phase: "error" });
    expect((statuses.at(-1) as { error?: string }).error).toMatch(/belongs to another creator/);
    expect(github).not.toHaveBeenCalled(); // no ref wait, no push to their repo
  });

  it("still binds on a non-ownership provision failure so the creator can recover", async () => {
    const { statuses, onProvisioned, github } = await run(
      adminReturning(400, {
        success: false,
        steps: [{ name: "Hosting route", status: "fail", detail: "D1 unavailable" }],
      }),
    );
    expect(onProvisioned).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toMatchObject({ phase: "error" });
    expect(github).not.toHaveBeenCalled();
  });
});
