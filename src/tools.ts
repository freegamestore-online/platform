import type { StoreConfig } from "./config";
import type { ToolCall, ToolDef, ToolResult } from "./providers/types";

// ── write_file storage budget ──────────────────────────────────────────────
// The whole session (files + transcript + seed) is persisted as ONE Durable
// Object value, and a SQLite-backed DO caps a single key+value at ~2 MB. An
// unbounded write_file could push the blob past that cap so save() throws and
// the session freezes (only /reset escapes). Enforce conservative caps HERE and
// return a normal TOOL error (never throw) so the agent can react and shrink the
// file instead of bricking the turn. Byte-based (UTF-8), not char-based, because
// storage is bytes.
export const WRITE_FILE_MAX_BYTES = 256 * 1024; // 256 KB per file
export const WRITE_FILE_MAX_FILES = 120; // total file count
export const WRITE_FILE_MAX_TOTAL_BYTES = 1.4 * 1024 * 1024; // ~1.4 MB across all files

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Total UTF-8 byte size of every file currently in the map. */
function totalBytes(files: Map<string, string>): number {
  let total = 0;
  for (const [, content] of files) total += byteLen(content);
  return total;
}

// How much of a tool result is kept in the conversation history sent to the
// model. read_file needs a MUCH larger budget than the rest: a game file is
// routinely 300-500 lines (~15KB), and a too-small cap means the agent sees only
// the top of the file it explicitly opened, then thrashes on piecemeal searches
// until it runs out of turns (the angrry "the file got cut off → stuck" bug).
export const READ_FILE_HISTORY_CAP = 24_000; // ~a whole typical game file
export const DEFAULT_TOOL_HISTORY_CAP = 2_000;

/**
 * Clamp a tool result for the conversation history so one call can't dominate the
 * context, giving read_file a generous budget and everything else a tight one.
 * Over-cap content gets a clear note telling the model how to recover. Pure +
 * exported so the cap is unit-tested (it's load-bearing: too small starves the
 * agent, too large blows the context budget).
 */

/** Resolve a relative import specifier against the project files map. */
function resolveImport(fromPath: string, spec: string, files: Map<string, string>): string | null {
  const dir = fromPath.split("/").slice(0, -1);
  const parts = spec.split("/");
  const stack = [...dir];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    else if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** Static import checks for a just-written source file. Returns "" or a
 *  warning block appended to the write_file result. Heuristic by design —
 *  warnings, never rejections. */
export function validateImports(path: string, content: string, files: Map<string, string>): string {
  if (!/\.(ts|tsx|js|jsx)$/.test(path)) return "";
  const warnings: string[] = [];
  // `import type { X }` / `export type { X }`: the type keyword must not be
  // captured as a default-import name (false "no default export" warnings).
  const importRe = /import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content))) {
    const [, defaultName, namedList, spec] = m;
    if (!spec || (!spec.startsWith("./") && !spec.startsWith("../"))) continue; // packages: can't check
    const target = resolveImport(path, spec, files);
    if (!target) {
      warnings.push(`import "${spec}" does not resolve to any project file — the build WILL fail. Fix the path or write that file.`);
      continue;
    }
    const targetSrc = files.get(target)!;
    if (defaultName && !/export\s+default\b/.test(targetSrc)) {
      warnings.push(`"${spec}" has no default export, but this file default-imports it (${defaultName}) — use a named import.`);
    }
    if (namedList) {
      for (const raw of namedList.split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, "").trim();
        if (!name) continue;
        const exported =
          new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`).test(targetSrc) ||
          new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b`).test(targetSrc) ||
          new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(targetSrc);
        if (!exported) {
          warnings.push(`"${spec}" does not export "${name}" — the build WILL fail. Export it there or fix this import.`);
        }
      }
    }
  }
  return warnings.length ? `\n⚠️ PRE-BUILD CHECK:\n- ${warnings.join("\n- ")}` : "";
}

export function clampToolResultForHistory(toolName: string, content: string): string {
  // fetch_url gets the read_file budget: the model uses it to pull whole source
  // files from the repo — clamped to 2KB it can never see the file, so it
  // re-fetches forever.
  const cap = toolName === "read_file" || toolName === "fetch_url" ? READ_FILE_HISTORY_CAP : DEFAULT_TOOL_HISTORY_CAP;
  if (content.length <= cap) return content;
  return `${content.slice(0, cap)}\n… [truncated ${content.length - cap} more chars — read a specific section, or split this file into smaller modules]`;
}

// A tool-result-shaped status echo the model sometimes writes AS content instead
// of the real source: "[3038 bytes written to x.ts]", "2.5 KB written to …", our
// own "Wrote x.ts (3038 bytes)" ack, etc. Both are ANCHORED — they must be what
// the whole content STARTS with (a status line), so a real file that merely
// mentions "bytes written to" inside a string/comment is never matched.
const STATUS_ECHO_RE = /^\s*\[?\s*[\d.,]+\s*(bytes|kb|mb)\b.*\b(written|truncated|omitted)\b/i;
const WROTE_ACK_RE = /^\s*wrote\s+\S.*\(\s*[\d.,]+\s*(bytes|kb|mb)\s*\)\s*$/i;
// The platform's own transcript elided-body marker (session-budget.elidedBodyMarker),
// caught here too in case the model imitates it from history. Not length-gated —
// these exact phrases never occur in real game source.
const ELIDED_MARKER_RE = /already saved\b[^]*\bomitted|omitted here to save space|never write this note as file content/i;
// Short elision stubs that stand in for real code and always break the build.
const ELISION_RE =
  /(rest|remainder)\s+of\s+(the\s+)?(code|file|component|implementation)|existing\s+code\s+(here|unchanged|remains|goes)|full\s+(source|code|file)\s+(here|below|goes)|content\s+omitted|omitted\s+for\s+brevity|paste\s+.*\s+here|your\s+code\s+here|<\s*insert\b/i;

/**
 * True when `content` is a placeholder/description rather than real file source —
 * a status-message echo or a short elision stub. Kept conservative: the status
 * regexes are anchored to the start and the elision check only fires on SHORT
 * content, so real code that happens to contain such a phrase deeper in a comment
 * or string isn't rejected. Exported for direct unit testing.
 */
export function looksLikePlaceholder(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (STATUS_ECHO_RE.test(trimmed) || WROTE_ACK_RE.test(trimmed) || ELIDED_MARKER_RE.test(trimmed)) return true;
  if (trimmed.length < 200 && ELISION_RE.test(trimmed)) return true;
  return false;
}

/** File tools — identical across all stores */
const FILE_TOOLS: ToolDef[] = [
  {
    name: "write_file",
    description: "Create or overwrite a file in the project. Path is relative to project root (e.g. 'web/src/App.tsx').",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Full file content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file in the project.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List all files in the project.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "delete_file",
    description: "Delete a file from the project.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "Search across all project files for text (case-insensitive SUBSTRING match, not regex). Supports alternation: `a|b` matches lines containing 'a' OR 'b' — use it to find several terms in one call. Returns matching lines with file paths. Use for finding usages, debugging, or understanding the codebase.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text to search for (case-insensitive substring). Use `term1|term2` to match any of several terms in one search." },
      },
      required: ["pattern"],
    },
  },
];

/** Tool definitions parameterized by store config */
export function getToolDefinitions(config: StoreConfig): ToolDef[] {
  const { noun, Noun, nounPlural, storeName, categories } = config;
  const example = config.store === "games" ? "space-invaders" : "meditation-timer";
  const exampleName = config.store === "games" ? "Space Invaders" : "Meditation Timer";

  return [
    ...FILE_TOOLS,

    // ── Deploy + infra tools (executed server-side by the session) ──
    {
      name: "deploy",
      description: `Full deploy: provision GitHub repo, CF Pages project, then push all project files. Use this for the FIRST deploy of a new ${noun}. Call only when the user explicitly asks to deploy.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID — lowercase letters, numbers, hyphens. e.g. '${example}'` },
          name: { type: "string", description: `Display name. e.g. '${exampleName}'` },
          category: { type: "string", description: `Category: ${categories}` },
          icon: { type: "string", description: "HTML entity for icon emoji. e.g. '&#128992;'" },
          iconBg: { type: "string", description: "Icon background color. e.g. '#f0f9ff'" },
          description: { type: "string", description: "One-sentence store description." },
        },
        required: ["id", "name", "category", "icon", "iconBg", "description"],
      },
    },
    {
      name: "push_update",
      description: `Push updated files to an existing deployed ${noun}'s GitHub repo. Use this when the ${noun} is already deployed and the user wants to update it. Creates a new commit with changed files.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID of the already-deployed ${noun}. e.g. '${example}'` },
          message: { type: "string", description: "Commit message describing the update." },
        },
        required: ["id", "message"],
      },
    },
    {
      name: "check_deploy_status",
      description: `Check the deployment status of a ${noun} on Cloudflare Pages. Returns the latest deployment status and URL.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID. e.g. '${example}'` },
        },
        required: ["id"],
      },
    },
    {
      name: `list_deployed_${nounPlural}`,
      description: `List all ${nounPlural} currently deployed on ${storeName}. Returns ${noun} names, IDs, URLs, and categories from the store registry.`,
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fetch_url",
      description: `Fetch a URL and return the response body. Useful for checking if a deployed ${noun} is live, reading remote files, or verifying URLs.`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", description: "HTTP method (default GET)" },
        },
        required: ["url"],
      },
    },
    {
      name: "run_compliance_check",
      description: `Run ${storeName} compliance checks against the current project files. Validates: MIT license, no tracking SDKs, brand fonts, CSS variables, HTML meta tags, PWA manifest, ${config.domain} link, pnpm workspace. Returns pass/fail for each check with details. Run this BEFORE deploying to catch issues early.`,
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_build_logs",
      description: `Get the latest Cloudflare Pages build/deploy logs for a ${noun}. Use when a deploy fails or the ${noun} isn't working to see build errors, missing dependencies, or compilation failures.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID. e.g. '${example}'` },
        },
        required: ["id"],
      },
    },
    {
      name: "get_ci_results",
      description: `Get GitHub Actions CI check results (compliance checks) for a ${noun}'s repo. Shows which checks passed/failed and error details. Use to diagnose compliance failures after pushing code.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID (same as GitHub repo name)` },
        },
        required: ["id"],
      },
    },
    {
      name: "get_audit_results",
      description: `Get quality audit results for a ${noun} from the ${storeName} auditor. Shows compliance score, viewport coverage, and any issues found. Use to understand what needs fixing for quality approval.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: `${Noun} ID. e.g. '${example}'` },
        },
        required: ["id"],
      },
    },
  ];
}

/** Infra tools that need env/network access — handled by the session DO */
export const INFRA_TOOLS = new Set([
  "deploy",
  "push_update",
  "check_deploy_status",
  "list_deployed_apps",
  "list_deployed_games",
  "fetch_url",
  "get_build_logs",
  "get_ci_results",
  "get_audit_results",
]);

export function executeTool(toolCall: ToolCall, files: Map<string, string>, config: StoreConfig): ToolResult {
  const { name, input, id } = toolCall;

  switch (name) {
    case "write_file": {
      const path = input.path as string;
      const content = input.content as string;
      if (!path) return { id, content: "Error: path is required", isError: true };
      if (typeof content !== "string") return { id, content: "Error: content is required", isError: true };

      // Placeholder / echoed-status guard. A confused model sometimes writes a
      // DESCRIPTION of the file instead of the file — most often by echoing a
      // tool-result-shaped status string ("[3038 bytes written to levels.ts]")
      // into the content field, then looping on it (the angrry incident). It also
      // happens with elision stubs ("// ...rest of the code...", "full code here").
      // None are ever valid source; accepting them ships a broken build and wedges
      // the session. Reject with a blunt instruction to write the REAL code.
      if (looksLikePlaceholder(content)) {
        const snippet = content.trim().replace(/\s+/g, " ").slice(0, 60);
        return {
          id,
          content:
            `Error: refusing to write ${path} — the content looks like a status message or placeholder ` +
            `("${snippet}${content.trim().length > 60 ? "…" : ""}"), not real source code. Put the ACTUAL file ` +
            `source (the real TypeScript/HTML/CSS) in the content field — do not describe the file, write it. ` +
            `If the file would be large, split it into smaller focused modules and write each module's real code.`,
          isError: true,
        };
      }

      // Enforce the storage budget before committing the write, so an oversized
      // file (or one that overflows the total) can never brick save(). Returned
      // as a tool error the agent can recover from — not a throw.
      const size = byteLen(content);

      // Big-shrink WARNING (not a hard error). Replacing a substantial file with
      // a tiny fraction of its size CAN be a truncated/incomplete generation (the
      // model hit its max_tokens limit mid-write, leaving a stub) — but it is just
      // as often an INTENTIONAL refactor: slimming a large file into a thin
      // orchestrator after moving its code into new modules (exactly what the
      // system prompt tells the agent to do). Hard-rejecting blocked those
      // legitimate refactors, the agent re-sent the same correct content, and the
      // no-progress breaker then killed the session (the 3D-template refactor
      // wedge). So ACCEPT the write and warn instead: a genuine truncation is
      // caught downstream by the build/compliance gate, which blocks the deploy
      // (deploy no longer false-succeeds), so nothing broken ever ships.
      let shrinkWarning = "";
      const prev = files.get(path);
      if (prev !== undefined) {
        const prevSize = byteLen(prev);
        if (prevSize >= 500 && size < prevSize * 0.1) {
          shrinkWarning =
            ` — NOTE: this replaced a ${prevSize}-byte file with ${size} bytes (>90% smaller). If that was a truncated/` +
            `incomplete write, re-send the COMPLETE file now. If you intentionally moved the code into other modules, make ` +
            `sure you actually wrote those module files.`;
        }
      }
      if (size > WRITE_FILE_MAX_BYTES) {
        return {
          id,
          content: `Error: ${path} is ${Math.round(size / 1024)}KB — over the ${Math.round(
            WRITE_FILE_MAX_BYTES / 1024,
          )}KB per-file limit. Split it into smaller modules.`,
          isError: true,
        };
      }
      const isNew = !files.has(path);
      if (isNew && files.size >= WRITE_FILE_MAX_FILES) {
        return {
          id,
          content: `Error: project already has ${files.size} files (max ${WRITE_FILE_MAX_FILES}). Delete unused files before adding more.`,
          isError: true,
        };
      }
      const projectedTotal = totalBytes(files) - byteLen(files.get(path) ?? "") + size;
      if (projectedTotal > WRITE_FILE_MAX_TOTAL_BYTES) {
        return {
          id,
          content: `Error: writing ${path} would push the project to ${Math.round(
            projectedTotal / 1024,
          )}KB — over the ${Math.round(
            WRITE_FILE_MAX_TOTAL_BYTES / 1024,
          )}KB total limit. Remove or shrink other files first.`,
          isError: true,
        };
      }

      files.set(path, content);
      // Pre-build validation: cheap static checks that catch the failure class
      // that otherwise only surfaces in CI ~60s after push (bad relative
      // imports, missing named exports — every 2026-07-11 build failure).
      // Warnings, not rejections: the write is committed, the model fixes next.
      const importWarnings = validateImports(path, content, files);
      return { id, content: `Wrote ${path} (${content.length} bytes)${shrinkWarning}${importWarnings}` };
    }

    case "read_file": {
      const path = input.path as string;
      const content = files.get(path);
      if (content === undefined) {
        return { id, content: `Error: file not found: ${path}`, isError: true };
      }
      return { id, content };
    }

    case "list_files": {
      const paths = [...files.keys()].sort();
      return { id, content: paths.join("\n") };
    }

    case "delete_file": {
      const path = input.path as string;
      if (!files.has(path)) return { id, content: `Error: file not found: ${path}`, isError: true };
      files.delete(path);
      return { id, content: `Deleted ${path}` };
    }

    case "search_files": {
      const raw = ((input.pattern as string) || "").trim();
      if (!raw) return { id, content: "Error: pattern is required", isError: true };
      // Case-insensitive substring search with ALTERNATION. The model naturally
      // reaches for `a|b` or grep-BRE `a\|b` to search several terms at once; this
      // tool is substring-based, so those used to match literally and return
      // nothing — the agent then burned turns re-searching one term at a time
      // (the angrry "stuck investigating" incident). Split on `|`/`\|` and match
      // ANY term. A lone `|` (no terms) falls back to the raw string.
      const terms = raw
        .split(/\s*\\?\|\s*/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const needles = terms.length > 0 ? terms : [raw.toLowerCase()];
      const matches: string[] = [];
      for (const [path, content] of files) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toLowerCase();
          if (needles.some((n) => line.includes(n))) {
            matches.push(`${path}:${i + 1}: ${lines[i].trim()}`);
            if (matches.length >= 50) break;
          }
        }
        if (matches.length >= 50) break;
      }
      return { id, content: matches.length ? matches.slice(0, 50).join("\n") : `No matches for "${raw}"` };
    }

    case "run_compliance_check": {
      return { id, content: runComplianceCheck(files, config) };
    }

    default:
      // Infra tools are handled by the session, not here
      return { id, content: `Unknown tool: ${name}`, isError: true };
  }
}

/** Run compliance checks locally on the virtual filesystem */
function runComplianceCheck(files: Map<string, string>, config: StoreConfig): string {
  const results: string[] = [];
  const pass = (name: string) => results.push(`PASS: ${name}`);
  const fail = (name: string, detail: string) => results.push(`FAIL: ${name} — ${detail}`);
  // Platform-handled: surfaced for visibility but NOT a failure. These are
  // resolved by the deploy pipeline (APPNAME substitution) or verified by the
  // real CI on the built output (the SDK-provided store link), which the local
  // source-only check can't see. Reporting them as FAIL made agents rabbit-hole
  // editing infra/placeholders instead of deploying.
  const note = (name: string, detail: string) => results.push(`NOTE: ${name} — ${detail}`);

  // MIT License
  const license = files.get("LICENSE");
  if (license && /mit/i.test(license)) pass("MIT License");
  else fail("MIT License", "Missing LICENSE file or not MIT");

  // No .env.production
  if (!files.has(".env.production") && !files.has("web/.env.production")) pass("No .env.production");
  else fail("No .env.production", ".env.production found in project");

  // No tracking SDKs. Match real SDK signatures, not bare English/code words:
  // "segment" (line segments), "amplitude" (waves/audio) are legitimate in game
  // code, so pin those to their product domains/APIs.
  const forbidden = /google-analytics|googletagmanager|gtag\s*\(|mixpanel|segment\.(com|io)|segmentio|hotjar|plausible\.io|posthog|amplitude\.(com|getInstance|init)/i;
  let hasTracking = false;
  for (const [path, content] of files) {
    if (path.startsWith("web/src/") && forbidden.test(content)) {
      hasTracking = true;
      break;
    }
  }
  const webPkg = files.get("web/package.json") || "";
  if (forbidden.test(webPkg)) hasTracking = true;
  if (!hasTracking) pass("No tracking SDKs");
  else fail("No tracking SDKs", "Found forbidden tracking SDK reference");

  // Brand fonts
  const css = files.get("web/src/index.css") || "";
  const hasManrope = /manrope/i.test(css);
  const hasFraunces = /fraunces/i.test(css);
  if (hasManrope && hasFraunces) pass("Brand fonts (Manrope + Fraunces)");
  else fail("Brand fonts", `Missing: ${!hasManrope ? "Manrope" : ""} ${!hasFraunces ? "Fraunces" : ""}`.trim());

  // CSS variables (store-specific)
  if (config.store === "games") {
    const hasVars = /--bg/.test(css) && /--ink/.test(css) && /--accent/.test(css);
    if (hasVars) pass("CSS variables (--bg, --ink, --accent)");
    else fail("CSS variables", "Missing --bg, --ink, or --accent in index.css");
  } else {
    const hasVars = /--paper/.test(css) && /--ink/.test(css) && /--accent/.test(css);
    if (hasVars) pass("CSS variables (--paper, --ink, --accent)");
    else fail("CSS variables", "Missing --paper, --ink, or --accent in index.css");
  }

  // HTML meta tags. Mirror @freegamestore/compliance checkHtmlMeta: the
  // viewport must not just exist, it must disable pinch/double-tap zoom
  // (user-scalable=no or maximum-scale=1) so taps during gameplay don't
  // accidentally zoom the board.
  const html = files.get("web/index.html") || "";
  const hasLang = /lang=/.test(html);
  const viewportTag = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)?.[0] || "";
  const hasViewport = viewportTag !== "";
  const viewportNoZoom =
    /user-scalable\s*=\s*(no|0)/i.test(viewportTag) || /maximum-scale\s*=\s*1(\.0+)?\b/i.test(viewportTag);
  const hasTitle = /<title>/.test(html);
  if (hasLang && hasViewport && viewportNoZoom && hasTitle) pass("HTML meta tags (lang, viewport, title)");
  else
    fail(
      "HTML meta tags",
      `Missing: ${[
        !hasLang && "lang",
        !hasViewport && "viewport",
        hasViewport && !viewportNoZoom && "viewport must disable zoom (user-scalable=no)",
        !hasTitle && "title",
      ]
        .filter(Boolean)
        .join(", ")}`,
    );

  // PWA manifest — platform-scaffolded, NOT game code the agent authors. The
  // template ships a complete manifest.json and the platform substitutes APPNAME
  // + runs the REAL manifest check on the built output at deploy. When the
  // manifest isn't in the agent's editable file set (a public/ scaffold file),
  // this must be a NOTE, not a hard FAIL the agent has to hand-wave every build.
  const manifest = files.get("web/public/manifest.json") || "";
  const hasManifest = /name/.test(manifest) && /display/.test(manifest) && /start_url/.test(manifest);
  if (hasManifest) pass("PWA manifest");
  else note("PWA manifest", "Platform-managed — the template ships a complete manifest and the real check runs on the built output at deploy. Don't hand-add or edit it.");

  // PWA meta tags
  const hasPWAMeta = /apple-mobile-web-app-capable|mobile-web-app-capable/i.test(html);
  if (hasPWAMeta) pass("PWA meta tags");
  else fail("PWA meta tags", "Missing apple-mobile-web-app-capable or mobile-web-app-capable");

  // Store link
  let hasStoreLink = false;
  for (const [path, content] of files) {
    if (path.startsWith("web/src/") && content.includes(config.domain)) {
      hasStoreLink = true;
      break;
    }
  }
  if (hasStoreLink) pass(`${config.storeName} link in source`);
  else note(`${config.storeName} link`, `Not in web/src/ — that's fine: the SDK's GameShell renders it into the built output, where the real CI verifies it. Don't hand-add a link.`);

  // Store-specific checks
  if (config.store === "games") {
    // Overflow hidden (required for games)
    let hasOverflowHidden = false;
    if (/overflow:\s*hidden/i.test(css) || /overflow-hidden/.test(css)) hasOverflowHidden = true;
    if (hasOverflowHidden) pass("Overflow hidden");
    else fail("Overflow hidden", "Body or #root must have overflow: hidden for games");
  } else {
    // Dark mode support (required for apps)
    let hasDarkMode = false;
    for (const [path, content] of files) {
      if (path.startsWith("web/src/") && /prefers-color-scheme|data-theme|color-scheme/.test(content)) {
        hasDarkMode = true;
        break;
      }
    }
    if (hasDarkMode) pass("Dark mode support");
    else fail("Dark mode", "No prefers-color-scheme, data-theme, or color-scheme in web/src/");
  }

  // pnpm workspace
  const rootPkg = files.get("package.json") || "";
  const hasWS = files.has("pnpm-workspace.yaml") && /pnpm/.test(rootPkg);
  if (hasWS) pass("pnpm workspace");
  else fail("pnpm workspace", "Missing pnpm-workspace.yaml or pnpm reference in package.json");

  // No APPNAME placeholders
  let hasPlaceholder = false;
  for (const [, content] of files) {
    if (/APPNAME/.test(content)) {
      hasPlaceholder = true;
      break;
    }
  }
  if (!hasPlaceholder) pass("No APPNAME placeholders");
  else note("APPNAME placeholders", "Present — the platform substitutes these with your game's real id/name at deploy. Leave them as-is; do NOT edit package.json/manifest/titles to 'fix' them.");

  const passes = results.filter((r) => r.startsWith("PASS")).length;
  const fails = results.filter((r) => r.startsWith("FAIL")).length;
  const notes = results.filter((r) => r.startsWith("NOTE")).length;
  const verdict = fails === 0 ? "OK to deploy" : "fix the FAILs, then deploy";
  return `Compliance: ${passes} pass, ${fails} fail, ${notes} note — ${verdict}\n(NOTEs are platform-handled — do not act on them.)\n\n${results.join("\n")}`;
}
