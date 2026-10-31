import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

/**
 * `fgs migrate tailwind-tokens` (platform#397, epic #390, ADR-001): rewrite long-hand
 * `text-[var(--muted)]` utilities to the token utilities the `@theme inline` block maps
 * (`text-muted`), and inline each retired alias (`--surface`, `--border`, `--glass`,
 * `--dock`, `--error`) by the app's OWN definition of it. Dry-run unless `write` is set.
 *
 * Vendored from the PAS codemod (proappstore-online/platform#494). It deliberately has no
 * dependency on `@proappstore/cli` or on compliance internals, so any agent in any game
 * repo can run it. `--bg` is NOT retired: the `brand-tokens` check still requires it.
 */

/** The token -> Tailwind colour mapping; the same set the templates map in `@theme inline` (#392). */
const COLOR_TOKENS = [
  'paper',
  'ink',
  'muted',
  'line',
  'line-strong',
  'panel',
  'accent',
  'accent-soft',
  'success',
  'warning',
  'danger',
];
const BANNED_ALIASES = ['surface', 'border', 'glass', 'dock', 'error'];
/** `--error` has no equivalent token to point at: it is renamed to `--danger` instead. */
const RENAMED_ALIASES: Record<string, string> = { error: 'danger' };
// Longest first so `border-t` wins over `border`. No `rounded`/`shadow`: FGS maps colours only.
const PREFIXES = [
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'text',
  'bg',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'divide',
  'from',
  'via',
  'to',
];

// A whole class token: (variants:)* prefix-[var(--token)] (/opacity)?. The lookbehind and
// lookahead keep it from matching inside a longer token, so a bare '[var(--ink)]' or CSS-in-JS
// `color: var(--ink)` is never touched.
const LONG_HAND = new RegExp(
  `(?<![\\w\\[\\]&>*.#=:/-])((?:[\\w\\[\\]&>*.#=-]+:)*)(${PREFIXES.join('|')})-\\[var\\(--([a-z][\\w-]*)\\)\\](\\/(?:\\d+|\\[[\\w.%]+\\]))?(?![\\w\\[\\]-])`,
  'g',
);

export interface FileChange {
  file: string;
  replacements: number;
  diff: string;
}

export interface MigrateResult {
  dir: string;
  write: boolean;
  changes: FileChange[];
  replacements: number;
  /** Tokens left alone (not mapped, or not defined by the app), with use counts. */
  unknownTokens: Record<string, number>;
  /** Aliases replaced by the token they pointed at, definition deleted. */
  inlinedAliases: { alias: string; target: string }[];
  /** Aliases renamed to the token that replaces them (`--error` -> `--danger`). */
  renamedAliases: { alias: string; target: string }[];
  /** Aliases left in place, with the reason (a light/dark conflict, a non-token value, …). */
  skippedAliases: { alias: string; reason: string }[];
  themeInserted: boolean;
  /** What the codemod cannot fix, for an agent to follow up. */
  report: string[];
  /** Counts of what is left behind, summed over every source dir. */
  leftovers: {
    unlayeredRules: number;
    hexValues: number;
    darkOverrides: number;
    inlineStyles: number;
  };
}

interface CssDecl {
  name: string;
  value: string;
  start: number;
  end: number;
  selectors: string[];
}
interface CssRule {
  selector: string;
  ancestors: string[];
}

/** A small CSS reader: declarations and rules with their enclosing selectors; comments blanked. */
function parseCss(css: string): { decls: CssDecl[]; rules: CssRule[] } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const decls: CssDecl[] = [];
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let seg = 0;
  let paren = 0;
  let quote = '';
  const statement = (end: number, stop: number) => {
    const raw = text.slice(seg, stop);
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('@')) return;
    const colon = trimmed.indexOf(':');
    if (colon < 0) return;
    const start = seg + raw.indexOf(trimmed);
    decls.push({
      name: trimmed.slice(0, colon).trim(),
      value: trimmed.slice(colon + 1).trim(),
      start,
      end,
      selectors: [...stack],
    });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') {
      paren++;
      continue;
    }
    if (c === ')') {
      paren--;
      continue;
    }
    if (paren > 0) continue;
    if (c === '{') {
      const selector = text.slice(seg, i).trim();
      stack.push(selector);
      rules.push({ selector, ancestors: [...stack] });
      seg = i + 1;
    } else if (c === ';') {
      statement(i + 1, i);
      seg = i + 1;
    } else if (c === '}') {
      statement(i, i);
      stack.pop();
      seg = i + 1;
    }
  }
  return { decls, rules };
}

const isDark = (selectors: string[]) => selectors.some((s) => /dark/.test(s));
const isTokenSelector = (sel: string) =>
  !!sel &&
  sel
    .split(',')
    .every(
      (p) => /^(:root|html|body)?(\[data-theme[^\]]*\]|\.dark)?$/.test(p.trim()) && p.trim() !== '',
    );

function listFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => {
      const parts = f.split('/');
      return (
        !parts.includes('node_modules') && !parts.includes('dist') && /\.(css|tsx|jsx|ts)$/.test(f)
      );
    })
    .sort();
}

/** The alias -> target each retired alias resolves to in this app's own CSS, or why not. */
function resolveAliases(css: string): {
  inline: Map<string, string>;
  skipped: { alias: string; reason: string }[];
} {
  const { decls } = parseCss(css);
  const inline = new Map<string, string>();
  const skipped: { alias: string; reason: string }[] = [];
  const single = (alias: string) => {
    const mine = decls.filter((d) => d.name === `--${alias}`);
    if (!mine.length) return null;
    const bad = mine.find((d) => !/^var\(--[\w-]+\)$/.test(d.value));
    if (bad) return `resolves to \`${bad.value}\`, not a single token`;
    const targets = (dark: boolean) => [
      ...new Set(mine.filter((d) => isDark(d.selectors) === dark).map((d) => d.value.slice(6, -1))),
    ];
    const light = targets(false);
    const dark = targets(true);
    if (!light.length) return 'defined only in the dark block';
    if (light.length > 1)
      return `resolves to different tokens in the light rules (${light.map((t) => `--${t}`).join(', ')})`;
    if (dark.length > 1)
      return `resolves to different tokens in the dark rules (${dark.map((t) => `--${t}`).join(', ')})`;
    if (dark.length && dark[0] !== light[0])
      return `resolves to --${light[0]} in light but --${dark[0]} in dark`;
    inline.set(alias, light[0] as string);
    return null;
  };
  for (const alias of BANNED_ALIASES) {
    const why = single(alias);
    if (why) skipped.push({ alias: `--${alias}`, reason: why });
  }
  // An alias may point at another alias; follow it, and drop it if that one was skipped.
  for (const [alias, target] of [...inline]) {
    let t = target;
    for (let n = 0; n < 5 && BANNED_ALIASES.includes(t); n++) {
      const next = inline.get(t);
      if (!next) {
        inline.delete(alias);
        skipped.push({ alias: `--${alias}`, reason: `points at --${t}, which was skipped` });
        t = '';
        break;
      }
      t = next;
    }
    if (t && inline.has(alias)) inline.set(alias, t);
  }
  return { inline, skipped };
}

/** Delete the declarations of the given custom properties, and the line if it is left blank. */
function deleteDecls(css: string, names: Set<string>): string {
  const doomed = parseCss(css)
    .decls.filter((d) => names.has(d.name))
    .sort((a, b) => b.start - a.start);
  let out = css;
  for (const d of doomed) {
    let from = d.start;
    let to = d.end;
    const lineStart = out.lastIndexOf('\n', from - 1) + 1;
    const lineEnd = out.indexOf('\n', to);
    const lineTail = out.slice(to, lineEnd < 0 ? out.length : lineEnd);
    if (!out.slice(lineStart, from).trim() && !lineTail.trim()) {
      from = lineStart;
      to = lineEnd < 0 ? out.length : lineEnd + 1;
    }
    out = out.slice(0, from) + out.slice(to);
  }
  return out;
}

/** Rename the declarations of one custom property in place. */
function renameDecls(css: string, from: string, to: string): string {
  const targets = parseCss(css)
    .decls.filter((d) => d.name === from)
    .sort((a, b) => b.start - a.start);
  let out = css;
  for (const d of targets) out = out.slice(0, d.start) + to + out.slice(d.start + from.length);
  return out;
}

function themeBlock(defined: Set<string>): string {
  const lines: string[] = [];
  for (const t of COLOR_TOKENS) if (defined.has(t)) lines.push(`  --color-${t}: var(--${t});`);
  return lines.length ? `@theme inline {\n${lines.join('\n')}\n}\n` : '';
}

function insertTheme(css: string, block: string): string | null {
  const lines = css.split('\n');
  let at = -1;
  lines.forEach((l, i) => {
    if (/^\s*@source\b/.test(l)) at = i;
  });
  if (at < 0)
    lines.forEach((l, i) => {
      if (at < 0 && /^\s*@import\s+["']tailwindcss["']/.test(l)) at = i;
    });
  if (at < 0) return null;
  lines.splice(at + 1, 0, '', ...block.trimEnd().split('\n'));
  return lines.join('\n');
}

/** Unified diff; edits here are sparse, so a greedy resync is enough. */
function unifiedDiff(file: string, a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const ops: { t: ' ' | '-' | '+'; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push({ t: ' ', s: x[i] as string });
      i++;
      j++;
      continue;
    }
    let del = -1;
    let ins = -1;
    for (let k = 1; k <= 60 && (del < 0 || ins < 0); k++) {
      if (del < 0 && j < y.length && x[i + k] === y[j]) del = k;
      if (ins < 0 && i < x.length && y[j + k] === x[i]) ins = k;
    }
    if (del > 0 && (ins < 0 || del <= ins)) {
      for (let k = 0; k < del; k++) ops.push({ t: '-', s: x[i++] as string });
    } else if (ins > 0) {
      for (let k = 0; k < ins; k++) ops.push({ t: '+', s: y[j++] as string });
    } else {
      if (i < x.length) ops.push({ t: '-', s: x[i++] as string });
      if (j < y.length) ops.push({ t: '+', s: y[j++] as string });
    }
  }
  const out = [`--- a/${file}`, `+++ b/${file}`];
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, n) => {
    if (o.t !== ' ')
      for (let k = Math.max(0, n - 3); k <= Math.min(ops.length - 1, n + 3); k++) keep[k] = true;
  });
  let n = 0;
  let ai = 1;
  let bi = 1;
  while (n < ops.length) {
    const op = ops[n] as { t: ' ' | '-' | '+'; s: string };
    if (!keep[n]) {
      if (op.t !== '+') ai++;
      if (op.t !== '-') bi++;
      n++;
      continue;
    }
    const hunk: string[] = [];
    const sa = ai;
    const sb = bi;
    let ca = 0;
    let cb = 0;
    for (; n < ops.length && keep[n]; n++) {
      const o = ops[n] as { t: ' ' | '-' | '+'; s: string };
      hunk.push(o.t + o.s);
      if (o.t !== '+') {
        ca++;
        ai++;
      }
      if (o.t !== '-') {
        cb++;
        bi++;
      }
    }
    out.push(`@@ -${sa},${ca} +${sb},${cb} @@`, ...hunk);
  }
  return `${out.join('\n')}\n`;
}

interface CssIssues {
  messages: string[];
  unlayered: number;
  hex: number;
  dark: number;
}

/** What the codemod cannot fix in the app's CSS: unlayered rules, hex outside tokens, per-screen dark overrides. */
function detectCssIssues(file: string, css: string): CssIssues {
  const { decls, rules } = parseCss(css);
  const unlayered = rules.filter((r) => {
    if (r.ancestors.some((a) => /^@(layer|theme|font-face|keyframes|property)\b/.test(a)))
      return false;
    if (/^@/.test(r.selector)) return false;
    return !isTokenSelector(r.selector);
  });
  const darkOverrides = rules.filter(
    (r) =>
      !r.ancestors.some((a) => /^@layer\b/.test(a)) &&
      !/^@/.test(r.selector) &&
      /dark/.test(r.ancestors.join(' ')) &&
      !isTokenSelector(r.selector),
  );
  const hex = decls.filter(
    (d) =>
      /#[0-9a-f]{3,8}\b/i.test(d.value) &&
      !d.selectors.some((s) => isTokenSelector(s) || /^@(theme|font-face)\b/.test(s)),
  );
  const messages: string[] = [];
  const firstUnlayered = unlayered[0];
  const firstHex = hex[0];
  const firstDark = darkOverrides[0];
  if (firstUnlayered)
    messages.push(
      `${file}: ${unlayered.length} unlayered rule(s) outside @layer (e.g. \`${firstUnlayered.selector}\`); move to a component or @layer base`,
    );
  if (firstHex)
    messages.push(
      `${file}: ${hex.length} hard-coded hex value(s) outside the token blocks (e.g. \`${firstHex.name}: ${firstHex.value}\`); use a token`,
    );
  if (firstDark)
    messages.push(
      `${file}: ${darkOverrides.length} per-screen dark override(s) (e.g. \`${firstDark.selector}\`); define the token for dark instead`,
    );
  return {
    messages,
    unlayered: unlayered.length,
    hex: hex.length,
    dark: darkOverrides.length,
  };
}

/** Count `style={{` that carry no "dynamic" comment on the line or the three above it. */
function countInlineStyles(source: string): number {
  const lines = source.split(/\r?\n/);
  let n = 0;
  lines.forEach((line, i) => {
    const hits = line.split('style={{').length - 1;
    if (!hits) return;
    if (!/dynamic/i.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n'))) n += hits;
  });
  return n;
}

/**
 * The source dirs to migrate under `root`: a game's `web/src`, or the platform's
 * `apps/console/web/src` and `apps/admin/web/src`. `root` may also be a `web` dir.
 */
function findSourceDirs(root: string): string[] {
  const candidates = [
    join(root, 'web', 'src'),
    ...(basename(root) === 'web' ? [join(root, 'src')] : []),
    join(root, 'apps', 'console', 'web', 'src'),
    join(root, 'apps', 'admin', 'web', 'src'),
  ];
  return candidates.filter((d) => existsSync(d));
}

const bumpMap = (m: Map<string, number>, key: string, n: number) =>
  m.set(key, (m.get(key) ?? 0) + n);

export async function migrateTailwindTokens(opts: {
  dir: string;
  write: boolean;
}): Promise<MigrateResult> {
  const root = resolve(opts.dir);
  const sources = findSourceDirs(root);
  if (sources.length === 0) {
    throw new Error(`No web/src under ${root}; pass --dir <game repo root>.`);
  }

  const result: MigrateResult = {
    dir: root,
    write: opts.write,
    changes: [],
    replacements: 0,
    unknownTokens: {},
    inlinedAliases: [],
    renamedAliases: [],
    skippedAliases: [],
    themeInserted: false,
    report: [],
    leftovers: { unlayeredRules: 0, hexValues: 0, darkOverrides: 0, inlineStyles: 0 },
  };

  for (const src of sources) {
    const rel = (f: string) => relative(root, join(src, f)).replace(/\\/g, '/');
    const names = listFiles(src);
    const original = new Map(names.map((f) => [f, readFileSync(join(src, f), 'utf8')]));
    const work = new Map(original);
    const counts = new Map<string, number>();
    const indexCss = 'index.css';
    const hasIndex = work.has(indexCss);

    // 0. `--error` has no token to point at: rename it to `--danger` when the app has no `--danger`.
    if (hasIndex) {
      for (const [from, to] of Object.entries(RENAMED_ALIASES)) {
        const css = work.get(indexCss) as string;
        const names0 = new Set(parseCss(css).decls.map((d) => d.name));
        if (!names0.has(`--${from}`) || names0.has(`--${to}`)) continue;
        const sole = parseCss(css).decls.filter((d) => d.name === `--${from}`);
        // Only a literal value is renamed; `--error: var(--x)` is an alias and is inlined below.
        if (sole.some((d) => /^var\(--[\w-]+\)$/.test(d.value))) continue;
        work.set(indexCss, renameDecls(css, `--${from}`, `--${to}`));
        for (const [f, text] of work) {
          const re = new RegExp(`var\\(--${from}(?=[\\s,)])`, 'g');
          work.set(
            f,
            text.replace(re, () => {
              bumpMap(counts, f, 1);
              return `var(--${to}`;
            }),
          );
        }
        bumpMap(counts, indexCss, sole.length);
        result.renamedAliases.push({ alias: `--${from}`, target: `--${to}` });
      }
    }

    // 1. Retired aliases, by this app's own definition.
    const { inline, skipped } = hasIndex
      ? resolveAliases(work.get(indexCss) as string)
      : { inline: new Map<string, string>(), skipped: [] };
    if (inline.size) {
      work.set(
        indexCss,
        deleteDecls(work.get(indexCss) as string, new Set([...inline.keys()].map((a) => `--${a}`))),
      );
      for (const [f, text] of work) {
        let next = text;
        for (const [alias, target] of inline) {
          const re = new RegExp(`var\\(--${alias}(?=[\\s,)])`, 'g');
          next = next.replace(re, () => {
            bumpMap(counts, f, 1);
            return `var(--${target}`;
          });
        }
        work.set(f, next);
      }
      // A deleted definition counts as a change to index.css even with no other use.
      bumpMap(counts, indexCss, inline.size);
    }
    for (const alias of BANNED_ALIASES) {
      if (inline.has(alias) || skipped.some((s) => s.alias === `--${alias}`)) continue;
      if (result.renamedAliases.some((r) => r.alias === `--${alias}`)) continue;
      const uses = [...work.values()].reduce(
        (n, t) => n + (t.match(new RegExp(`var\\(--${alias}(?=[\\s,)])`, 'g'))?.length ?? 0),
        0,
      );
      if (uses) {
        result.report.push(
          `var(--${alias}) is used ${uses} time(s) but ${rel(indexCss)} does not define it; left as is`,
        );
      }
    }

    // 2. Long-hand utilities -> token utilities, for tokens this app defines.
    const defined = new Set<string>();
    for (const [f, text] of work) {
      if (!f.endsWith('.css')) continue;
      for (const d of parseCss(text).decls)
        if (d.name.startsWith('--')) defined.add(d.name.slice(2));
    }
    if (!hasIndex) result.report.push(`${rel(indexCss)} not found; no utilities rewritten`);
    for (const [f, text] of work) {
      if (!hasIndex || f.endsWith('.css')) continue;
      work.set(
        f,
        text.replace(
          LONG_HAND,
          (m, variants: string, prefix: string, token: string, opacity: string | undefined) => {
            if (!(COLOR_TOKENS.includes(token) && defined.has(token))) {
              result.unknownTokens[`--${token}`] = (result.unknownTokens[`--${token}`] ?? 0) + 1;
              return m;
            }
            bumpMap(counts, f, 1);
            return `${variants}${prefix}-${token}${opacity ?? ''}`;
          },
        ),
      );
    }

    // 3. The @theme inline block that makes those utilities exist.
    if (hasIndex) {
      const css = work.get(indexCss) as string;
      if (!/@theme\s+inline\s*\{/.test(css)) {
        const block = themeBlock(defined);
        const next = block ? insertTheme(css, block) : null;
        if (next) {
          work.set(indexCss, next);
          result.themeInserted = true;
          bumpMap(counts, indexCss, 1);
        } else {
          result.report.push(
            block
              ? `${rel(indexCss)} has no @source or @import "tailwindcss" line to insert @theme inline after`
              : `no FGS tokens defined in ${rel(indexCss)}; @theme inline not added`,
          );
        }
      }
    }

    // 4. What is left for an agent.
    for (const [f, text] of work) {
      if (f.endsWith('.css')) {
        const issues = detectCssIssues(rel(f), text);
        result.report.push(...issues.messages);
        result.leftovers.unlayeredRules += issues.unlayered;
        result.leftovers.hexValues += issues.hex;
        result.leftovers.darkOverrides += issues.dark;
      } else if (/\.(tsx|jsx)$/.test(f)) {
        result.leftovers.inlineStyles += countInlineStyles(text);
      }
    }
    for (const s of skipped) result.report.push(`${s.alias} left in place: ${s.reason}`);
    result.skippedAliases.push(...skipped);
    result.inlinedAliases.push(
      ...[...inline].map(([alias, target]) => ({ alias: `--${alias}`, target: `--${target}` })),
    );

    for (const [f, text] of work) {
      const before = original.get(f) as string;
      if (text === before) continue;
      result.changes.push({
        file: rel(f),
        replacements: counts.get(f) ?? 0,
        diff: unifiedDiff(rel(f), before, text),
      });
      if (opts.write) writeFileSync(join(src, f), text);
    }
  }

  for (const [token, n] of Object.entries(result.unknownTokens)) {
    result.report.push(
      `${token}: ${n} long-hand use(s) not rewritten (not in the token mapping or not defined by the app)`,
    );
  }
  if (result.leftovers.inlineStyles) {
    result.report.push(
      `${result.leftovers.inlineStyles} static inline style(s) (style={{ … }}) left; convert to token utilities, or comment the dynamic ones`,
    );
  }
  result.replacements = result.changes.reduce((n, c) => n + c.replacements, 0);
  return result;
}
