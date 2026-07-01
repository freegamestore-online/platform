/**
 * Minimal unit tests for auth worker utilities.
 * Uses Node's built-in test runner — no extra dependencies needed.
 *
 * Run: pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// --- Inline the pure helpers under test (mirrors src/index.ts) ---

function base64url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- Tests ---

test("base64urlEncode round-trips through base64urlDecode", () => {
  const original = JSON.stringify({ redirect: "https://freegamestore.online" });
  const encoded = base64urlEncode(original);
  assert.equal(base64urlDecode(encoded), original);
});

test("base64urlEncode produces URL-safe output (no +, /, or =)", () => {
  // Use a string long enough that standard base64 would include padding/special chars
  const encoded = base64urlEncode("hello world from freegamestore auth");
  assert.doesNotMatch(encoded, /[+/=]/);
});

test("base64urlDecode handles URL-safe input correctly", () => {
  const input = "aGVsbG8gd29ybGQ"; // "hello world" in base64url
  assert.equal(base64urlDecode(input), "hello world");
});

test("CORS allowed origin regex accepts *.freegamestore.online", () => {
  const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;
  assert.ok(ALLOWED_ORIGIN.test("https://chess.freegamestore.online"));
  assert.ok(ALLOWED_ORIGIN.test("https://tetris.freegamestore.online"));
  assert.equal(ALLOWED_ORIGIN.test("https://evil.com"), false);
  assert.equal(ALLOWED_ORIGIN.test("https://freegamestore.online"), false); // apex handled separately
});

// --- Vault CORS lock (regression guard for the BYO-key exfil fix) ---
// A published game at <game>.freegamestore.online must NEVER be a trusted
// origin for /vault/*, or it could read the player's decrypted API keys.
import { corsVault, isFirstParty } from "./index";

test("isFirstParty trusts console/storefront/localhost, rejects game subdomains", () => {
  assert.equal(isFirstParty("https://console.freegamestore.online"), true);
  assert.equal(isFirstParty("https://freegamestore.online"), true);
  assert.equal(isFirstParty("http://localhost:5173"), true);
  // The whole point: an arbitrary game subdomain is NOT first-party.
  assert.equal(isFirstParty("https://evilgame.freegamestore.online"), false);
  // And a look-alike suffix must not slip through.
  assert.equal(isFirstParty("https://freegamestore.online.evil.com"), false);
});

test("vault CORS returns no Allow-Origin to a game origin, allows the console", () => {
  const gameOrigin = corsVault(
    new Request("https://auth.freegamestore.online/vault/get", {
      headers: { Origin: "https://evilgame.freegamestore.online" },
    }),
  );
  assert.equal(gameOrigin["Access-Control-Allow-Origin"], "");

  const consoleOrigin = corsVault(
    new Request("https://auth.freegamestore.online/vault/get", {
      headers: { Origin: "https://console.freegamestore.online" },
    }),
  );
  assert.equal(consoleOrigin["Access-Control-Allow-Origin"], "https://console.freegamestore.online");
});
