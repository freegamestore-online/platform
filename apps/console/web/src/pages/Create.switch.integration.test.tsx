import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// FAITHFUL integration test for game switching: renders the REAL <Create> with
// the REAL useAgent + useProjects hooks (only useAuth/useKeys/fetch are mocked).
// The unit tests in Create.test.tsx mock useAgent wholesale, so they could not
// catch the switch/URL reconciliation race in issue #6 — this file exists so that
// class of bug is covered end-to-end.
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { sub: "github:1", github: "alice" }, loading: false, signIn: vi.fn() }),
}));
vi.mock("../hooks/useKeys", () => ({
  useKeys: () => ({
    hasKey: () => true, providerUsable: () => true, loading: false,
    providers: new Set<string>(), saveKey: vi.fn(), removeKey: vi.fn(), refresh: vi.fn(),
  }),
}));

import { Create } from "./Create";

function srv(id: string, name: string, gameId: string) {
  return { id, name, gameId, gameUrl: `https://${gameId}.freegamestore.online`, deployed: true, createdAt: new Date(0).toISOString() };
}
const SESSIONS = [srv("sess-os", "Ocean Save", "ocean-save"), srv("sess-y", "Game Y", "game-y")];

const CALLS: string[] = [];
beforeEach(() => {
  localStorage.clear();
  CALLS.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method || "GET").toUpperCase();
    CALLS.push(`${method} ${url.replace("https://agent.freegamestore.online", "")}${init?.body ? " " + (init.body as string) : ""}`);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as Response);
    if (url.endsWith("/sessions") && method === "GET") return ok({ sessions: SESSIONS });
    if (url.includes("/import") && method === "POST") {
      const id = JSON.parse((init?.body as string) || "{}").id as string;
      return ok({ ok: true, id, name: id === "ocean-save" ? "Ocean Save" : "Game Y", appUrl: `https://${id}.freegamestore.online` });
    }
    if (url.includes("/history")) return ok({ messages: [] });
    if (url.includes("/sessions/") && (method === "PUT" || method === "DELETE")) return ok({ ok: true });
    return ok({});
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

function Loc() { return <div data-testid="loc">{useLocation().pathname}</div>; }
function renderAt(path: string, extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Loc />
      {extra}
      <Routes>
        <Route path="/create/:id" element={<Create />} />
        <Route path="/create" element={<Create />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Create — switching games (real hooks)", () => {
  it("REGRESSION #6: picking a game in the selector keeps URL and shown game in sync (no flick-back)", async () => {
    renderAt("/create/ocean-save");
    await waitFor(() => expect(screen.getByTitle("Switch game").textContent).toContain("Ocean Save"), { timeout: 3000 });
    expect(screen.getByTestId("loc").textContent).toBe("/create/ocean-save");

    CALLS.length = 0; // only inspect calls made during/after the switch
    fireEvent.click(screen.getByTitle("Switch game"));
    await waitFor(() => expect(screen.getByText("Game Y")).toBeTruthy());
    fireEvent.click(screen.getByText("Game Y"));

    // Let all effects + async settle, then require the switch to have STUCK.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTitle(/Switch game|Loading game/).textContent).toContain("Game Y");
    expect(screen.getByTestId("loc").textContent).toBe("/create/game-y");
    // The previous game must NOT have been re-opened mid-switch.
    expect(CALLS.some((c) => c.includes("/import") && c.includes("ocean-save"))).toBe(false);
  });

  it("does not break external navigation: a URL change to another game still opens it", async () => {
    renderAt("/create/ocean-save", <Link to="/create/game-y" data-testid="go">go</Link>);
    await waitFor(() => expect(screen.getByTitle("Switch game").textContent).toContain("Ocean Save"), { timeout: 3000 });

    fireEvent.click(screen.getByTestId("go")); // external URL change (like a My Games link)
    await waitFor(() => expect(screen.getByTitle(/Switch game|Loading game/).textContent).toContain("Game Y"), { timeout: 3000 });
    expect(screen.getByTestId("loc").textContent).toBe("/create/game-y");
  });
});
