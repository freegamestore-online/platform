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
