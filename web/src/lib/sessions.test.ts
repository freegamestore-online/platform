import { describe, it, expect } from "vitest";
import { formatTokens, mapServerSession, toDrafts, type ServerSession } from "./sessions";

const NOW = Date.UTC(2026, 6, 3, 12, 0, 0); // fixed clock for determinism

function session(over: Partial<ServerSession> = {}): ServerSession {
  return { id: "s1", name: "My Game", deployed: false, createdAt: "2026-06-29 21:26:52", ...over };
}

describe("mapServerSession", () => {
  it("maps gameId/gameUrl to appId/appUrl and parses the D1 date", () => {
    const p = mapServerSession(session({ gameId: "snake", gameUrl: "https://snake.freegamestore.online", deployed: true }), NOW);
    expect(p.appId).toBe("snake");
    expect(p.appUrl).toBe("https://snake.freegamestore.online");
    expect(p.deployed).toBe(true);
    expect(p.createdAt).toBe(new Date(Date.parse("2026-06-29 21:26:52")).toISOString());
    expect(Number.isNaN(p.updatedAt)).toBe(false);
  });

  it("falls back to the injected now for an unparseable date (never NaN)", () => {
    const p = mapServerSession(session({ createdAt: "not-a-date" }), NOW);
    expect(p.updatedAt).toBe(NOW);
    expect(p.createdAt).toBe(new Date(NOW).toISOString());
  });

  it("names an untitled session 'Untitled'", () => {
    expect(mapServerSession(session({ name: "" }), NOW).name).toBe("Untitled");
  });

  it("carries token usage through when present", () => {
    const p = mapServerSession(session({ tokens: { input: 100, output: 40 } }), NOW);
    expect(p.tokens).toEqual({ input: 100, output: 40 });
  });
});

describe("formatTokens", () => {
  it("passes small counts through and compacts thousands/millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-3)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(45678)).toBe("46k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("toDrafts", () => {
  it("keeps only undeployed sessions", () => {
    const drafts = toDrafts([
      session({ id: "a", deployed: false }),
      session({ id: "b", deployed: true, gameId: "snake" }),
      session({ id: "c", deployed: false }),
    ]);
    expect(drafts.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("returns [] when everything is deployed", () => {
    expect(toDrafts([session({ deployed: true }), session({ deployed: true })])).toEqual([]);
  });

  it("defaults a missing title to 'Untitled'", () => {
    expect(toDrafts([session({ name: "" })])[0]!.name).toBe("Untitled");
  });
});
