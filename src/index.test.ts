import { describe, it, expect } from "vitest";
import { computeIndex, REFERENCE } from "./index.ts";

describe("src/index re-exports", () => {
  it("exports REFERENCE with 12 viewports", () => {
    expect(REFERENCE).toHaveLength(12);
  });

  it("exports computeIndex as a function", () => {
    expect(typeof computeIndex).toBe("function");
  });

  it("computeIndex returns 0 for empty passing set", () => {
    expect(computeIndex(new Set())).toBe(0);
  });
});
