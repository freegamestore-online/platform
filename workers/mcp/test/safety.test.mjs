// MCP safety-layer tests. Two halves:
//   1. Behavioral — import the real safety.ts (Node 22 strips types on import)
//      and exercise read-only, confirmation, dry-run, audit, and redaction.
//   2. Surface — read index.ts / server.json / wrangler.toml as text and assert
//      the safety layer is actually wired into every write/destructive tool and
//      the manifests stay in sync. Mirrors the sibling stores' MCP test style.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (p) => readFile(resolve(root, p), "utf8");

const {
  isReadOnly,
  requireWritable,
  requireConfirmation,
  dryRun,
  audit,
  listAuditEvents,
} = await import(resolve(root, "src/safety.ts"));

// Minimal in-memory KVNamespace stand-in (put/get/list with prefix + limit).
function fakeKV() {
  const store = new Map();
  return {
    _store: store,
    async put(key, val) { store.set(key, val); },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async list({ prefix = "", limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name }));
      return { keys };
    },
  };
}

// -- behavioral --

test("isReadOnly reflects MCP_READ_ONLY=1 only", () => {
  assert.equal(isReadOnly({ MCP_READ_ONLY: "1" }), true);
  assert.equal(isReadOnly({ MCP_READ_ONLY: "0" }), false);
  assert.equal(isReadOnly({}), false);
});

test("requireWritable blocks + audits in read-only mode, passes otherwise", async () => {
  const kv = fakeKV();
  const ro = { env: { OAUTH_KV: kv, MCP_READ_ONLY: "1" }, subject: "alice" };
  const blocked = await requireWritable(ro, "update_files", { game_id: "chess" });
  assert.ok(blocked, "expected a block result");
  assert.equal(blocked.isError, true);
  const events = await listAuditEvents(ro, 10);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "denied");
  assert.equal(events[0].reason, "read_only");

  const open = { env: { OAUTH_KV: fakeKV(), MCP_READ_ONLY: "0" }, subject: "alice" };
  assert.equal(await requireWritable(open, "update_files", {}), null);
});

test("requireConfirmation requires the exact token", async () => {
  const ctx = { env: { OAUTH_KV: fakeKV() }, subject: "alice" };
  assert.equal(await requireConfirmation(ctx, "delete_game", "chess", "chess", { game_id: "chess" }), null);
  const bad = await requireConfirmation(ctx, "delete_game", undefined, "chess", { game_id: "chess" });
  assert.ok(bad);
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /confirm="chess"/);
});

test("dryRun previews without an isError flag and audits the attempt", async () => {
  const kv = fakeKV();
  const ctx = { env: { OAUTH_KV: kv }, subject: "alice" };
  const res = await dryRun(ctx, "create_game", "provision", { game_id: "pong" }, { wouldCreate: ["repo"] });
  assert.notEqual(res.isError, true);
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.dryRun, true);
  assert.equal(body.tool, "create_game");
  assert.deepEqual(body.wouldDo, { wouldCreate: ["repo"] });
  const events = await listAuditEvents(ctx, 10);
  assert.equal(events[0].action, "dry_run");
});

test("audit is a no-op for anonymous callers and unbound KV", async () => {
  const anon = { env: { OAUTH_KV: fakeKV() } }; // no subject
  await audit(anon, { tool: "x", action: "success" });
  assert.deepEqual(await listAuditEvents(anon, 10), []);
  const noKv = { env: {}, subject: "alice" };
  await audit(noKv, { tool: "x", action: "success" });
  assert.deepEqual(await listAuditEvents(noKv, 10), []);
});

test("audit redacts secrets by key name AND value shape", async () => {
  const kv = fakeKV();
  const ctx = { env: { OAUTH_KV: kv }, subject: "alice" };
  await audit(ctx, {
    tool: "agent_build",
    action: "success",
    input: {
      api_key: "sk-ant-secretsecretsecret1234",   // secret-shaped VALUE under a secret NAME
      prompt: "leak? ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa here", // secret-shaped value under an innocent name
      game_id: "chess",
    },
  });
  const raw = JSON.stringify(await listAuditEvents(ctx, 10));
  assert.doesNotMatch(raw, /sk-ant-secretsecret/);
  assert.doesNotMatch(raw, /ghp_aaaaaaaaaa/);
  assert.match(raw, /\[redacted\]/);
  assert.match(raw, /"game_id":"chess"/); // non-secret fields survive
});

test("listAuditEvents caps the returned count", async () => {
  const kv = fakeKV();
  const ctx = { env: { OAUTH_KV: kv }, subject: "alice" };
  for (let i = 0; i < 5; i++) await audit(ctx, { tool: "update_files", action: "success", n: i });
  assert.equal((await listAuditEvents(ctx, 2)).length, 2);
  assert.equal((await listAuditEvents(ctx, 50)).length, 5);
});

// -- surface: safety.ts contents --

test("safety.ts exports the full primitive set with redaction + 90-day TTL", async () => {
  const s = await read("src/safety.ts");
  assert.match(s, /MCP_READ_ONLY/);
  assert.match(s, /export function isReadOnly/);
  assert.match(s, /export async function requireWritable/);
  assert.match(s, /export async function requireConfirmation/);
  assert.match(s, /export async function dryRun/);
  assert.match(s, /export async function audit/);
  assert.match(s, /export async function listAuditEvents/);
  assert.match(s, /token\|secret\|password\|credential\|authorization/);
  assert.match(s, /api\[_-\]\?key/); // value/key redaction covers caller-supplied api_key
  assert.match(s, /expirationTtl: 90 \* 86_400/);
});

// -- surface: index.ts wiring --

const WRITE_TOOLS = ["create_game", "update_files", "agent_build", "edit_game", "admin_send_prompt", "delete_game", "discard_session"];
const DESTRUCTIVE_TOOLS = ["delete_game", "discard_session"];
const DRY_RUN_TOOLS = ["create_game", "update_files", "agent_build", "delete_game", "discard_session"];

test("every write + destructive tool is gated by requireWritable", async () => {
  const src = await read("src/index.ts");
  for (const tool of WRITE_TOOLS) {
    assert.match(src, new RegExp(`requireWritable\\(this\\.safety\\(\\), "${tool}"`), `${tool} missing read-only guard`);
  }
});

test("destructive tools require confirmation; dry-run tools offer dry_run", async () => {
  const src = await read("src/index.ts");
  for (const tool of DESTRUCTIVE_TOOLS) {
    assert.match(src, new RegExp(`requireConfirmation\\(this\\.safety\\(\\), "${tool}"`), `${tool} missing confirmation`);
  }
  for (const tool of DRY_RUN_TOOLS) {
    assert.match(src, new RegExp(`dryRun\\(this\\.safety\\(\\), "${tool}"`), `${tool} missing dry_run`);
  }
});

test("errText carries isError, and mcp_audit_log is exposed", async () => {
  const src = await read("src/index.ts");
  assert.match(src, /const errText = .*isError: true/);
  assert.match(src, /"mcp_audit_log"/);
  assert.match(src, /listAuditEvents\(this\.safety\(\)/);
  assert.match(src, /audit\(this\.safety\(\), \{ tool: "create_game", action: "success"/);
});

// -- surface: manifest consistency --

test("server.json tool set exactly matches the tools registered in index.ts", async () => {
  const manifest = JSON.parse(await read("server.json"));
  const src = await read("src/index.ts");
  const registered = [...src.matchAll(/this\.safeTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const declared = manifest.tools.map((t) => t.name).sort();
  assert.deepEqual(declared, registered);
  assert.ok(declared.includes("mcp_audit_log"), "mcp_audit_log must be advertised");
  assert.ok(!declared.includes("game_logs"), "game_logs is not implemented and must not be advertised");
  assert.equal(manifest.remotes[0].url, "https://mcp.freegamestore.online/mcp");
});

test("wrangler.toml documents read-only mode and binds the audit KV", async () => {
  const w = await read("wrangler.toml");
  assert.match(w, /MCP_READ_ONLY/);
  assert.match(w, /binding = "OAUTH_KV"/);
});
