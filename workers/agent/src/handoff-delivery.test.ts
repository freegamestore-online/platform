import { describe, expect, it, vi } from "vitest";
import agentWorker from "./index";

// #450: the Studio POSTs the agent handoff in a form body, so it is never in a URL.

const CONSOLE = "https://console.freegamestore.online";
type Env = Parameters<typeof agentWorker.fetch>[1];

function setup() {
  const consume = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ token: "agent.session.jwt" }));
  const env = { STORE: "games", AUTH: { fetch: consume } } as unknown as Env;
  const call = (origin: string | undefined, fields: Record<string, string>) =>
    agentWorker.fetch(
      new Request("https://agent.freegamestore.online/auth/handoff", {
        method: "POST",
        headers: origin ? { Origin: origin } : {},
        body: new URLSearchParams(fields),
      }),
      env,
      {} as ExecutionContext,
    );
  return { consume, call };
}

describe("agent /auth/handoff delivery", () => {
  it("takes the handoff from a POST body sent by the console and sets the agent cookie", async () => {
    const { consume, call } = setup();
    const res = await call(CONSOLE, { token: "handoff.jwt" });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("__Host-fgs_token=agent.session.jwt");
    expect((consume.mock.calls[0]![1].headers as Record<string, string>)["X-FGS-Handoff"]).toBe("handoff.jwt");
  });

  it("refuses a POST from a game page or from nowhere", async () => {
    for (const origin of ["https://evil.freegamestore.online", undefined]) {
      const { consume, call } = setup();
      expect((await call(origin, { token: "handoff.jwt" })).status).toBe(400);
      expect(consume).not.toHaveBeenCalled();
    }
  });
});
