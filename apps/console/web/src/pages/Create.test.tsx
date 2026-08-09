import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Project } from "../hooks/useProjects";

// Shared, mutable mock state (hoisted so the vi.mock factory can close over it).
const h = vi.hoisted(() => ({
  agent: null as unknown as Record<string, unknown>,
  openGame: vi.fn<(id: string) => Promise<string | null>>(),
  switchProject: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { sub: "github:1" }, loading: false, signIn: vi.fn() }),
}));
vi.mock("../hooks/useKeys", () => ({
  useKeys: () => ({
    hasKey: () => true,
    providerUsable: () => true,
    loading: false,
    providers: new Set<string>(),
    saveKey: vi.fn(),
    removeKey: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("../hooks/useAgent", () => ({ useAgent: () => h.agent }));

import { Create } from "./Create";

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    projects: [] as Project[],
    currentProjectId: null,
    projectsLoading: false,
    projectsError: false,
    isStreaming: false,
    messages: [],
    deployState: null,
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    visibleCount: 20,
    openGame: h.openGame,
    switchProject: h.switchProject,
    startFreshChat: vi.fn(),
    deleteProject: vi.fn(),
    reloadProjects: vi.fn(),
    loadHistory: vi.fn(),
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
    showEarlier: vi.fn(),
    ...overrides,
  };
}

const gameA: Project = {
  id: "sess-a",
  name: "Game A",
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: "game-a",
  appUrl: "https://game-a.freegamestore.online",
};

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Loc />
      <Link to="/create/beat-star2" data-testid="retry">retry</Link>
      <Routes>
        <Route path="/create/:id" element={<Create />} />
        <Route path="/create" element={<Create />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.openGame.mockReset();
  h.switchProject.mockReset();
});
afterEach(cleanup);

describe("Create — opening a game via /create/:id", () => {
  it("attempts to open the game named in the path", async () => {
    h.openGame.mockResolvedValue("sess-new");
    h.agent = makeAgent({ projects: [gameA], currentProjectId: "sess-a" });
    renderAt("/create/beat-star2");
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith("beat-star2"));
  });

  it("FIX: a failed open reverts the URL to the game that's actually open (no silent mismatch)", async () => {
    // beat-star2 can't be opened (404/403). Before the fix the address bar stayed
    // on /create/beat-star2 while the studio still showed game-a — so the next
    // prompt would have edited game-a. The URL must snap back to game-a.
    h.openGame.mockResolvedValue(null);
    h.agent = makeAgent({ projects: [gameA], currentProjectId: "sess-a" });
    renderAt("/create/beat-star2");
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith("beat-star2"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/create/game-a"));
  });

  it("FIX: after a failed open, selecting the same game again RETRIES (latch not stuck)", async () => {
    h.openGame.mockResolvedValue(null);
    h.agent = makeAgent({ projects: [gameA], currentProjectId: "sess-a" });
    renderAt("/create/beat-star2");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/create/game-a"));
    expect(h.openGame).toHaveBeenCalledTimes(1);

    // Re-navigate to the same failed game (as clicking it again in My Games would).
    fireEvent.click(screen.getByTestId("retry"));
    await waitFor(() => expect(h.openGame).toHaveBeenCalledTimes(2));
  });

  it("no regression: a SUCCESSFUL open does not revert the URL", async () => {
    h.openGame.mockResolvedValue("sess-new");
    h.agent = makeAgent({ projects: [gameA], currentProjectId: "sess-a" });
    renderAt("/create/beat-star2");
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith("beat-star2"));
    // Give any errant navigation a chance to run, then assert we stayed put.
    await Promise.resolve();
    expect(screen.getByTestId("loc").textContent).toBe("/create/beat-star2");
  });
});
