import { describe, it, expect } from "vitest";
import { deriveActivity } from "./activity";

const tool = (content: string) => ({ role: "tool", content });

describe("deriveActivity", () => {
  it("is Ready when idle with no deploy", () => {
    expect(deriveActivity(false, null, []).label).toBe("Ready");
    expect(deriveActivity(false, null, []).busy).toBe(false);
  });

  it("reports the active deploy phase, even over streaming", () => {
    expect(deriveActivity(true, { phase: "provisioning" }, []).label).toBe("Provisioning");
    expect(deriveActivity(true, { phase: "pushing" }, []).label).toBe("Pushing code");
    expect(deriveActivity(true, { phase: "building" }, []).label).toBe("Building & deploying");
  });

  it("shows the building hint as detail (not an error)", () => {
    const a = deriveActivity(false, { phase: "building", hint: "Still building — reload to check." }, []);
    expect(a.label).toBe("Building & deploying");
    expect(a.detail).toBe("Still building — reload to check.");
    expect(a.tone).toBe("busy");
  });

  it("distinguishes coding sub-activities from the last tool", () => {
    expect(deriveActivity(true, null, [tool("Running compliance checks...")]).label).toBe("Checking compliance");
    expect(deriveActivity(true, null, [tool("Writing web/src/App.tsx")]).label).toBe("Writing code");
    expect(deriveActivity(true, null, [tool("Deploying: Beat Star...")]).label).toBe("Deploying");
    expect(deriveActivity(true, null, [tool("Reading web/src/App.tsx")]).label).toBe("Writing code");
  });

  it("falls back to Coding while streaming with no informative tool", () => {
    expect(deriveActivity(true, null, []).label).toBe("Coding");
    expect(deriveActivity(true, null, [{ role: "assistant", content: "thinking" }]).label).toBe("Coding");
  });

  it("a new streaming turn takes precedence over a stale terminal phase", () => {
    // Deployed live, then user sends a new message → we're coding again, not "Live".
    expect(deriveActivity(true, { phase: "live" }, [tool("Writing web/src/App.tsx")]).label).toBe("Writing code");
  });

  it("terminal phases show when idle", () => {
    expect(deriveActivity(false, { phase: "live" }, []).label).toBe("Live");
    expect(deriveActivity(false, { phase: "live" }, []).tone).toBe("ok");
    const err = deriveActivity(false, { phase: "error", error: "boom" }, []);
    expect(err.label).toBe("Deploy failed");
    expect(err.detail).toBe("boom");
    expect(err.tone).toBe("error");
  });
});
