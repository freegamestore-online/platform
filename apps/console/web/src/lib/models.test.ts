import { describe, it, expect } from "vitest";
import { MODEL_OPTIONS, firstModelFor, resolveModel } from "./models";

describe("firstModelFor", () => {
  it("returns the provider's first model", () => {
    expect(firstModelFor("anthropic")).toBe(MODEL_OPTIONS.anthropic![0]!.value);
    expect(firstModelFor("github")).toBe("openai/gpt-4.1");
  });
  it("falls back to a stable default for an unknown provider", () => {
    expect(firstModelFor("does-not-exist")).toBe("openai/gpt-4.1");
    expect(firstModelFor("")).toBe("openai/gpt-4.1");
  });
});

describe("resolveModel", () => {
  it("keeps a stored model that is valid for the provider", () => {
    expect(resolveModel("openrouter", "google/gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
  });
  it("ignores a stored model not offered by the provider", () => {
    // gemini isn't an anthropic option → fall back to the provider default.
    expect(resolveModel("anthropic", "google/gemini-2.5-pro")).toBe(firstModelFor("anthropic"));
  });
  it("uses the provider default when nothing is stored", () => {
    expect(resolveModel("openai", null)).toBe(firstModelFor("openai"));
  });
  it("falls back for an unknown provider", () => {
    expect(resolveModel("nope", null)).toBe("openai/gpt-4.1");
  });
});
