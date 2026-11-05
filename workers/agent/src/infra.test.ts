import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { getAuditResults } from "./infra";

const config = getConfig("games");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getAuditResults", () => {
  it("formats audit summary from the per-app summary array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          summary: [{ appId: "chess", store: "games", pass: 5, warn: 1, fail: 0, checkedAt: 1 }],
          checks: [
            { appId: "chess", store: "games", checkName: "Reachable", status: "pass", detail: null, checkedAt: 1 },
            { appId: "chess", store: "games", checkName: "Bundle size (live)", status: "warn", detail: "big", checkedAt: 1 },
          ],
          total: 6,
        }),
    }) as any;
    const result = await getAuditResults("chess", config);
    expect(result).toContain("Audit for chess: 5 pass, 1 warn, 0 fail");
    expect(result).toContain("PASS: Reachable");
    expect(result).toContain("WARN: Bundle size (live) — big");
    expect(result).toContain("showing 2 of 6 checks");
    expect(result).not.toContain("undefined");
  });

  it("falls back to raw JSON when the game has no audit rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ summary: [], checks: [], total: 0 }),
    }) as any;
    const result = await getAuditResults("chess", config);
    expect(result).toContain('"total": 0');
  });

  it("handles API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const result = await getAuditResults("chess", config);
    expect(result).toContain("500");
    expect(result).toContain("game may not have been audited yet");
  });

  it("queries the FAS audit API with the store filter for both stores", async () => {
    // There is no api.freegamestore.online — that host is workers/host and
    // 404s "no game registered". Both stores' audit rows live in the FAS
    // backend's multi-store table (#431).
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          summary: [{ appId: "chess", store: "games", pass: 5, warn: 0, fail: 0, checkedAt: 1 }],
          checks: [],
          total: 0,
        }),
    });
    globalThis.fetch = fetchMock as any;

    const result = await getAuditResults("chess", config);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.freeappstore.online/v1/audit?store=games&app=chess");
    expect(result).toContain("Audit for chess: 5 pass, 0 warn, 0 fail");

    await getAuditResults("timer", getConfig("apps"));
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.freeappstore.online/v1/audit?store=apps&app=timer");
  });
});
