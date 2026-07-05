/**
 * In-worker "build sanity" gate. Runs BEFORE deploy / push_update and BLOCKS the
 * push when the source almost certainly can't build — so a broken generation
 * self-corrects in-session instead of failing CI silently and serving a stale
 * template for ~30 min while looking "published."
 *
 * Motivation — the `climberadventure` incident (see BUILD-SAFETY-RECOMMENDATIONS.md):
 * `web/src/App.tsx` shipped with a ~66-line exact-duplicate block
 * (`getPlatformColor`, `drawMountainBg`, `drawMountainSilhouette`, `lerp`
 * redeclared at top level). `vite build` rejected it ("The symbol X has already
 * been declared"), both CI jobs went red, R2 was never updated, and the old
 * template kept serving. The agent thought it had shipped.
 *
 * These are STATIC, high-signal checks — NOT a type checker. A check only fires
 * when esbuild would (near-)certainly reject the file, because a false positive
 * blocks a legitimate deploy. To keep the signal clean we run every check on a
 * "skeleton" where comments and the *contents* of strings / template literals /
 * regex are blanked out (delimiters and newlines preserved) — so a `}` inside a
 * string, a brace inside a regex character class, or code embedded in a template
 * literal can never be mistaken for real code.
 *
 * Only files vite actually bundles are inspected: web/src/**.{ts,tsx,js,jsx}.
 */

/** Source files that the Vite build compiles (esbuild-parsed). */
const SRC_RE = /^web\/src\/.+\.(?:tsx?|jsx?|mjs|cjs)$/;

export interface SanityFinding {
  file: string;
  problem: string;
}

/** Chars after which a `/` is division (a value is on the left), not a regex. */
const DIVISION_AFTER = new Set([")", "]", "}", "`", "'", '"', ">", "<", "."]);
/** Keywords after which a `/` starts a regex even though the prev char is a letter. */
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do",
  "else", "yield", "await", "throw", "case",
]);

/**
 * Walk the source and return a code skeleton (strings / templates / regex /
 * comments blanked, newlines + delimiters preserved) plus the net delimiter
 * balance. Handles line & block comments, ' " ` strings with escapes, template
 * `${…}` interpolation (recursive, real braces inside), and regex literals.
 */
export function scan(src: string): { skeleton: string; brace: number; paren: number; bracket: number } {
  const out: string[] = [];
  let brace = 0, paren = 0, bracket = 0;
  // Last significant (non-whitespace) skeleton char — drives regex detection.
  let prevSig = "";
  // Trailing identifier word ending at the current position (for keyword lookback).
  let word = "";
  // Stack of brace-depths at which we entered a template `${` interpolation.
  const tplStack: number[] = [];

  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl" | "regex" | "class";
  let mode: Mode = "code";

  const emit = (ch: string) => {
    out.push(ch);
    if (/\s/.test(ch)) return; // whitespace ends no token: keep prevSig AND word
    prevSig = ch;
    if (/[A-Za-z0-9_$]/.test(ch)) word += ch;
    else word = "";
  };
  const blank = (ch: string) => {
    out.push(ch === "\n" ? "\n" : " ");
    if (ch === "\n" || /\s/.test(ch)) { /* keep prevSig */ } else prevSig = " ";
    word = "";
  };

  const startsRegex = (): boolean => {
    if (prevSig === "") return true; // start of file / expression position
    if (/[A-Za-z0-9_$]/.test(prevSig)) return REGEX_KEYWORDS.has(word); // value vs. keyword
    if (DIVISION_AFTER.has(prevSig)) return false;
    return true; // after an operator/opening bracket/comma/etc.
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";

    switch (mode) {
      case "code":
        if (c === "/" && c2 === "/") { mode = "line"; blank(c); i++; break; }
        if (c === "/" && c2 === "*") { mode = "block"; blank(c); i++; break; }
        if (c === '"') { mode = "dq"; emit(c); i++; break; }
        if (c === "'") { mode = "sq"; emit(c); i++; break; }
        if (c === "`") { mode = "tpl"; emit(c); i++; break; }
        if (c === "/" && startsRegex()) { mode = "regex"; blank(c); i++; break; }
        if (c === "{") { brace++; emit(c); i++; break; }
        if (c === "}") {
          if (tplStack.length && brace === tplStack[tplStack.length - 1] + 1) {
            brace = tplStack.pop()!; // close the `${…}` interpolation
            mode = "tpl"; emit(c); i++; break;
          }
          brace--; emit(c); i++; break;
        }
        if (c === "(") { paren++; emit(c); i++; break; }
        if (c === ")") { paren--; emit(c); i++; break; }
        if (c === "[") { bracket++; emit(c); i++; break; }
        if (c === "]") { bracket--; emit(c); i++; break; }
        emit(c); i++; break;

      case "line":
        if (c === "\n") { mode = "code"; out.push("\n"); } else blank(c);
        i++; break;

      case "block":
        if (c === "*" && c2 === "/") { mode = "code"; blank(c); out.push(" "); i += 2; }
        else { blank(c); i++; }
        break;

      case "sq":
      case "dq": {
        const q = mode === "sq" ? "'" : '"';
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === q) { mode = "code"; emit(c); i++; break; }
        blank(c); i++; break;
      }

      case "tpl":
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === "`") { mode = "code"; emit(c); i++; break; }
        if (c === "$" && c2 === "{") { tplStack.push(brace); brace++; mode = "code"; emit("$"); emit("{"); i += 2; break; }
        blank(c); i++; break;

      case "regex":
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === "[") { mode = "class"; blank(c); i++; break; }
        if (c === "\n") { mode = "code"; out.push("\n"); i++; break; } // regex can't span lines — we mis-guessed; recover
        if (c === "/") { mode = "code"; blank(c); i++; prevSig = "x"; word = ""; break; } // treat result as a value
        blank(c); i++; break;

      case "class": // inside a regex character class […] — `/` is not a terminator
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === "]") { mode = "regex"; blank(c); i++; break; }
        if (c === "\n") { mode = "code"; out.push("\n"); i++; break; }
        blank(c); i++; break;
    }
  }

  return { skeleton: out.join(""), brace, paren, bracket };
}

/** Top-level declaration patterns (anchored at column 0 on the skeleton). */
const DECL_PATTERNS: RegExp[] = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
];

/** Find top-level identifiers declared more than once in one file (esbuild:
 *  "The symbol X has already been declared"). const/let/var/class can NEVER be
 *  redeclared; duplicate `function` is the incident pattern. */
function duplicateDeclarations(skeleton: string): string[] {
  const seen = new Map<string, number>();
  const lines = skeleton.split("\n");
  for (const line of lines) {
    if (/^\s/.test(line) || line === "") continue; // top-level only (column 0)
    for (const re of DECL_PATTERNS) {
      const m = re.exec(line);
      if (m) { seen.set(m[1], (seen.get(m[1]) || 0) + 1); break; }
    }
  }
  return [...seen.entries()].filter(([, count]) => count >= 2).map(([name]) => name);
}

/**
 * Run every build-sanity check across the project's compiled source. Returns the
 * findings that should BLOCK a deploy (empty ⇒ OK to build).
 */
export function checkBuildSanity(files: Map<string, string>): SanityFinding[] {
  const findings: SanityFinding[] = [];

  for (const [path, content] of files) {
    if (!SRC_RE.test(path)) continue;

    const { skeleton, brace, paren, bracket } = scan(content);

    const dups = duplicateDeclarations(skeleton);
    if (dups.length) {
      findings.push({
        file: path,
        problem: `duplicate top-level declaration(s): ${dups.join(", ")}. ` +
          `Each name is defined more than once at the top of the file — esbuild fails with ` +
          `"The symbol has already been declared". You likely appended a new version of the ` +
          `code instead of replacing the old one. Remove the duplicate block so each is defined once.`,
      });
    }

    // Multiple `export default` in one module is an esbuild error.
    const defaults = (skeleton.match(/^export\s+default\b/gm) || []).length;
    if (defaults >= 2) {
      findings.push({ file: path, problem: `${defaults} \`export default\` statements — a module may have only one.` });
    }

    if (brace !== 0) {
      findings.push({ file: path, problem: `unbalanced curly braces (${brace > 0 ? `${brace} unclosed '{'` : `${-brace} extra '}'`}). The file is likely truncated or has a stray/duplicated block.` });
    }
    if (paren !== 0) {
      findings.push({ file: path, problem: `unbalanced parentheses (${paren > 0 ? `${paren} unclosed '('` : `${-paren} extra ')'`}).` });
    }
    if (bracket !== 0) {
      findings.push({ file: path, problem: `unbalanced square brackets (${bracket > 0 ? `${bracket} unclosed '['` : `${-bracket} extra ']'`}).` });
    }
  }

  return findings;
}

/** Format findings as the blocking tool-result the agent sees (and self-corrects on). */
export function formatSanityBlock(findings: SanityFinding[], noun: string): string {
  const lines = findings.map((f) => `  • ${f.file}: ${f.problem}`);
  return (
    `Deploy BLOCKED — your ${noun}'s code will not build, so shipping it now would fail CI ` +
    `and leave the old version live. Fix these, then deploy again:\n\n${lines.join("\n")}\n\n` +
    `Tip: when changing an existing file, rewrite the WHOLE file in one write_file call — ` +
    `never append a second copy of a function or component.`
  );
}
