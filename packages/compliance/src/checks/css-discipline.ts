import { type CssRule, isSourceCss, parseCss } from '../lib/css.js';
import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * CSS structure for the Tailwind-on-tokens model (ADR-001, platform#390).
 * `index.css` holds tokens, `@theme` and `@layer` rules only. Five rules,
 * all WARN for now; they flip to `fail` after the fleet rollout (#398):
 *
 *   - banned-alias            a retired token alias (--surface, --border,
 *                             --glass, --dock, --error) is declared or used
 *   - unlayered-rule          a style rule outside `@layer` (token blocks excepted)
 *   - hex-outside-tokens      a hex colour outside a token block or `@theme`
 *   - per-screen-dark-override a dark-mode rule that is not a `:root` token block
 *   - feature-classes         a class selector (`.score-badge`): build a component
 *
 * `--bg` is deliberately not banned: the `brand-tokens` check still requires
 * it for games.
 */

type RuleId =
  | 'banned-alias'
  | 'unlayered-rule'
  | 'hex-outside-tokens'
  | 'per-screen-dark-override'
  | 'feature-classes';

const BANNED_ALIASES = ['--surface', '--border', '--glass', '--dock', '--error'];
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const TOKEN_SELECTOR_RE =
  /^(?::root|html|\.dark|\[data-theme[^\]]*\])(?:\[[^\]]*\]|:not\([^)]*\))*$/;

const SUGGESTIONS: Record<RuleId, string> = {
  'banned-alias':
    'Use the tokens (--paper, --panel, --ink, --muted, --line, --accent) and --danger instead of --error; drop --surface, --border, --glass and --dock.',
  'unlayered-rule':
    'Wrap base rules in `@layer base { … }`. index.css holds only @import, @source, token blocks, @theme and @layer.',
  'hex-outside-tokens':
    'Define the colour once as a token in :root and use a token utility (bg-panel, text-ink, …).',
  'per-screen-dark-override':
    'Redefine tokens in a `:root` dark block instead of overriding individual selectors; components then follow the scheme for free.',
  'feature-classes':
    'Build a React component styled with Tailwind utilities instead of a `.feature-class` in CSS.',
};

function isTokenBlock(rule: CssRule): boolean {
  // A root block that defines at least one token is a token block; color-scheme and
  // font-family riding along in :root are fine.
  if (!rule.decls.some((d) => d.prop.startsWith('--'))) return false;
  return rule.selector.split(',').every((s) => TOKEN_SELECTOR_RE.test(s.trim()));
}

function stripSelectorNoise(selector: string): string {
  return selector.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"|'[^']*'/g, '');
}

export async function checkCssDiscipline(source: FileSource): Promise<CheckResult> {
  const hits: { id: RuleId; where: string }[] = [];

  for await (const path of source.list()) {
    if (!isSourceCss(path)) continue;
    const raw = await source.read(path);
    if (!raw) continue;

    for (const rule of parseCss(raw)) {
      const at = `${path}:${rule.line}`;
      const isTheme = rule.selector.startsWith('@theme');
      const tokens = isTheme || isTokenBlock(rule);
      const layers = rule.atRules.filter((a) => /^@layer\b/i.test(a));
      const inBaseLayer = layers.some((a) => /^@layer\s+base\b/i.test(a));
      const dark = rule.atRules.some((a) => /prefers-color-scheme\s*:\s*dark/i.test(a));

      for (const d of rule.decls) {
        const banned = BANNED_ALIASES.find(
          (b) => d.prop === b || new RegExp(`var\\(\\s*${b}\\b`).test(d.value),
        );
        if (banned) hits.push({ id: 'banned-alias', where: `${path}:${d.line} ${banned}` });
        if (!tokens && HEX_RE.test(d.value)) {
          hits.push({ id: 'hex-outside-tokens', where: `${path}:${d.line} ${d.prop}` });
        }
      }

      if (rule.selector.startsWith('@') || tokens) continue;

      if (layers.length === 0) hits.push({ id: 'unlayered-rule', where: `${at} ${rule.selector}` });
      const darkSelector =
        /(?:^|,)\s*(?:\.dark|\[data-theme=["']?dark["']?\]|:root\[data-theme=["']?dark["']?\])\s+\S/.test(
          rule.selector,
        );
      if (dark || darkSelector)
        hits.push({ id: 'per-screen-dark-override', where: `${at} ${rule.selector}` });
      if (!inBaseLayer && /\.[A-Za-z_-]/.test(stripSelectorNoise(rule.selector))) {
        hits.push({ id: 'feature-classes', where: `${at} ${rule.selector}` });
      }
    }
  }

  if (hits.length === 0) {
    return {
      name: 'CSS discipline',
      status: 'pass',
      detail: 'CSS holds only tokens, @theme and @layer rules',
    };
  }

  const counts = new Map<RuleId, number>();
  for (const h of hits) counts.set(h.id, (counts.get(h.id) ?? 0) + 1);
  const summary = [...counts].map(([id, n]) => `${id} ${n}`).join(', ');
  const examples = hits
    .slice(0, 3)
    .map((h) => `${h.id}: ${h.where}`)
    .join('; ');

  return {
    name: 'CSS discipline',
    status: 'warn',
    detail: `${hits.length} issue(s) (${summary}). e.g. ${examples}${hits.length > 3 ? '…' : ''}`,
    suggestions: [...counts.keys()].map((id) => SUGGESTIONS[id]),
  };
}
