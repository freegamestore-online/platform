import { describe, it, expect } from "vitest";

describe("admin worker", () => {
  it("exports a default fetch handler", async () => {
    const mod = await import("./index");
    expect(typeof mod.default.fetch).toBe("function");
  });
});
