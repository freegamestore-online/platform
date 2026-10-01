import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { type DeployStatus, pushCommit, waitForActionsDeploy } from "./deploy";

// #87: after a push, the deploy waiter read `deploy.yml/runs?per_page=1` — the
// newest run of ANY commit. If GitHub had not registered the new commit's run
// by the first poll, the waiter read the PREVIOUS run: an old failure (with its
// stale logs, so the model chased a fixed bug) or an old success reported as
// live before the new build had passed.

const config = getConfig("games");
const APP_URL = "https://space-rescue.freegamestore.online";
const NEW_SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);

type Run = { id: number; head_sha: string; status: string; conclusion: string | null; html_url?: string };

/** Fake Actions API: `runs(poll)` = every deploy.yml run, newest first, at that poll. */
function fakeActions(runs: (poll: number) => Run[]) {
  let poll = 0;
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/actions/workflows/deploy.yml/runs")) {
        const sha = new URL(url).searchParams.get("head_sha");
        const all = runs(poll++);
        return new Response(JSON.stringify({ workflow_runs: sha ? all.filter((r) => r.head_sha === sha) : all }));
      }
      if (url.includes("/jobs")) return new Response(JSON.stringify({ jobs: [] }));
      return new Response("{}");
    }),
  );
  return urls;
}

async function wait(headSha?: string) {
  const statuses: DeployStatus[] = [];
  const done = waitForActionsDeploy("space-rescue", { GITHUB_TOKEN: "t" } as never, config, (s) => statuses.push(s), APP_URL, headSha);
  await vi.advanceTimersByTimeAsync(60_000);
  await done;
  return statuses;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const oldFailure: Run = { id: 1, head_sha: OLD_SHA, status: "completed", conclusion: "failure" };
const oldSuccess: Run = { id: 1, head_sha: OLD_SHA, status: "completed", conclusion: "success" };

describe("deploy waiter follows the pushed commit's run (#87)", () => {
  it("does not report the previous run's failure before the new run registers", async () => {
    vi.useFakeTimers();
    const urls = fakeActions((poll) =>
      poll < 2
        ? [oldFailure] // new run not registered yet
        : [{ id: 2, head_sha: NEW_SHA, status: "completed", conclusion: "success" }, oldFailure],
    );
    const statuses = await wait(NEW_SHA);
    expect(statuses.at(-1)).toMatchObject({ phase: "live" });
    expect(urls.some((u) => u.includes(`head_sha=${NEW_SHA}`))).toBe(true);
  });

  it("does not report the previous run's success as live while the new build is still running", async () => {
    vi.useFakeTimers();
    fakeActions((poll) =>
      poll < 1
        ? [oldSuccess]
        : poll < 3
          ? [{ id: 2, head_sha: NEW_SHA, status: "in_progress", conclusion: null }, oldSuccess]
          : [{ id: 2, head_sha: NEW_SHA, status: "completed", conclusion: "failure" }, oldSuccess],
    );
    const statuses = await wait(NEW_SHA);
    expect(statuses.some((s) => s.phase === "live")).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ phase: "error" });
  });

  it("follows the newer run when a later push supersedes (cancels) ours", async () => {
    vi.useFakeTimers();
    const NEWER = "c".repeat(40);
    fakeActions(() => [
      { id: 3, head_sha: NEWER, status: "completed", conclusion: "success" },
      { id: 2, head_sha: NEW_SHA, status: "completed", conclusion: "cancelled" },
    ]);
    const statuses = await wait(NEW_SHA);
    expect(statuses.at(-1)).toMatchObject({ phase: "live" });
  });

  it("still follows the latest run when no SHA is known", async () => {
    vi.useFakeTimers();
    const urls = fakeActions(() => [oldSuccess]);
    const statuses = await wait();
    expect(statuses.at(-1)).toMatchObject({ phase: "live" });
    expect(urls.some((u) => u.includes("head_sha="))).toBe(false);
  });
});

describe("pushCommit (#87)", () => {
  it("returns the full SHA of the pushed commit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
        if (url.endsWith("/git/ref/heads/main")) return ok({ object: { sha: "head" } });
        if (method === "POST" && url.endsWith("/git/blobs")) return ok({ sha: "blob" });
        if (url.endsWith("/git/commits/head")) return ok({ tree: { sha: "base" } });
        if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: "tree" });
        if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: NEW_SHA });
        if (method === "PATCH") return ok({ ref: "refs/heads/main" });
        return new Response("{}", { status: 404 });
      }),
    );
    const res = await pushCommit("space-rescue", new Map([["web/src/App.tsx", "x"]]), "Update", { GITHUB_TOKEN: "t" } as never, config);
    expect(res.sha).toBe(NEW_SHA);
    expect(res.message).toMatch(/^Pushed update/);
  });
});
