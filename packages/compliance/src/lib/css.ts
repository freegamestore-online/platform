/**
 * A small, dependency-free CSS reader for the styling checks. It is not a
 * validating parser: it understands comments, strings, parentheses, nested
 * at-rule blocks (`@layer`, `@media`, `@supports`, `@container`) and
 * declaration blocks, which is all `css-discipline` and `opaque-surface`
 * need. Staying dependency-free keeps `@freegamestore/compliance/worker`
 * bundle-safe for Cloudflare Workers.
 */

export interface CssDecl {
  prop: string;
  value: string;
  line: number;
}

export interface CssRule {
  /** Selector text, or the at-rule prelude (`@theme inline`) for declaration at-rules. */
  selector: string;
  /** Enclosing at-rule preludes, outermost first (`@layer base`, `@media (…)`). */
  atRules: string[];
  decls: CssDecl[];
  line: number;
}

/** At-rules whose block holds declarations rather than nested rules. */
const DECL_AT_RULES = new Set(['theme', 'font-face', 'property', 'page', 'counter-style']);
/** At-rules whose block we skip entirely. */
const SKIP_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'font-feature-values']);

/** Replace comment bodies with spaces (newlines kept) so line numbers survive. */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function parseCss(source: string): CssRule[] {
  const src = blankComments(source);
  const rules: CssRule[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (idx: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  /** Read up to the next top-level `{`, `;` or `}`; returns the terminator index. */
  const readPrelude = (from: number): { text: string; end: number; start: number } => {
    let i = from;
    while (i < src.length && /\s/.test(src[i]!)) i++;
    const start = i;
    let paren = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') paren++;
      else if (c === ')' || c === ']') paren = Math.max(0, paren - 1);
      else if (paren === 0 && (c === '{' || c === ';' || c === '}')) break;
    }
    return { text: src.slice(start, i).trim(), end: i, start };
  };

  /** Skip a `{ … }` block starting at the `{`; returns the index after the `}`. */
  const skipBlock = (open: number): number => {
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i + 1;
    }
    return src.length;
  };

  const parseDecls = (open: number, rule: CssRule): number => {
    let i = open + 1;
    while (i < src.length) {
      const p = readPrelude(i);
      if (p.end >= src.length) return src.length;
      const term = src[p.end];
      if (term === '}') {
        pushDecl(p.text, p.start, rule);
        return p.end + 1;
      }
      if (term === ';') {
        pushDecl(p.text, p.start, rule);
        i = p.end + 1;
        continue;
      }
      // Nested rule (`&:hover { … }`): not a declaration, skip it.
      i = skipBlock(p.end);
    }
    return i;
  };

  const pushDecl = (text: string, at: number, rule: CssRule): void => {
    if (!text) return;
    const colon = text.indexOf(':');
    if (colon <= 0) return;
    rule.decls.push({
      prop: text.slice(0, colon).trim(),
      value: text.slice(colon + 1).trim(),
      line: lineAt(at),
    });
  };

  const parseRules = (from: number, parents: string[]): number => {
    let i = from;
    while (i < src.length) {
      const p = readPrelude(i);
      if (p.end >= src.length) return src.length;
      const term = src[p.end];
      if (term === '}') return p.end + 1;
      if (term === ';') {
        i = p.end + 1;
        continue;
      }
      // term === '{'
      const prelude = p.text;
      if (prelude.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        if (SKIP_AT_RULES.has(name)) {
          i = skipBlock(p.end);
        } else if (DECL_AT_RULES.has(name)) {
          const rule: CssRule = {
            selector: prelude,
            atRules: parents,
            decls: [],
            line: lineAt(p.start),
          };
          rules.push(rule);
          i = parseDecls(p.end, rule);
        } else {
          i = parseRules(p.end + 1, [...parents, prelude]);
        }
      } else {
        const rule: CssRule = {
          selector: prelude,
          atRules: parents,
          decls: [],
          line: lineAt(p.start),
        };
        rules.push(rule);
        i = parseDecls(p.end, rule);
      }
    }
    return i;
  };

  parseRules(0, []);
  return rules;
}

/**
 * Alpha of a CSS colour value, or null when it can't be told (a `var()`, a
 * keyword other than `transparent`, a gradient). 1 means fully opaque.
 */
export function colorAlpha(value: string): number | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  if (v === 'transparent') return 0;

  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 4) return Number.parseInt(hex[3]! + hex[3]!, 16) / 255;
    if (hex.length === 8) return Number.parseInt(hex.slice(6), 16) / 255;
    return 1;
  }

  const fn = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/.exec(v);
  if (fn) {
    const args = fn[2]!;
    const slash = args.lastIndexOf('/');
    if (slash !== -1) return parseAlpha(args.slice(slash + 1));
    if (fn[1] === 'rgba' || fn[1] === 'hsla') {
      const parts = args.split(',');
      if (parts.length === 4) return parseAlpha(parts[3]!);
    }
    return 1;
  }

  if (v.startsWith('color-mix(') && /\btransparent\b/.test(v)) return 0;
  return null;
}

function parseAlpha(raw: string): number | null {
  const s = raw.trim();
  if (s.endsWith('%')) {
    const n = Number.parseFloat(s);
    return Number.isNaN(n) ? null : n / 100;
  }
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** True for hand-written CSS: not build output (`dist`, `build`), not served static assets (`public`), not minified. */
export function isSourceCss(path: string): boolean {
  if (!path.endsWith('.css') || path.endsWith('.min.css')) return false;
  return !path.split('/').some((seg) => seg === 'public' || seg === 'dist' || seg === 'build');
}
