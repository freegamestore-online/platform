import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_auth", () => ({
  resolveCreator: vi.fn(),
  corsHeaders: () => ({}),
}));
vi.mock("./_errlog", () => ({
  recordError: vi.fn(),
}));

import { onRequestPost } from "./client-error";
import { resolveCreator } from "./_auth";
import { recordError } from "./_errlog";

const mResolveCreator = vi.mocked(resolveCreator);
const mRecordError = vi.mocked(recordError);

type Ctx = Parameters<typeof onRequestPost>[0];

function makeCtx(body: Record<string, unknown>, ip = "1.2.3.4"): Ctx {
  const request = new Request("https://console.freegamestore.online/api/client-error", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      Cookie: "fgs_token=abc",
    },
    body: JSON.stringify(body),
  });
  const env = {
    SESSIONS: {},
    DB: {} as D1Database,
  };
  return { request, env } as unknown as Ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mRecordError.mockResolvedValue(undefined);
});

describe("client-error onRequestPost", () => {
  it("returns 200 and inserts into error_log for an authenticated user", async () => {
    mResolveCreator.mockResolvedValue("alice");

    const res = await onRequestPost(
      makeCtx({
        route: "/create/my-game",
        message: "Something broke",
        stack: "Error: Something broke\n  at foo (bar.js:1:1)",
        context: "window.onerror",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    expect(mRecordError).toHaveBeenCalledOnce();
    const [, row] = mRecordError.mock.calls[0];
    expect(row.source).toBe("console/web");
    expect(row.user).toBe("alice");
    expect(row.message).toBe("Something broke");
    expect(row.stack).toContain("Error: Something broke");
    expect(row.context).toContain("route=/create/my-game");
  });

  it("records without a user (unauthenticated) — session null maps to null", async () => {
    mResolveCreator.mockResolvedValue(null);

    const res = await onRequestPost(
      makeCtx({ message: "anonymous crash", route: "/" }),
    );

    expect(res.status).toBe(200);
    const [, row] = mRecordError.mock.calls[0];
    expect(row.user).toBeNull();
    expect(row.source).toBe("console/web");
  });

  it("caps message at 2000 chars and stack at 4000 chars", async () => {
    mResolveCreator.mockResolvedValue(null);

    const longMessage = "x".repeat(5000);
    const longStack = "s".repeat(10000);

    await onRequestPost(makeCtx({ message: longMessage, stack: longStack }));

    const [, row] = mRecordError.mock.calls[0];
    expect(row.message.length).toBe(2000);
    expect((row.stack ?? "").length).toBe(4000);
  });

  it("returns 400 for non-JSON body", async () => {
    mResolveCreator.mockResolvedValue(null);
    const request = new Request("https://console.freegamestore.online/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "CF-Connecting-IP": "1.2.3.4" },
      body: "not json",
    });
    const env = { SESSIONS: {}, DB: {} as D1Database };
    const ctx = { request, env } as unknown as Ctx;

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect(mRecordError).not.toHaveBeenCalled();
  });

  it("uses 'unknown error' when message is missing", async () => {
    mResolveCreator.mockResolvedValue("bob");

    await onRequestPost(makeCtx({ route: "/create" }));

    const [, row] = mRecordError.mock.calls[0];
    expect(row.message).toBe("unknown error");
  });

  it("server-side identity wins — ignores any client-supplied identity fields", async () => {
    // The client has no say in which user is recorded.
    mResolveCreator.mockResolvedValue("trusteduser");

    await onRequestPost(
      makeCtx({ message: "crash", user: "attacker", login: "evil" }),
    );

    const [, row] = mRecordError.mock.calls[0];
    expect(row.user).toBe("trusteduser");
  });
});
