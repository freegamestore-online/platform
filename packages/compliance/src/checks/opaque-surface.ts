import { colorAlpha, isSourceCss, parseCss } from '../lib/css.js';
import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Floating UI (menus, modals, popovers, result screens) sits on `--panel`,
 * `--paper` or `--popover`. A translucent value lets the game or page show
 * through and makes the text unreadable (the transparent mobile menu in
 * FAS platform#319). Warns when any of those tokens has alpha < 1.
 *
 * WARN level (ADR-001, platform#390); flips to `fail` after the fleet
 * rollout (#398). Values the checker can't resolve (`var(--x)`) are ignored.
 */

const SURFACE_TOKENS = new Set(['--paper', '--panel', '--popover']);

export async function checkOpaqueSurface(source: FileSource): Promise<CheckResult> {
  const hits: { where: string; token: string; value: string; alpha: number }[] = [];

  for await (const path of source.list()) {
    if (!isSourceCss(path)) continue;
    const raw = await source.read(path);
    if (!raw) continue;
    for (const rule of parseCss(raw)) {
      for (const d of rule.decls) {
        if (!SURFACE_TOKENS.has(d.prop)) continue;
        const alpha = colorAlpha(d.value);
        if (alpha !== null && alpha < 1) {
          hits.push({ where: `${path}:${d.line}`, token: d.prop, value: d.value, alpha });
        }
      }
    }
  }

  if (hits.length === 0) {
    return {
      name: 'Opaque surfaces',
      status: 'pass',
      detail: '--paper, --panel and --popover are opaque wherever they are defined',
    };
  }

  return {
    name: 'Opaque surfaces',
    status: 'warn',
    detail: `${hits.length} translucent surface token(s): ${hits
      .slice(0, 3)
      .map((h) => `${h.where} ${h.token}: ${h.value} (alpha ${Number(h.alpha.toFixed(2))})`)
      .join('; ')}${hits.length > 3 ? '…' : ''}`,
    suggestions: [
      'Use an opaque colour for --paper, --panel and --popover. Menus, modals and result screens use them, and a translucent surface lets the game show through the text.',
      'A translucent scrim behind a dialog is fine; the dialog surface itself must be opaque.',
    ],
  };
}
