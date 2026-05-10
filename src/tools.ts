import type { ToolDef, ToolCall, ToolResult } from "./providers/types";

/** Tool definitions for the agent — file management + deployment + infra */

export const TOOL_DEFINITIONS: ToolDef[] = [
  // -- File tools --
  {
    name: "write_file",
    description:
      "Create or overwrite a file in the project. Path is relative to project root (e.g. 'web/src/App.tsx').",
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

  // -- Deploy + infra tools (executed server-side by the session) --
  {
    name: "deploy",
    description:
      "Full deploy: provision GitHub repo, CF Pages project, DNS, store listing, then push all project files. Use this for the FIRST deploy of a new game. Call only when the user explicitly asks to deploy.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID — lowercase letters, numbers, hyphens. e.g. 'space-invaders'" },
        name: { type: "string", description: "Display name. e.g. 'Space Invaders'" },
        category: { type: "string", description: "Category: arcade, puzzle, strategy, racing, sports, cards, board, rpg, action, casual" },
        icon: { type: "string", description: "HTML entity for icon emoji. e.g. '&#127918;'" },
        iconBg: { type: "string", description: "Icon background color. e.g. '#1a2e26'" },
        description: { type: "string", description: "One-sentence store description." },
      },
      required: ["id", "name", "category", "icon", "iconBg", "description"],
    },
  },
  {
    name: "push_update",
    description:
      "Push updated files to an existing deployed game's GitHub repo. Use this when the game is already deployed and the user wants to update it. Creates a new commit with changed files.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID of the already-deployed game. e.g. 'space-invaders'" },
        message: { type: "string", description: "Commit message describing the update." },
      },
      required: ["id", "message"],
    },
  },
  {
    name: "check_deploy_status",
    description:
      "Check the deployment status of a game on Cloudflare Pages. Returns the latest deployment status and URL.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID. e.g. 'space-invaders'" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_deployed_games",
    description:
      "List all games currently deployed on FreeGameStore. Returns game names, IDs, URLs, and categories from the store registry.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a URL and return the response body. Useful for checking if a deployed game is live, reading remote files, or verifying URLs.",
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
    name: "search_files",
    description:
      "Search across all project files for a text pattern (case-insensitive). Returns matching lines with file paths. Use for finding usages, debugging, or understanding the codebase.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text to search for (case-insensitive substring match)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "run_compliance_check",
    description:
      "Run FreeGameStore compliance checks against the current project files. Validates: MIT license, no tracking SDKs, brand fonts (Manrope + Fraunces), CSS variables, HTML meta tags, PWA manifest, overflow hidden, freegamestore.online link, pnpm workspace. Returns pass/fail for each check with details. Run this BEFORE deploying to catch issues early.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_build_logs",
    description:
      "Get the latest Cloudflare Pages build/deploy logs for a game. Use when a deploy fails or the game isn't working to see build errors, missing dependencies, or compilation failures.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID. e.g. 'space-invaders'" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_ci_results",
    description:
      "Get GitHub Actions CI check results (compliance checks) for a game's repo. Shows which checks passed/failed and error details. Use to diagnose compliance failures after pushing code.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID (same as GitHub repo name)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_audit_results",
    description:
      "Get quality audit results for a game from the FreeGameStore auditor. Shows compliance score, viewport coverage, and any issues found. Use to understand what needs fixing for quality approval.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Game ID. e.g. 'space-invaders'" },
      },
      required: ["id"],
    },
  },
];

/** Infra tools that need env/network access — handled by the session DO */
export const INFRA_TOOLS = new Set([
  "deploy", "push_update", "check_deploy_status", "list_deployed_games",
  "fetch_url", "get_build_logs", "get_ci_results", "get_audit_results",
]);

export function executeTool(
  toolCall: ToolCall,
  files: Map<string, string>,
): ToolResult {
  const { name, input, id } = toolCall;

  switch (name) {
    case "write_file": {
      const path = input.path as string;
      const content = input.content as string;
      if (!path) return { id, content: "Error: path is required", isError: true };
      files.set(path, content);
      return { id, content: `Wrote ${path} (${content.length} bytes)` };
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
      const pattern = (input.pattern as string || "").toLowerCase();
      if (!pattern) return { id, content: "Error: pattern is required", isError: true };
      const matches: string[] = [];
      for (const [path, content] of files) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(pattern)) {
            matches.push(`${path}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }
      return { id, content: matches.length ? matches.slice(0, 50).join("\n") : `No matches for "${pattern}"` };
    }

    case "run_compliance_check": {
      return { id, content: runComplianceCheck(files) };
    }

    default:
      // Infra tools are handled by the session, not here
      return { id, content: `Unknown tool: ${name}`, isError: true };
  }
}

/** Run compliance checks locally on the virtual filesystem */
function runComplianceCheck(files: Map<string, string>): string {
  const results: string[] = [];
  const pass = (name: string) => results.push(`PASS: ${name}`);
  const fail = (name: string, detail: string) => results.push(`FAIL: ${name} — ${detail}`);

  // MIT License
  const license = files.get("LICENSE");
  if (license && /mit/i.test(license)) pass("MIT License");
  else fail("MIT License", "Missing LICENSE file or not MIT");

  // No .env.production
  if (!files.has(".env.production") && !files.has("web/.env.production")) pass("No .env.production");
  else fail("No .env.production", ".env.production found in project");

  // No tracking SDKs
  const forbidden = /google-analytics|gtag|amplitude|mixpanel|segment|hotjar|plausible|posthog/i;
  let hasTracking = false;
  for (const [path, content] of files) {
    if (path.startsWith("web/src/") && forbidden.test(content)) { hasTracking = true; break; }
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

  // CSS variables
  const hasVars = /--bg/.test(css) && /--ink/.test(css) && /--accent/.test(css);
  if (hasVars) pass("CSS variables (--bg, --ink, --accent)");
  else fail("CSS variables", "Missing --bg, --ink, or --accent in index.css");

  // HTML meta tags
  const html = files.get("web/index.html") || "";
  const hasLang = /lang=/.test(html);
  const hasViewport = /viewport/.test(html);
  const hasTitle = /<title>/.test(html);
  if (hasLang && hasViewport && hasTitle) pass("HTML meta tags (lang, viewport, title)");
  else fail("HTML meta tags", `Missing: ${[!hasLang && "lang", !hasViewport && "viewport", !hasTitle && "title"].filter(Boolean).join(", ")}`);

  // PWA manifest
  const manifest = files.get("web/public/manifest.json") || "";
  const hasManifest = /name/.test(manifest) && /display/.test(manifest) && /start_url/.test(manifest);
  if (hasManifest) pass("PWA manifest");
  else fail("PWA manifest", "Missing name, display, or start_url in manifest.json");

  // PWA meta tags
  const hasPWAMeta = /apple-mobile-web-app-capable|mobile-web-app-capable/i.test(html);
  if (hasPWAMeta) pass("PWA meta tags");
  else fail("PWA meta tags", "Missing apple-mobile-web-app-capable or mobile-web-app-capable");

  // FreeGameStore link
  let hasFGSLink = false;
  for (const [path, content] of files) {
    if (path.startsWith("web/src/") && content.includes("freegamestore.online")) { hasFGSLink = true; break; }
  }
  if (hasFGSLink) pass("FreeGameStore link in source");
  else fail("FreeGameStore link", "No reference to freegamestore.online in web/src/");

  // Overflow hidden
  let hasOverflowHidden = false;
  if (/overflow:\s*hidden/i.test(css) || /overflow-hidden/.test(css)) hasOverflowHidden = true;
  if (hasOverflowHidden) pass("Overflow hidden");
  else fail("Overflow hidden", "Body or #root must have overflow: hidden for games");

  // pnpm workspace
  const rootPkg = files.get("package.json") || "";
  const hasWS = files.has("pnpm-workspace.yaml") && /pnpm/.test(rootPkg);
  if (hasWS) pass("pnpm workspace");
  else fail("pnpm workspace", "Missing pnpm-workspace.yaml or pnpm reference in package.json");

  // No APPNAME placeholders
  let hasPlaceholder = false;
  for (const [, content] of files) {
    if (/APPNAME/.test(content)) { hasPlaceholder = true; break; }
  }
  if (!hasPlaceholder) pass("No APPNAME placeholders");
  else fail("APPNAME placeholders", "Found unreplaced APPNAME placeholder in project files");

  const passes = results.filter(r => r.startsWith("PASS")).length;
  const fails = results.filter(r => r.startsWith("FAIL")).length;
  return `Compliance: ${passes} pass, ${fails} fail\n\n${results.join("\n")}`;
}
