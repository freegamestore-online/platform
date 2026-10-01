import { afterEach, describe, expect, it, vi } from "vitest";

// The push_update tool waits for the CI run after pushing; that is not what
// these tests are about, so resolve it immediately (pushUpdate stays real).
vi.mock("./deploy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deploy")>()),
  waitForActionsDeploy: vi.fn(async () => {}),
}));

import { getConfig } from "./config";
import { pushUpdate } from "./deploy";
import { executeInfraTool } from "./infra-exec";
import { executeTool } from "./tools";

// #86: delete_file only removed the path from the in-memory Map, and
// push_update commits on base_tree — which keeps every path it isn't given —
// so deleted files stayed in the repo (and kept breaking CI) forever.

const games = getConfig("games");

/** A minimal GitHub Git Data API. `repoTree` is the parent commit's tree. */
function fakeGitHub(repoTree: string[] | "fail") {
  const trees: { tree: { path: string; sha: string | null }[] }[] = [];
  const commits: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const ok = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (url.endsWith("/git/ref/heads/main")) return ok({ object: { sha: "head" } });
      if (method === "POST" && url.endsWith("/git/blobs")) return ok({ sha: `blob-${body.content.length}` }, 201);
      if (url.endsWith("/git/commits/head")) return ok({ tree: { sha: "basetree" } });
      if (url.includes("/git/trees/basetree?recursive=1")) {
        if (repoTree === "fail") return ok({ message: "Unprocessable" }, 422);
        return ok({ truncated: false, tree: repoTree.map((path) => ({ path, type: "blob" })) });
      }
      if (method === "POST" && url.endsWith("/git/trees")) {
        trees.push(body);
        return ok({ sha: "newtree" }, 201);
      }
      if (method === "POST" && url.endsWith("/git/commits")) {
        commits.push(body);
        return ok({ sha: "newcommit1234" }, 201);
      }
      if (method === "PATCH" && url.endsWith("/git/refs/heads/main")) return ok({ ref: "refs/heads/main" });
      return ok({ message: "not found" }, 404);
    }),
  );
  return { trees, commits };
}

const env = { GITHUB_TOKEN: "t", CF_API_TOKEN: "x", CF_ACCOUNT_ID: "a" };
afterEach(() => vi.unstubAllGlobals());

describe("delete_file records the deletion (#86)", () => {
  it("delete_file records the path; write_file to it again un-records it", async () => {
    const files = new Map([["web/src/OldScene.tsx", "broken"]]);
    const deleted = new Set<string>();
    const del = await executeTool({ id: "1", name: "delete_file", input: { path: "web/src/OldScene.tsx" } }, files, games, deleted);
    expect(del.isError).toBeFalsy();
    expect(files.has("web/src/OldScene.tsx")).toBe(false);
    expect([...deleted]).toEqual(["web/src/OldScene.tsx"]);

    await executeTool(
      { id: "2", name: "write_file", input: { path: "web/src/OldScene.tsx", content: "export const x = 1;\n" } },
      files,
      games,
      deleted,
    );
    expect(deleted.size).toBe(0);
  });
});

describe("pushUpdate applies deletions (#86)", () => {
  it("removes deleted paths that exist in the repo with sha:null tree entries", async () => {
    const { trees } = fakeGitHub(["web/src/App.tsx", "web/src/OldScene.tsx", "public/logo.png"]);
    const result = await pushUpdate("my-game", new Map([["web/src/App.tsx", "export default 1;\n"]]), "Remove old scene", env, games, [
      "web/src/OldScene.tsx",
      "web/src/NeverCommitted.tsx",
      "web/src/App.tsx",
    ]);
    expect(result).toMatch(/^Pushed update .*removed 1 deleted file/);
    const tree = trees[0].tree;
    expect(tree).toContainEqual({ path: "web/src/OldScene.tsx", mode: "100644", type: "blob", sha: null });
    // Never-committed paths are skipped; a path that is still in the session is
    // written, not deleted; untouched repo files (the image) are left alone.
    expect(tree.find((e) => e.path === "web/src/NeverCommitted.tsx")).toBeUndefined();
    expect(tree.find((e) => e.path === "web/src/App.tsx")?.sha).not.toBeNull();
    expect(tree.find((e) => e.path === "public/logo.png")).toBeUndefined();
  });

  it("refuses to commit when it cannot read the repo tree to apply deletions", async () => {
    const { commits } = fakeGitHub("fail");
    const result = await pushUpdate("my-game", new Map(), "Remove old scene", env, games, ["web/src/OldScene.tsx"]);
    expect(result).toMatch(/^Error: could not read the repo tree/);
    expect(commits).toHaveLength(0);
  });

  it("makes no extra tree read when nothing was deleted", async () => {
    fakeGitHub(["web/src/App.tsx"]);
    await pushUpdate("my-game", new Map([["web/src/App.tsx", "x"]]), "Update", env, games);
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("recursive=1"))).toBe(false);
  });
});

describe("push_update tool clears pending deletions once applied (#86)", () => {
  const ctx = (deletedFiles: Set<string>) => ({
    appId: "my-game",
    files: new Map([["web/src/App.tsx", "export default 1;\n"]]),
    deletedFiles,
    env,
    config: games,
    onDeployStatus: vi.fn(),
    onAppBound: vi.fn(),
    onAppDeployed: vi.fn(),
  });
  const call = { id: "p", name: "push_update", input: { id: "my-game", message: "Remove old scene" } };

  it("clears the set after a successful push", async () => {
    const { trees } = fakeGitHub(["web/src/App.tsx", "web/src/OldScene.tsx"]);
    const deleted = new Set(["web/src/OldScene.tsx"]);
    await executeInfraTool(call, ctx(deleted));
    expect(trees[0].tree).toContainEqual(expect.objectContaining({ path: "web/src/OldScene.tsx", sha: null }));
    expect(deleted.size).toBe(0);
  });

  it("keeps the set when the push fails, so the deletion is retried", async () => {
    fakeGitHub("fail");
    const deleted = new Set(["web/src/OldScene.tsx"]);
    await executeInfraTool(call, ctx(deleted));
    expect([...deleted]).toEqual(["web/src/OldScene.tsx"]);
  });
});

describe("push_update waits for its own commit's run (#87)", () => {
  it("passes the pushed commit SHA to the deploy waiter", async () => {
    fakeGitHub(["web/src/App.tsx"]);
    const { waitForActionsDeploy } = await import("./deploy");
    vi.mocked(waitForActionsDeploy).mockClear();
    await executeInfraTool(
      { id: "p", name: "push_update", input: { id: "my-game", message: "Update" } },
      {
        appId: "my-game",
        files: new Map([["web/src/App.tsx", "export default 1;\n"]]),
        env,
        config: games,
        onDeployStatus: vi.fn(),
        onAppBound: vi.fn(),
        onAppDeployed: vi.fn(),
      },
    );
    // The fake GitHub's commit endpoint returns sha "newcommit1234".
    expect(vi.mocked(waitForActionsDeploy).mock.calls[0]?.[5]).toBe("newcommit1234");
  });
});
