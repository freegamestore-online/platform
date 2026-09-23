import { describe, expect, it } from "vitest";
import type { Env } from "./index";
import { compKeyFor, getActiveComp, grantComp, listComp, revokeComp } from "./keygrants";

/** In-memory D1 stub modeling the complimentary_grants table (PK user_id). */
function mockDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    prepare(sql: string) {
      return {
        run: async () => ({ success: true }), // schema DDL
        all: async () => ({ results: [...rows.values()] }),
        bind(...args: unknown[]) {
          return {
            run: async () => {
              if (sql.includes("INSERT INTO complimentary_grants")) {
                const [user_id, provider, model, granted_by, note, expires_at] = args;
                rows.set(String(user_id), {
                  user_id,
                  provider,
                  model,
                  granted_by,
                  note,
                  created_at: "2026-07-05 00:00:00",
                  expires_at,
                });
              } else if (sql.startsWith("DELETE")) {
                rows.delete(String(args[0]));
              }
              return { success: true };
            },
            first: async <T>() => (rows.get(String(args[0])) ?? null) as unknown as T,
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

const envWith = (extra: Record<string, unknown>): Env => ({ DB: mockDb(), ...extra }) as unknown as Env;

describe("compKeyFor", () => {
  it("reads the COMP_KEY_<PROVIDER> secret, trims, and treats blank as unset", () => {
    const env = envWith({ COMP_KEY_ANTHROPIC: "  sk-ant-123  ", COMP_KEY_OPENAI: "   " });
    expect(compKeyFor(env, "anthropic")).toBe("sk-ant-123");
    expect(compKeyFor(env, "openai")).toBeNull(); // blank → unset
    expect(compKeyFor(env, "google")).toBeNull(); // absent → unset
  });
});

describe("grant lifecycle", () => {
  it("grants, reads back the active grant, and revokes", async () => {
    const env = envWith({});
    await grantComp(env, { userId: "github:42", provider: "anthropic", model: "claude-opus-4-6", grantedBy: "admin" });
    const active = await getActiveComp(env, "github:42");
    expect(active?.provider).toBe("anthropic");
    expect(active?.model).toBe("claude-opus-4-6");
    expect((await listComp(env)).length).toBe(1);

    await revokeComp(env, "github:42");
    expect(await getActiveComp(env, "github:42")).toBeNull();
  });

  it("treats an expired grant as absent (and does not resolve)", async () => {
    const env = envWith({});
    await grantComp(env, {
      userId: "github:7",
      provider: "openai",
      model: "gpt-4o",
      grantedBy: "admin",
      expiresAt: "2000-01-01T00:00:00Z",
    });
    expect(await getActiveComp(env, "github:7")).toBeNull();
  });

  it("honors a future expiry", async () => {
    const env = envWith({});
    await grantComp(env, {
      userId: "github:9",
      provider: "google",
      model: "gemini-2.5-pro",
      grantedBy: "admin",
      expiresAt: "2999-01-01T00:00:00Z",
    });
    expect((await getActiveComp(env, "github:9"))?.provider).toBe("google");
  });
});
