import { describe, expect, it, vi } from "vitest";
import { TurnOrchestrator } from "./turn-orchestrator";

describe("TurnOrchestrator", () => {
  it("continues read/failed-deploy rounds from the persisted transcript", async () => {
    const round = vi
      .fn()
      .mockResolvedValueOnce({ hasInfraRequests: true, successfulDeploy: false })
      .mockResolvedValueOnce({ hasInfraRequests: false, successfulDeploy: false });
    await new TurnOrchestrator().run("build it", round);
    expect(round).toHaveBeenNthCalledWith(1, "build it", 0);
    expect(round).toHaveBeenNthCalledWith(2, null, 1);
  });

  it("stops after a successful deploy rather than invoking another provider round", async () => {
    const round = vi.fn().mockResolvedValue({ hasInfraRequests: true, successfulDeploy: true });
    await new TurnOrchestrator().run("deploy", round);
    expect(round).toHaveBeenCalledOnce();
  });

  it("enforces the injected infrastructure-round budget", async () => {
    const round = vi.fn().mockResolvedValue({ hasInfraRequests: true, successfulDeploy: false });
    await new TurnOrchestrator({ maxInfraRounds: 2 }).run("inspect", round);
    expect(round).toHaveBeenCalledTimes(2);
  });
});
