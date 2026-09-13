import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySession } from "./auth";
import { handleDeleteGame, handlePublish, handleUpdateGame, readGameStatus, setGameStatuses } from "./publish";

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

describe("handlePublish cloneFrom validation", () => {
  // #34: `cloneFrom` goes into privileged GitHub API paths, so a malformed
  // source must be refused before any request is made.
  function stub() {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      calls.push(url);
      // Make the target-repo existence check inconclusive so a request that
      // passes validation stops right there instead of provisioning.
      if ((init?.method ?? "GET") === "GET" && url.endsWith("/repos/freegamestore-online/my-remix")) {
        return new Response(JSON.stringify({ message: "rate limited" }), { status: 403 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    return calls;
  }
  const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];

  for (const cloneFrom of ["../../other-org/secret", "other-org/repo", "chess?ref=x"]) {
    it(`rejects ${JSON.stringify(cloneFrom)} before touching GitHub`, async () => {
      const calls = stub();
      const res = await handlePublish({ id: "my-remix", name: "My Remix", category: "arcade", cloneFrom }, env);
      expect(res.success).toBe(false);
      expect(res.steps[0]!.detail).toMatch(/invalid cloneFrom/i);
      expect(calls).toHaveLength(0);
    });
  }

  it("accepts a well-formed source the new-id rules would refuse (free-snake)", async () => {
    const calls = stub();
    await handlePublish({ id: "my-remix", name: "My Remix", category: "arcade", cloneFrom: "free-snake" }, env);
    expect(calls.length).toBeGreaterThan(0);
    // It got as far as reading the source's engine.
    expect(calls).toContain(
      "https://api.github.com/repos/freegamestore-online/free-snake/contents/web/package.json",
    );
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

describe("handlePublish interrupted-provision heal", () => {
  // Stub GitHub so the target repo already exists; `pkgJson` is what root
  // package.json contains (drives the APPNAME-still-present gate).
  function stub(pkgJson: string) {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "GET" && url.endsWith("/repos/freegamestore-online/chess")) {
        return new Response(JSON.stringify({ id: 123 }), { status: 200 }); // repo exists
      }
      if (method === "GET" && url.includes("/contents/package.json")) {
        return new Response(JSON.stringify({ content: btoa(pkgJson) }), { status: 200 });
      }
      if (method === "GET" && url.includes("/contents/")) {
        return new Response(JSON.stringify({}), { status: 404 }); // other targets absent
      }
      if (method === "GET" && url.includes("/git/ref/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "headsha" } }), { status: 200 });
      }
      if (method === "GET" && url.includes("/git/commits/")) {
        return new Response(JSON.stringify({ tree: { sha: "basetree" } }), { status: 200 });
      }
      if (method === "POST" && url.includes("/git/blobs")) {
        return new Response(JSON.stringify({ sha: "blobsha" }), { status: 200 });
      }
      if (method === "POST" && url.includes("/git/trees")) {
        return new Response(JSON.stringify({ sha: "treesha" }), { status: 200 });
      }
      if (method === "POST" && url.includes("/git/commits")) {
        return new Response(JSON.stringify({ sha: "commitsha" }), { status: 200 });
      }
      if (method === "PATCH" && url.includes("/git/refs/heads/main")) {
        return new Response(JSON.stringify({ ref: "refs/heads/main" }), { status: 200 });
      }
      // registry read/write + everything else benign
      return new Response(
        JSON.stringify({ ok: true, content: btoa(JSON.stringify({ games: [] })), sha: "s" }),
        { status: 200 },
      );
    });
    return calls;
  }

  it("re-runs substitution when the existing repo still has APPNAME (heals a cut-off provision)", async () => {
    const calls = stub(JSON.stringify({ name: "APPNAME" }));
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    const res = await handlePublish({ id: "chess", name: "Chess", category: "arcade", creatorGithub: "serge-the-dev" }, env);
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/git/commits"))).toBe(true);
    expect(res.steps.some((s) => s.name === "Naming")).toBe(true);
  });

  it("does NOT re-substitute an established game (package.json already named)", async () => {
    const calls = stub(JSON.stringify({ name: "chess" }));
    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    const res = await handlePublish({ id: "chess", name: "Chess", category: "arcade", creatorGithub: "serge-the-dev" }, env);
    // The game's real files are never rewritten: no naming commit, no Naming step.
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/git/commits"))).toBe(false);
    expect(res.steps.some((s) => s.name === "Naming")).toBe(false);
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

// Build-status lifecycle (#22). Provisioning writes `pending` before the first
// build, so nothing may report a game live until a deploy.yml run concludes
// success. These guard the transition rules that make that safe.

/** Registry read/write stub. Returns the games it was given on GET, and records
 *  what a PUT would have committed. */
function registryStub(games: unknown[], opts: { putStatus?: number } = {}) {
  const puts: Array<{ games: any[]; message: string }> = [];
  const fetchFn = async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method ?? "GET";
    if (url.includes("/contents/registry.json")) {
      if (method === "GET") {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: "sha1" }),
          { status: 200 },
        );
      }
      const body = JSON.parse(init!.body!);
      const status = opts.putStatus ?? 200;
      if (status !== 200) return new Response(JSON.stringify({ message: "conflict" }), { status });
      puts.push({ games: JSON.parse(atob(body.content)).games, message: body.message });
      return new Response(JSON.stringify({ content: { sha: "sha2" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { puts, fetchFn };
}

const envWithToken = () => ({ GITHUB_TOKEN: "x", DB: undefined }) as unknown as Parameters<typeof setGameStatuses>[0];

describe("readGameStatus", () => {
  it("treats a missing status as live — every entry predating the field is genuinely live", () => {
    expect(readGameStatus({})).toBe("live");
    expect(readGameStatus(undefined)).toBe("live");
  });

  it("does not hide a game on an unrecognised status", () => {
    expect(readGameStatus({ status: "wat" })).toBe("live");
  });

  it("reads the three real states", () => {
    expect(readGameStatus({ status: "pending" })).toBe("pending");
    expect(readGameStatus({ status: "failed" })).toBe("failed");
    expect(readGameStatus({ status: "live" })).toBe("live");
  });
});

describe("setGameStatuses", () => {
  it("flips pending → live and commits it", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess", status: "pending" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "live" }]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual(["chess"]);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.games[0].status).toBe("live");
  });

  it("flips pending → failed for a game that has never shipped", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess", status: "pending" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "failed" }]);
    expect(res.updated).toEqual(["chess"]);
    expect(puts[0]!.games[0].status).toBe("failed");
  });

  it("REFUSES to move a live game to failed — R2 still serves its last good build", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess", status: "live" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "failed" }]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual([]);
    expect(res.skipped[0]).toMatch(/live/);
    // Nothing was committed at all — a shipped game is never delisted by a
    // later red build.
    expect(puts).toHaveLength(0);
  });

  it("REFUSES to downgrade a legacy entry with no status field", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "failed" }]);
    expect(res.updated).toEqual([]);
    expect(puts).toHaveLength(0);
  });

  it("batches several flips into ONE commit", async () => {
    const { puts, fetchFn } = registryStub([
      { id: "a", status: "pending" },
      { id: "b", status: "pending" },
      { id: "c", status: "live" },
    ]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [
      { id: "a", status: "live" },
      { id: "b", status: "failed" },
    ]);
    expect(res.updated).toEqual(["a", "b"]);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.games.find((g: any) => g.id === "a").status).toBe("live");
    expect(puts[0]!.games.find((g: any) => g.id === "b").status).toBe("failed");
    // The untargeted entry is carried through untouched.
    expect(puts[0]!.games.find((g: any) => g.id === "c").status).toBe("live");
  });

  it("skips an unknown id rather than failing the batch", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess", status: "pending" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [
      { id: "ghost", status: "live" },
      { id: "chess", status: "live" },
    ]);
    expect(res.ok).toBe(true);
    expect(res.updated).toEqual(["chess"]);
    expect(res.skipped.some((s) => s.includes("ghost"))).toBe(true);
  });

  it("writes nothing when there is no real transition", async () => {
    const { puts, fetchFn } = registryStub([{ id: "chess", status: "live" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "live" }]);
    expect(res.ok).toBe(true);
    expect(puts).toHaveLength(0);
  });

  it("reports failure when the registry write stays contended", async () => {
    const { fetchFn } = registryStub([{ id: "chess", status: "pending" }], { putStatus: 409 });
    vi.stubGlobal("fetch", fetchFn);
    const res = await setGameStatuses(envWithToken(), [{ id: "chess", status: "live" }]);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/contended/i);
  });
});

describe("handlePublish build status", () => {
  it("lists a NEW game as pending — provisioning runs before the first build", async () => {
    // Awaits the registry PUT rather than the whole provision: later steps
    // (placeholder substitution, route insert) retry against a stub that can
    // never satisfy them, and the entry shape is settled by the time it commits.
    let resolvePut: (games: any[]) => void;
    const firstPut = new Promise<any[]>((r) => { resolvePut = r; });

    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = init?.method ?? "GET";
      if (url.includes("/contents/registry.json")) {
        if (method === "GET") {
          return new Response(
            JSON.stringify({ content: btoa(JSON.stringify({ games: [] })), sha: "sha1" }),
            { status: 200 },
          );
        }
        resolvePut(JSON.parse(atob(JSON.parse(init!.body!).content)).games);
        return new Response(JSON.stringify({ content: { sha: "sha2" } }), { status: 200 });
      }
      // Target repo does not exist yet → provision proceeds down the create path.
      if (method === "GET" && url.endsWith("/repos/freegamestore-online/chess")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      // The APPNAME substitution step polls for the generated repo's main ref
      // (12 × 1.5s) before it commits. Answer it immediately so the run reaches
      // the registry write inside the test timeout instead of spinning there.
      if (url.includes("/git/ref/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "headsha" } }), { status: 200 });
      }
      if (url.includes("/git/commits/")) {
        return new Response(JSON.stringify({ tree: { sha: "treesha" } }), { status: 200 });
      }
      // Any other repo file read (the substitution targets) — a real contents
      // payload, so the step completes rather than retrying on a decode failure.
      if (method === "GET" && url.includes("/contents/")) {
        return new Response(
          JSON.stringify({ content: btoa("APPNAME"), sha: "s" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 });
    });

    const env = { GITHUB_TOKEN: "x", DB: undefined } as unknown as Parameters<typeof handlePublish>[1];
    void handlePublish({ id: "chess", name: "Chess", category: "arcade", creatorGithub: "someone" }, env);

    const games = await firstPut;
    expect(games.find((g: any) => g.id === "chess").status).toBe("pending");
  });
});

// Deprovision from the console (#14). handleDeleteGame gained an ADMIN OVERRIDE
// because an ops console whose delete button only works on the admin's own games
// is not an ops console. It is destructive — delist + route drop + repo archive —
// so the ownership rule must still hold for everyone else.

function deleteStub(registry: unknown[], opts: { putOk?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn = async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method ?? "GET";
    if (method !== "GET") calls.push(`${method} ${url}`);
    if (url.includes("/contents/registry.json")) {
      if (method === "GET") {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games: registry })), sha: "s" }),
          { status: 200 },
        );
      }
      return opts.putOk === false
        ? new Response(JSON.stringify({ message: "conflict" }), { status: 409 })
        : new Response(JSON.stringify({ content: { sha: "s2" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { calls, fetchFn };
}

const deleteEnv = () => ({
  GITHUB_TOKEN: "x",
  DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
}) as unknown as Parameters<typeof handleDeleteGame>[2];

describe("handleDeleteGame admin override", () => {
  it("lets an admin deprovision a game they do NOT own", async () => {
    const { calls, fetchFn } = deleteStub([{ id: "chess", name: "Chess", creatorGithub: "someone-else" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await handleDeleteGame("chess", "admin@example.com", deleteEnv(), { adminOverride: true });
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.startsWith("PUT") && c.includes("registry.json"))).toBe(true);
  });

  it("STILL refuses a non-owner without the override", async () => {
    const { calls, fetchFn } = deleteStub([{ id: "chess", name: "Chess", creatorGithub: "someone-else" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await handleDeleteGame("chess", "serge-the-dev", deleteEnv());
    expect(res.error).toMatch(/only the creator/i);
    expect(calls).toHaveLength(0); // nothing delisted, archived or route-dropped
  });

  it("lets the override delete a game with no recorded owner", async () => {
    // Ownerless games are exactly the orphans an operator needs to clean up; the
    // normal path refuses them outright.
    const { fetchFn } = deleteStub([{ id: "orphan", name: "Orphan" }]);
    vi.stubGlobal("fetch", fetchFn);
    expect((await handleDeleteGame("orphan", "admin", deleteEnv(), { adminOverride: true })).ok).toBe(true);
  });

  it("reports a step-by-step result the console can render", async () => {
    const { fetchFn } = deleteStub([{ id: "chess", name: "Chess", creatorGithub: "alice" }]);
    vi.stubGlobal("fetch", fetchFn);
    const res = await handleDeleteGame("chess", "alice", deleteEnv());
    const names = (res.steps ?? []).map((s) => s.name);
    expect(names).toContain("Store registry");
    expect(names).toContain("Hosting route");
    expect(names).toContain("Repo");
    expect(res.steps!.every((s) => ["ok", "skip", "fail"].includes(s.status))).toBe(true);
  });

  it("returns the failing step when the registry write fails", async () => {
    const { fetchFn } = deleteStub([{ id: "chess", name: "Chess", creatorGithub: "alice" }], { putOk: false });
    vi.stubGlobal("fetch", fetchFn);
    const res = await handleDeleteGame("chess", "alice", deleteEnv());
    expect(res.error).toBeTruthy();
    expect(res.steps?.[0]).toMatchObject({ name: "Store registry", status: "fail" });
  });
});
