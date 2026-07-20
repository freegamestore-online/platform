import { describe, it, expect, beforeEach } from "vitest";
import { buildInitialPrompt, clearInitialBuild, isInitialBuildDeployTerminal, queueInitialBuild, readInitialBuild } from "./initialBuild";

describe("initial build queue", () => {
  beforeEach(() => localStorage.clear());

  it("uses the explicit first prompt when provided", () => {
    expect(buildInitialPrompt({
      gameName: "Bird Drop",
      gameId: "bird-drop",
      category: "arcade",
      buildPrompt: "Make a slingshot bird game with three levels.",
      description: "ignored",
    })).toBe("Make a slingshot bird game with three levels.");
  });

  it("builds a useful fallback prompt from create fields", () => {
    const prompt = buildInitialPrompt({
      gameName: "Bird Drop",
      gameId: "bird-drop",
      category: "arcade",
      description: "Birds knock down towers",
      template: "kaplay",
    });
    expect(prompt).toContain("Build the first playable version of Bird Drop.");
    expect(prompt).toContain("Birds knock down towers");
    expect(prompt).toContain("kaplay");
    expect(prompt).toContain("deploy");
  });

  it("queues, reads, and clears a prompt by game id", () => {
    queueInitialBuild("bird-drop", "Build it now");
    expect(readInitialBuild("bird-drop")?.prompt).toBe("Build it now");
    clearInitialBuild("bird-drop");
    expect(readInitialBuild("bird-drop")).toBeNull();
  });

  it("only treats completed agent deploy phases as terminal for a queued first build", () => {
    expect(isInitialBuildDeployTerminal(undefined)).toBe(false);
    expect(isInitialBuildDeployTerminal(null)).toBe(false);
    expect(isInitialBuildDeployTerminal("provisioning")).toBe(false);
    expect(isInitialBuildDeployTerminal("building")).toBe(false);
    expect(isInitialBuildDeployTerminal("pushing")).toBe(false);
    expect(isInitialBuildDeployTerminal("live")).toBe(true);
    expect(isInitialBuildDeployTerminal("error")).toBe(true);
  });
});
