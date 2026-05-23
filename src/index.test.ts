import { describe, it, expect } from "vitest";

// Unit tests for pure helpers in the leaderboard worker.
// The worker itself runs in the CF Workers runtime; these tests cover
// logic that can be exercised without the runtime binding.

// --- cors origin allowlist ---
const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;

function isAllowedOrigin(origin: string): boolean {
  return (
    ALLOWED_ORIGIN.test(origin) ||
    origin === "https://freegamestore.online" ||
    origin === "http://localhost:5173"
  );
}

describe("CORS origin check", () => {
  it("allows game subdomains", () => {
    expect(isAllowedOrigin("https://chess.freegamestore.online")).toBe(true);
    expect(isAllowedOrigin("https://tetris.freegamestore.online")).toBe(true);
  });

  it("allows the store root", () => {
    expect(isAllowedOrigin("https://freegamestore.online")).toBe(true);
  });

  it("allows localhost dev", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });

  it("rejects unknown origins", () => {
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
    expect(isAllowedOrigin("https://freegamestore.online.evil.com")).toBe(false);
  });
});

// --- score validation boundaries ---
const MAX_SCORE = 999_999_999;

function isValidScore(score: unknown): boolean {
  return (
    typeof score === "number" &&
    Number.isInteger(score) &&
    score >= 0 &&
    score <= MAX_SCORE
  );
}

describe("score validation", () => {
  it("accepts zero and positive integers", () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(1000)).toBe(true);
    expect(isValidScore(MAX_SCORE)).toBe(true);
  });

  it("rejects negatives, floats, strings, and overflow", () => {
    expect(isValidScore(-1)).toBe(false);
    expect(isValidScore(1.5)).toBe(false);
    expect(isValidScore("100")).toBe(false);
    expect(isValidScore(MAX_SCORE + 1)).toBe(false);
  });
});

// --- name sanitisation ---
const MAX_NAME_LENGTH = 20;

function sanitiseName(raw: unknown): string {
  if (typeof raw !== "string") return "Anonymous";
  return raw.trim().slice(0, MAX_NAME_LENGTH).replace(/[<>&"']/g, "") || "Anonymous";
}

describe("name sanitisation", () => {
  it("trims and caps at 20 chars", () => {
    expect(sanitiseName("  Alice  ")).toBe("Alice");
    expect(sanitiseName("A".repeat(30))).toHaveLength(20);
  });

  it("strips HTML-special chars", () => {
    expect(sanitiseName("<script>")).toBe("script");
    expect(sanitiseName("O'Brien")).toBe("OBrien");
  });

  it("falls back to Anonymous for blanks and non-strings", () => {
    expect(sanitiseName("")).toBe("Anonymous");
    expect(sanitiseName("   ")).toBe("Anonymous");
    expect(sanitiseName(null)).toBe("Anonymous");
  });
});
