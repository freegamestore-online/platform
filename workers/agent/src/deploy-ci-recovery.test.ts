import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { ACTIONS_DEPLOY_CEILING_MS, deadlineStatus, filterLogErrorLines, waitForActionsDeploy } from "./deploy";

// CI-recovery loop (#7). candy-shop and squishy-swap crashed at RUNTIME only —
// tsc and vite build both passed, and the headless-Chrome smoke test in
// deploy.yml caught it. The agent never saw those failures: the waiter gave up
// at 180s, reported the calm "still building", and the turn ended before the
// failure landed. These cover the two halves of the fix — reaching a verdict,
// and carrying the error text back with it.

const config = getConfig("games");
const APP_URL = "https://candy-shop.freegamestore.online";

/** A GitHub job log as Actions serves it: timestamped, ANSI-coloured lines. */
const SMOKE_FAILURE_LOG = [
  "2026-08-09T06:14:02.1234567Z ##[group]Run node <<'NODE'",
  "2026-08-09T06:14:09.7654321Z Error: Browser errors:",
  "2026-08-09T06:14:09.7654322Z [31mStyled text error: unclosed tags G,C,H[0m",
  "2026-08-09T06:14:09.7654323Z     at parseText (kaplay.mjs:1201:11)",
  "2026-08-09T06:14:10.0000000Z ##[error]Process completed with exit code 1.",
].join("\n");

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("filterLogErrorLines", () => {
  it("extracts the smoke test's browser error and strips timestamps + ANSI", () => {
    const lines = filterLogErrorLines(SMOKE_FAILURE_LOG);
    const joined = lines.join("\n");
    expect(joined).toContain("Styled text error: unclosed tags G,C,H");
    // The creator-facing detail must survive without log noise around it.
    expect(joined).not.toMatch(/2026-08-09T06:14/);
    expect(joined).not.toContain("[31m");
  });

  it("catches a runtime TypeError — the squishy-swap failure class", () => {
    const log = "2026-08-09T06:00:00.0Z TypeError: Cannot read properties of undefined (reading 'length')";
    expect(filterLogErrorLines(log).join("\n")).toContain("Cannot read properties of undefined");
  });

  it("catches the no-render failure the smoke test throws when nothing paints", () => {
    const log = "2026-08-09T06:00:00.0Z Error: Game rendered no body/root/canvas content";
    expect(filterLogErrorLines(log).join("\n")).toContain("Game rendered no body/root/canvas content");
  });

  it("falls back to the log tail when nothing matches, rather than returning nothing", () => {
    const log = Array.from({ length: 50 }, (_, i) => `2026-08-09T06:00:00.0Z line ${i}`).join("\n");
    const lines = filterLogErrorLines(log);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("line 49");
  });
});

describe("deadlineStatus at the ceiling", () => {
  it("stays calm when a run was genuinely observed still running", () => {
    const s = deadlineStatus(false, null, APP_URL, "in_progress");
    expect(s.phase).toBe("building");
  });

  it("treats 'no run ever appeared' as an error, not as still building", () => {
    // A workflow that never started is not a slow build — calling it "building"
    // is the calm lie #7 is about.
    const s = deadlineStatus(false, null, APP_URL, null);
    expect(s.phase).toBe("error");
    if (s.phase === "error") expect(s.error).toMatch(/never started|did not|no deploy workflow run/i);
  });

  it("still reports unknown when polling itself was failing", () => {
    const s = deadlineStatus(true, "GitHub API 503", APP_URL, null);
    expect(s.phase).toBe("error");
    if (s.phase === "error") expect(s.error).toContain("GitHub API 503");
  });

  it("keeps the pre-#7 3-arg meaning for existing callers", () => {
    expect(deadlineStatus(false, null, APP_URL).phase).toBe("building");
  });
});

/** Route the three endpoints the waiter touches: the runs poll, the jobs list,
 *  and the raw job log. `runsFor(pollIndex)` decides what the poll sees. */
function stubActions(runsFor: (poll: number) => unknown, log = SMOKE_FAILURE_LOG) {
  let poll = 0;
  globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/actions/workflows/deploy.yml/runs")) {
      return new Response(JSON.stringify({ workflow_runs: [runsFor(poll++)].filter(Boolean) }), { status: 200 });
    }
    if (/\/actions\/runs\/\d+\/jobs/.test(url)) {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 555,
              name: "deploy",
              conclusion: "failure",
              steps: [{ name: "Smoke test built game", conclusion: "failure" }],
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (/\/actions\/jobs\/\d+\/logs/.test(url)) {
      return new Response(log, { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as any;
}

async function runWaiter(advanceMs: number) {
  const statuses: any[] = [];
  const done = waitForActionsDeploy("candy-shop", { GITHUB_TOKEN: "t" } as any, config, (s) => statuses.push(s), APP_URL);
  await vi.advanceTimersByTimeAsync(advanceMs);
  await done;
  return statuses;
}

describe("waitForActionsDeploy reaches a verdict instead of timing out", () => {
  it("keeps polling past the OLD 180s deadline and still resolves live", async () => {
    vi.useFakeTimers();
    // In progress for ~4 minutes (30 polls × 8s = 240s), which the old 180s
    // wall-clock deadline would have abandoned as "still building".
    stubActions((poll) =>
      poll < 30 ? { id: 1, status: "in_progress", conclusion: null } : { id: 1, status: "completed", conclusion: "success" },
    );
    const statuses = await runWaiter(300_000);
    expect(statuses.at(-1).phase).toBe("live");
  });

  it("keeps polling past 180s and reports a LATE failure the old deadline missed", async () => {
    vi.useFakeTimers();
    stubActions((poll) =>
      poll < 30
        ? { id: 1, status: "in_progress", conclusion: null }
        : { id: 1, status: "completed", conclusion: "failure", html_url: "https://gh/run/1" },
    );
    const statuses = await runWaiter(300_000);
    const last = statuses.at(-1);
    expect(last.phase).toBe("error");
    // This is the whole point of #7: the actual browser error reaches the agent.
    expect(last.error).toContain("Styled text error: unclosed tags G,C,H");
  });

  it("names the failing job and step alongside the error lines", async () => {
    vi.useFakeTimers();
    stubActions(() => ({ id: 1, status: "completed", conclusion: "failure", html_url: "https://gh/run/1" }));
    const last = (await runWaiter(20_000)).at(-1);
    expect(last.phase).toBe("error");
    expect(last.error).toContain("Smoke test built game");
    expect(last.error).toContain("── error lines from the failing job ──");
  });

  it("still reports a failure when the log download fails — never a hang", async () => {
    vi.useFakeTimers();
    let poll = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/actions/workflows/deploy.yml/runs")) {
        poll++;
        return new Response(JSON.stringify({ workflow_runs: [{ id: 1, status: "completed", conclusion: "failure", html_url: "u" }] }), {
          status: 200,
        });
      }
      if (/\/actions\/runs\/\d+\/jobs/.test(url)) {
        return new Response(JSON.stringify({ jobs: [{ id: 555, name: "deploy", conclusion: "failure", steps: [] }] }), { status: 200 });
      }
      // Log endpoint is down.
      return new Response("nope", { status: 500 });
    }) as any;

    const last = (await runWaiter(20_000)).at(-1);
    expect(last.phase).toBe("error");
    expect(last.error).toContain("Deploy workflow failure");
    expect(poll).toBeGreaterThan(0);
  });

  it("reports 'never started' when no run appears before the ceiling", async () => {
    vi.useFakeTimers();
    stubActions(() => null); // no workflow_runs, ever
    const last = (await runWaiter(ACTIONS_DEPLOY_CEILING_MS + 20_000)).at(-1);
    expect(last.phase).toBe("error");
    expect(last.error).toMatch(/never started|no deploy workflow run/i);
  });

  it("stays calm when the run is still genuinely in progress at the ceiling", async () => {
    vi.useFakeTimers();
    stubActions(() => ({ id: 1, status: "in_progress", conclusion: null }));
    const last = (await runWaiter(ACTIONS_DEPLOY_CEILING_MS + 20_000)).at(-1);
    expect(last.phase).toBe("building");
  });
});
