import { describe, it, expect } from "vitest";
import { mapServerSession, toDrafts, type ServerSession } from "./sessions";

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
