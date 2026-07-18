import { describe, it, expect, beforeEach } from "vitest";
import {
  PROVIDERS,
  isFreeProvider,
  resolveInitialProvider,
  readLegacyLocalKeys,
  writeLegacyLocalKeys,
  clearLegacyLocalKeys,
} from "./ai-keys";
import { MODEL_OPTIONS } from "./models";

describe("PROVIDERS", () => {
  it("has at least one provider", () => {
    expect(PROVIDERS.length).toBeGreaterThan(0);
  });

  it("each provider has required fields", () => {
    for (const p of PROVIDERS) {
      expect(typeof p.type).toBe("string");
      expect(typeof p.name).toBe("string");
    }
  });

  it("each provider has models in MODEL_OPTIONS (single source of truth)", () => {
    for (const p of PROVIDERS) {
      expect(Array.isArray(MODEL_OPTIONS[p.type])).toBe(true);
      expect(MODEL_OPTIONS[p.type]!.length).toBeGreaterThan(0);
    }
  });

  it("github provider is free", () => {
    const github = PROVIDERS.find((p) => p.type === "github");
    expect(github).toBeDefined();
    expect(github!.free).toBe(true);
  });
});

describe("isFreeProvider", () => {
  it("is true only for GitHub Models", () => {
    expect(isFreeProvider("github")).toBe(true);
    expect(isFreeProvider("openrouter")).toBe(false);
    expect(isFreeProvider("anthropic")).toBe(false);
    expect(isFreeProvider("unknown")).toBe(false);
  });
});

describe("resolveInitialProvider", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the free GitHub Models tier when nothing stored", () => {
    expect(resolveInitialProvider()).toBe("github");
  });

  it("honors a valid stored preference", () => {
    localStorage.setItem("fgs_provider", "openai");
    expect(resolveInitialProvider()).toBe("openai");
  });

  it("ignores an unknown stored preference", () => {
    localStorage.setItem("fgs_provider", "not-a-provider");
    expect(resolveInitialProvider()).toBe("github");
  });
});

describe("legacy localStorage key migration", () => {
  beforeEach(() => localStorage.clear());

  it("reads legacy plaintext keys so they can be migrated", () => {
    localStorage.setItem("fgs_ai_keys", JSON.stringify({ openrouter: "sk-or-v1-legacy" }));
    expect(readLegacyLocalKeys()).toEqual({ openrouter: "sk-or-v1-legacy" });
  });

  it("returns empty object when no legacy keys / corrupt JSON", () => {
    expect(readLegacyLocalKeys()).toEqual({});
    localStorage.setItem("fgs_ai_keys", "{not json");
    expect(readLegacyLocalKeys()).toEqual({});
  });

  it("clearLegacyLocalKeys wipes the plaintext blob from the browser", () => {
    localStorage.setItem("fgs_ai_keys", JSON.stringify({ openrouter: "sk-or-v1-legacy" }));
    clearLegacyLocalKeys();
    expect(localStorage.getItem("fgs_ai_keys")).toBeNull();
    expect(readLegacyLocalKeys()).toEqual({});
  });

  it("writeLegacyLocalKeys keeps only providers that still need migration", () => {
    writeLegacyLocalKeys({ openrouter: "sk-or-v1-legacy", openai: "" });
    expect(readLegacyLocalKeys()).toEqual({ openrouter: "sk-or-v1-legacy" });
    writeLegacyLocalKeys({});
    expect(localStorage.getItem("fgs_ai_keys")).toBeNull();
  });

  it("scopes failed migration retries to the signed-in user", () => {
    localStorage.setItem("fgs_ai_keys", JSON.stringify({ openrouter: "sk-or-v1-legacy" }));

    expect(readLegacyLocalKeys("github:1")).toEqual({ openrouter: "sk-or-v1-legacy" });
    writeLegacyLocalKeys({ openrouter: "sk-or-v1-legacy" }, "github:1");

    expect(localStorage.getItem("fgs_ai_keys")).toBeNull();
    expect(readLegacyLocalKeys("github:1")).toEqual({ openrouter: "sk-or-v1-legacy" });
    expect(readLegacyLocalKeys("github:2")).toEqual({});
  });

  it("clears both scoped and legacy global plaintext keys for a user", () => {
    writeLegacyLocalKeys({ openrouter: "sk-or-v1-scoped" }, "github:1");
    localStorage.setItem("fgs_ai_keys", JSON.stringify({ openai: "sk-global" }));

    clearLegacyLocalKeys("github:1");

    expect(readLegacyLocalKeys("github:1")).toEqual({});
    expect(localStorage.getItem("fgs_ai_keys")).toBeNull();
  });
});
