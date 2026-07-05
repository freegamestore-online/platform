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

/**
 * Run every build-sanity check across the project's compiled source. Returns the
 * findings that should BLOCK a deploy (empty ⇒ OK to build).
 */
export function checkBuildSanity(files: Map<string, string>): SanityFinding[] {
  const findings: SanityFinding[] = [];

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
