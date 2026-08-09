/**
 * Tests that useAgent.openGame / startFreshChat call reportError on genuine
 * failures and stay silent for OpenSupersededError.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock reportError to intercept calls without real network.
vi.mock("../lib/errorReporter", () => ({
  reportError: vi.fn(),
}));

// Stub useProjects so useAgent has a controlled delegate.
const mockOpenGame = vi.fn<(gameId: string) => Promise<string>>();
const mockStartFreshChat = vi.fn<(gameId: string) => Promise<string>>();

vi.mock("./useProjects", async (importOriginal) => {
  const original = await importOriginal<typeof import("./useProjects")>();
  return {
    ...original,
    useProjects: () => ({
      projects: [],
      currentId: null,
      loading: false,
      loadError: false,
      reload: vi.fn(),
      create: vi.fn(() => "new-id"),
      switchTo: vi.fn(),
      openGame: mockOpenGame,
      startFreshChat: mockStartFreshChat,
      rename: vi.fn(),
      markDeployed: vi.fn(),
      deleteProject: vi.fn(),
    }),
  };
});

import { useAgent } from "./useAgent";
import { reportError } from "../lib/errorReporter";
import { OpenSupersededError } from "./useProjects";

const mockReportError = reportError as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockReportError.mockClear();
  mockOpenGame.mockReset();
  mockStartFreshChat.mockReset();
});

afterEach(() => vi.restoreAllMocks());

async function mountedAgent() {
  const hook = renderHook(() => useAgent());
  await waitFor(() => expect(hook.result.current).toBeTruthy());
  return hook;
}

// ---- openGame ----

describe("useAgent.openGame — error reporting", () => {
  it("calls reportError with op:openGame when openGame throws a real error", async () => {
    mockOpenGame.mockRejectedValue(new Error('Couldn\'t load sessions before opening "bad-game"'));
    const { result } = await mountedAgent();

    await act(async () => {
      await result.current.openGame("bad-game");
    });

    expect(mockReportError).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const arg = mockReportError.mock.calls[0]![0] as { message: string; context: string };
    const ctx = JSON.parse(arg.context) as { op: string; gameId: string };
    expect(ctx.op).toBe("openGame");
    expect(ctx.gameId).toBe("bad-game");
    expect(arg.message).toMatch(/bad-game|session/);
  });

  it("does NOT call reportError for OpenSupersededError", async () => {
    mockOpenGame.mockRejectedValue(new OpenSupersededError("superseded"));
    const { result } = await mountedAgent();

    await act(async () => {
      await result.current.openGame("any-game");
    });

    expect(mockReportError).not.toHaveBeenCalled();
  });
});

// ---- startFreshChat ----

describe("useAgent.startFreshChat — error reporting", () => {
  it("calls reportError with op:startFreshChat when startFreshChat throws a real error", async () => {
    mockStartFreshChat.mockRejectedValue(new Error('Couldn\'t start a fresh chat for "stale-game" (500).'));
    const { result } = await mountedAgent();

    await act(async () => {
      await result.current.startFreshChat("stale-game");
    });

    expect(mockReportError).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const arg = mockReportError.mock.calls[0]![0] as { message: string; context: string };
    const ctx = JSON.parse(arg.context) as { op: string; gameId: string };
    expect(ctx.op).toBe("startFreshChat");
    expect(ctx.gameId).toBe("stale-game");
  });

  it("does NOT call reportError for OpenSupersededError in startFreshChat", async () => {
    mockStartFreshChat.mockRejectedValue(new OpenSupersededError("superseded"));
    const { result } = await mountedAgent();

    await act(async () => {
      await result.current.startFreshChat("any-game");
    });

    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("de-dupes concurrent calls for the same game — freshBusyRef guard prevents double-report", async () => {
    // startFreshChat returns null for a concurrent call to the same gameId
    // (freshBusyRef guard). No error is thrown → no reportError.
    let resolveFresh!: (id: string) => void;
    const deferredFresh = new Promise<string>((r) => { resolveFresh = r; });
    mockStartFreshChat.mockReturnValueOnce(deferredFresh);

    const { result } = await mountedAgent();

    // First call — held by deferred promise.
    act(() => { void result.current.startFreshChat("my-game"); });
    // Second call for the SAME game — freshBusyRef guard returns null immediately.
    await act(async () => { await result.current.startFreshChat("my-game"); });

    // Resolve the first call successfully.
    await act(async () => { resolveFresh("session-id"); });

    expect(mockReportError).not.toHaveBeenCalled();
  });
});
