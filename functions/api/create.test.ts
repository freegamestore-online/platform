import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the three dependency modules so we can drive onRequestPost's authorization
// branches deterministically without a live GitHub / admin backend.
vi.mock("./_auth", () => ({
  resolveCreator: vi.fn(),
  corsHeaders: () => ({}),
}));
vi.mock("./_games", () => ({
  listUserGames: vi.fn(),
}));
vi.mock("./_errlog", () => ({
  recordError: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { onRequestPost } from "./create";
import { resolveCreator } from "./_auth";
import { listUserGames } from "./_games";
import { fetchWithTimeout } from "./_errlog";

const mResolveCreator = vi.mocked(resolveCreator);
const mListUserGames = vi.mocked(listUserGames);
const mFetch = vi.mocked(fetchWithTimeout);

type Ctx = Parameters<typeof onRequestPost>[0];

function makeCtx(body: Record<string, unknown>, envOverrides: Record<string, unknown> = {}): Ctx {
  const request = new Request("https://console.freegamestore.online/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "fgs_token=abc" },
    body: JSON.stringify(body),
  });
  const env = {
    GITHUB_TOKEN: "gh-token",
    MAX_APPS_PER_USER: "10",
    CREATORS: { get: vi.fn().mockResolvedValue(null) },
    SESSIONS: {},
    ...envOverrides,
  };
  return { request, env } as unknown as Ctx;
}

/** Route fetchWithTimeout by URL: GitHub repo-existence check vs admin provision.
 *  `provisionCapture` receives the parsed provision body for assertions. */
function wireFetch(opts: {
  repoStatus: number;
  provisionStatus?: number;
  provisionBody?: unknown;
  onProvision?: (body: Record<string, unknown>) => void;
}) {
  mFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("api.github.com/repos")) {
      return new Response(null, { status: opts.repoStatus });
    }
    if (url.includes("/api/provision")) {
      if (opts.onProvision && init?.body) opts.onProvision(JSON.parse(init.body as string));
      return new Response(JSON.stringify(opts.provisionBody ?? { success: true }), {
        status: opts.provisionStatus ?? 200,
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("create onRequestPost authorization", () => {
  it("returns 401 when unauthenticated", async () => {
    mResolveCreator.mockResolvedValue(null);
    const res = await onRequestPost(makeCtx({ id: "coolgame", name: "Cool" }));
    expect(res.status).toBe(401);
  });

  it("returns 409 when the repo exists and is NOT owned by the user", async () => {
    mResolveCreator.mockResolvedValue("alice");
    mListUserGames.mockResolvedValue({ owned: [], isOrgMember: false, adminAll: [] });
    wireFetch({ repoStatus: 200 }); // repo exists on GitHub
    const res = await onRequestPost(makeCtx({ id: "coolgame", name: "Cool" }));
    expect(res.status).toBe(409);
  });

  it("returns 403 when over the per-creator game limit", async () => {
    mResolveCreator.mockResolvedValue("alice");
    const owned = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}` }));
    mListUserGames.mockResolvedValue({ owned, isOrgMember: false, adminAll: [] } as never);
    wireFetch({ repoStatus: 404 }); // repo does not exist → would be a NEW game
    const res = await onRequestPost(makeCtx({ id: "coolgame", name: "Cool" }, { MAX_APPS_PER_USER: "10" }));
    expect(res.status).toBe(403);
  });

  it("FAIL-SAFE: a non-200/404 GitHub status returns 502 (not treated as 'free')", async () => {
    mResolveCreator.mockResolvedValue("alice");
    mListUserGames.mockResolvedValue({ owned: [], isOrgMember: false, adminAll: [] });
    // 403 (rate limit) / 401 (token expiry) / 5xx must NOT be read as available.
    for (const status of [401, 403, 500, 502]) {
      wireFetch({ repoStatus: status });
      const res = await onRequestPost(makeCtx({ id: "coolgame", name: "Cool" }));
      expect(res.status).toBe(502);
    }
    // The admin provision endpoint must never have been called on the fail-safe path.
    expect(mFetch.mock.calls.every(([u]) => !String(u).includes("/api/provision"))).toBe(true);
  });

  it("pins creatorGithub to the resolved user (can't re-own another's game)", async () => {
    mResolveCreator.mockResolvedValue("alice");
    mListUserGames.mockResolvedValue({ owned: [], isOrgMember: false, adminAll: [] });
    let provisionBody: Record<string, unknown> | undefined;
    wireFetch({
      repoStatus: 404, // new game
      provisionStatus: 200,
      provisionBody: { success: true },
      onProvision: (b) => { provisionBody = b; },
    });
    // Attacker tries to smuggle a different owner in the body.
    const res = await onRequestPost(
      makeCtx({ id: "newgame", name: "New", creatorGithub: "attacker" }),
    );
    expect(res.status).toBe(200);
    expect(provisionBody).toBeDefined();
    expect(provisionBody?.creatorGithub).toBe("alice"); // pinned, not "attacker"
  });

  it("returns 503 when the registry is unavailable", async () => {
    mResolveCreator.mockResolvedValue("alice");
    mListUserGames.mockRejectedValue(new Error("registry_unavailable"));
    const res = await onRequestPost(makeCtx({ id: "coolgame", name: "Cool" }));
    expect(res.status).toBe(503);
  });

  it("rejects an invalid id with 400 before any network call", async () => {
    mResolveCreator.mockResolvedValue("alice");
    const res = await onRequestPost(makeCtx({ id: "Bad Id!", name: "Cool" }));
    expect(res.status).toBe(400);
    expect(mFetch).not.toHaveBeenCalled();
  });
});
