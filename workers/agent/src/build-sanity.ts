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
 * SCOPE — deliberately narrow. These are STATIC checks, NOT a type checker or a
 * parser. A check only fires when esbuild would (near-)certainly reject the file,
 * because a false positive blocks a LEGITIMATE deploy. We only ship checks that
 * are provably free of false positives on the real published-game corpus.
 *
 * NOT included, on purpose: brace/paren balance. A char scanner cannot tell a
 * string quote from a JSX-text apostrophe ("Don't", "Player's") without a real
 * JSX parser, so a balance check mis-counts and flags ~1 in 5 perfectly-good
 * games. Duplicate-declaration detection is immune to that (it only reads
 * column-0 declarations; an apostrophe can at worst HIDE a line, never invent a
 * declaration) — so that's what we keep.
 *
 * Only files vite actually bundles are inspected: web/src/**.{ts,tsx,js,jsx}.
 */

/** Source files that the Vite build compiles (esbuild-parsed). */
const SRC_RE = /^web\/src\/.+\.(?:tsx?|jsx?|mjs|cjs)$/;
const PACKAGE_RE = /(^|\/)package\.json$/;

export interface SanityFinding {
  file: string;
  problem: string;
}

/**
 * Blank out the spans that could hide (or fake) a top-level declaration —
 * comments and multi-line template-literal / string bodies — so a column-0 scan
 * sees only real top-level code. Newlines are preserved so line structure and the
 * "column 0" anchor survive.
 *
 * We intentionally do NOT try to distinguish regex from division or to balance
 * delimiters — this skeleton exists only to keep embedded code (inside a comment
 * or a string) from being mistaken for a real declaration. Single/double-quoted
 * strings are auto-closed at newline (JS strings can't span a raw newline), which
 * also contains the JSX-apostrophe problem to a single line.
 */
export function stripToSkeleton(src: string): string {
  const out: string[] = [];
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "code";
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    switch (mode) {
      case "code":
        if (c === "/" && c2 === "/") { mode = "line"; blank(c); i++; break; }
        if (c === "/" && c2 === "*") { mode = "block"; blank(c); i++; break; }
        if (c === '"') { mode = "dq"; out.push(c); i++; break; }
        if (c === "'") { mode = "sq"; out.push(c); i++; break; }
        if (c === "`") { mode = "tpl"; out.push(c); i++; break; }
        out.push(c); i++; break;

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
        if (c === "\n") { mode = "code"; out.push("\n"); i++; break; } // unterminated → close at line end
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === q) { mode = "code"; out.push(c); i++; break; }
        blank(c); i++; break;
      }

      case "tpl":
        if (c === "\\") { blank(c); if (i + 1 < n) blank(src[i + 1]); i += 2; break; }
        if (c === "`") { mode = "code"; out.push(c); i++; break; }
        blank(c); i++; break; // blank the whole template body (incl. ${…}) — we only need top-level decls
    }
  }
  return out.join("");
}

/** Top-level declaration patterns (anchored at column 0 on the skeleton). */
const DECL_PATTERNS: RegExp[] = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
];

/** Find top-level identifiers declared more than once in one file (esbuild:
 *  "The symbol X has already been declared"). const/let/var/class can NEVER be
 *  redeclared; a duplicate top-level `function` is the incident pattern. */
function duplicateDeclarations(skeleton: string): string[] {
  const seen = new Map<string, number>();
  for (const line of skeleton.split("\n")) {
    if (line === "" || /^\s/.test(line)) continue; // top-level only (column 0)
    for (const re of DECL_PATTERNS) {
      const m = re.exec(line);
      if (m) { seen.set(m[1], (seen.get(m[1]) || 0) + 1); break; }
    }
  }
  return [...seen.entries()].filter(([, count]) => count >= 2).map(([name]) => name);
}

function lineNumberAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function projectUsesPixi(files: Map<string, string>): boolean {
  for (const [path, content] of files) {
    if (PACKAGE_RE.test(path) && /"pixi\.js"\s*:/.test(content)) return true;
    if (SRC_RE.test(path) && /from\s+["']pixi\.js["']|import\s*\([^)]*["']pixi\.js["']/.test(content)) return true;
  }
  return false;
}

function projectUsesKaplay(files: Map<string, string>): boolean {
  for (const [path, content] of files) {
    if (PACKAGE_RE.test(path) && /"kaplay"\s*:/.test(content)) return true;
    if (SRC_RE.test(path) && /from\s+["']kaplay["']|import\s*\([^)]*["']kaplay["']/.test(content)) return true;
  }
  return false;
}

function countUnescapedBackticks(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "`") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) count++;
  }
  return count;
}

function findKaplayTextTemplateIssues(content: string): { line: number; text: string }[] {
  const findings: { line: number; text: string }[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // KAPLAY text labels in generated games should be a single-line string.
    // This catches the Crossy School failure: k.text(`Score: ${score}", ...)
    // without doing a risky full quote/brace balance pass over TSX.
    if (/\bk\.text\s*\(/.test(line) && countUnescapedBackticks(line) % 2 === 1) {
      findings.push({ line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
  return findings;
}

/** Index of the closing quote for the literal opening at `start`, or -1 if it
 *  never closes on this line (normal strings) / in this file (templates). */
function endOfStringLiteral(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return i;
    // A single/double-quoted string cannot span a newline — if we reach one the
    // scan was wrong about where the literal started; bail rather than guess.
    if (quote !== "`" && ch === "\n") return -1;
  }
  return -1;
}

/** Raw source of every string literal in `src`, with its start offset. A quote
 *  that never closes on its line is a JSX apostrophe ("Don't"), not a literal —
 *  skip just that character rather than letting it swallow the rest of the file
 *  (the failure mode that sank the prototype brace-balance check). */
function stringLiteralsIn(src: string, from = 0): { content: string; index: number }[] {
  const out: { content: string; index: number }[] = [];
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '"' && ch !== "'" && ch !== "`") continue;
    const end = endOfStringLiteral(src, i);
    if (end === -1) continue;
    out.push({ content: src.slice(i + 1, end), index: i });
    i = end;
  }
  return out;
}

/** Drop `${…}` spans — an interpolation is evaluated before KAPLAY ever sees the
 *  string, so `k.text(\`${items[0]} pts\`)` must not read as a "[0]" tag. */
function stripInterpolations(literal: string): string {
  let out = "";
  let i = 0;
  while (i < literal.length) {
    if (literal[i] === "$" && literal[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < literal.length && depth > 0) {
        if (literal[i] === "{") depth++;
        else if (literal[i] === "}") depth--;
        i++;
      }
      continue;
    }
    out += literal[i];
    i++;
  }
  return out;
}

/** KAPLAY's styled-text markup. Mirrors the engine's own matcher exactly —
 *  kaplay@3001 compileStyledText uses `/^\[(\/)?(\w+?)\]/`, so a tag name is
 *  \w+ and nothing else: "[Type it!]" is plain text to KAPLAY (the space and "!"
 *  fail the match), which is why the candy-shop crash named only G, C and H. */
const STYLED_TAG_RE = /\[(\/?)(\w+)\]/g;

/** Style-tag names opened but never closed in one literal, in source order.
 *  Counts opens vs closes per name rather than emulating KAPLAY's tag STACK, so
 *  a mis-NESTED but balanced string ("[a][b][/a][/b]", which KAPLAY rejects as
 *  "mismatched tags") is deliberately not reported. That direction only ever
 *  costs a missed hit; the reverse would block a working deploy. */
function unclosedStyledTags(literal: string): string[] {
  const text = stripInterpolations(literal);
  const opens = new Map<string, number>();
  const closes = new Map<string, number>();
  const order: string[] = [];
  for (const m of text.matchAll(STYLED_TAG_RE)) {
    if (m.index === undefined) continue;
    // Any backslash immediately before the "[" means the author was escaping it.
    // Checked loosely (not odd/even): we are reading RAW source, where the same
    // runtime "\[" can appear as `\[` or `\\[` depending on the quoting. Skipping
    // both costs a missed hit; guessing wrong would BLOCK a legitimate deploy.
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    const name = m[2];
    if (m[1]) {
      closes.set(name, (closes.get(name) ?? 0) + 1);
    } else {
      if (!opens.has(name)) order.push(name);
      opens.set(name, (opens.get(name) ?? 0) + 1);
    }
  }
  return order.filter((name) => (opens.get(name) ?? 0) > (closes.get(name) ?? 0));
}

/**
 * KAPLAY parses `[name]…[/name]` inside `text()` as styled-text markup, so a bare
 * square-bracket label — `k.text("[G] Gummies  [C] Chocolates")` — throws
 * "Styled text error: unclosed tags G,C" at RUNTIME. The code is valid
 * TypeScript, so tsc and vite build both pass and only the CI smoke test catches
 * it (candy-shop, 2026-08-09).
 *
 * EVERY string literal in the file is inspected, not just the argument at the
 * `k.text(…)` call site: in the candy-shop code the tags lived in a data table
 * (`{ cat: "gummy", label: "GUM\n[G]" }`) that was passed to `k.text(b.label)`
 * one scope away, and that indirection is the common shape in generated code.
 * The file must render text at all (`k.text(` present) for the check to run.
 *
 * `${…}` spans are removed and escaped brackets are skipped, so a balanced
 * `[red]Score[/red]` and an interpolated `${gs.stock[cat]}` both stay silent —
 * the latter is live candy-shop code today and must never block a deploy.
 */
function findKaplayStyledTextIssues(content: string): { line: number; tags: string[] }[] {
  // No text rendering in this file ⇒ nothing can reach the styled-text parser.
  if (!/\bk\.text\s*\(/.test(content)) return [];
  const findings: { line: number; tags: string[] }[] = [];
  for (const literal of stringLiteralsIn(content)) {
    const tags = unclosedStyledTags(literal.content);
    if (tags.length) findings.push({ line: lineNumberAt(content, literal.index), tags });
  }
  return findings;
}

function findPackedPixiColors(content: string): { line: number; literal: string }[] {
  const findings: { line: number; literal: string }[] = [];
  const seen = new Set<string>();
  const dangerousUse =
    /\.(?:fill|stroke)\s*\([^;\n]*0x[0-9a-fA-F]{7,}[^;\n]*\)|(?:fill|color|tint)\s*:\s*0x[0-9a-fA-F]{7,}/g;
  let use: RegExpExecArray | null;
  while ((use = dangerousUse.exec(content))) {
    const segment = use[0];
    const literalMatch = /0x[0-9a-fA-F]{7,}/.exec(segment);
    if (!literalMatch) continue;
    const literal = literalMatch[0];
    const key = `${literal}@${use.index + literalMatch.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ line: lineNumberAt(content, use.index + literalMatch.index), literal });
  }
  return findings;
}

/**
 * Run every build-sanity check across the project's compiled source. Returns the
 * findings that should BLOCK a deploy (empty ⇒ OK to build).
 */
export function checkBuildSanity(files: Map<string, string>): SanityFinding[] {
  const findings: SanityFinding[] = [];
  const usesPixi = projectUsesPixi(files);
  const usesKaplay = projectUsesKaplay(files);

  for (const [path, content] of files) {
    if (!SRC_RE.test(path)) continue;

    const skeleton = stripToSkeleton(content);

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

    // Multiple top-level `export default` in one module is an esbuild error.
    const defaults = (skeleton.match(/^export\s+default\b/gm) || []).length;
    if (defaults >= 2) {
      findings.push({ file: path, problem: `${defaults} \`export default\` statements — a module may have only one.` });
    }

    if (usesPixi) {
      const packedColors = findPackedPixiColors(content);
      for (const color of packedColors) {
        findings.push({
          file: path,
          problem:
            `Pixi color ${color.literal} on line ${color.line} is wider than 24-bit RGB. ` +
            `Pixi v8 colors must be 0xRRGGBB; put transparency in an \`alpha\` field instead ` +
            `(for example, \`.stroke({ color: 0x8b6914, alpha: 0.4, width: 1 })\`).`,
        });
      }
    }

    if (usesKaplay) {
      if (/from\s+["']@freegamestore\/games\/kaplay["']|import\s*\([^)]*["']@freegamestore\/games\/kaplay["']/.test(content)) {
        findings.push({
          file: path,
          problem:
            `invalid KAPLAY import. @freegamestore/games does not export ./kaplay; ` +
            `use \`import kaplay from "kaplay"\` and create the context with \`kaplay({ canvas, global: false, ... })\`.`,
        });
      }

      const textIssues = findKaplayTextTemplateIssues(content);
      for (const issue of textIssues) {
        findings.push({
          file: path,
          problem:
            `likely unterminated template literal in KAPLAY text on line ${issue.line}: \`${issue.text}\`. ` +
            `Close template strings with a backtick, for example \`k.text(\`Score: \${score}\`, { size: 24 })\`.`,
        });
      }

      for (const issue of findKaplayStyledTextIssues(content)) {
        const list = issue.tags.map((t) => `[${t}]`).join(", ");
        findings.push({
          file: path,
          problem:
            `KAPLAY text() on line ${issue.line} contains unclosed styled-text tag(s): ${list}. ` +
            `KAPLAY parses [name]…[/name] as markup, so a bare bracket label throws ` +
            `"Styled text error: unclosed tags ${issue.tags.join(",")}" at runtime — the build itself passes. ` +
            `Either close them (\`[${issue.tags[0]}]…[/${issue.tags[0]}]\`) or escape the bracket as \`\\\\[${issue.tags[0]}]\`.`,
        });
      }
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
