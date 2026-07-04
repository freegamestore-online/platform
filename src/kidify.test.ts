import { describe, expect, it } from "vitest";
import { buildKidPrompt } from "./kidify";

describe("buildKidPrompt", () => {
  it("reflects the chosen age band", () => {
    expect(buildKidPrompt("5", "funny")).toContain("5-to-7-year-old");
    expect(buildKidPrompt("11", "funny")).toContain("11-to-13-year-old");
  });

  it("reflects the chosen vibe", () => {
    expect(buildKidPrompt("8", "adventure")).toContain("adventure");
    expect(buildKidPrompt("8", "chill")).toContain("encouraging");
  });

  it("falls back to sane defaults for unknown age/vibe", () => {
    const p = buildKidPrompt("999", "banana");
    expect(p).toContain("8-to-10-year-old"); // default age
    expect(p).toContain("slip in a small joke"); // default vibe (funny)
  });

  it("always forbids markdown/code and invented features", () => {
    const p = buildKidPrompt("8", "silly");
    expect(p).toContain("No lists, no code, no markdown");
    expect(p).toContain("Never invent features");
  });
});
