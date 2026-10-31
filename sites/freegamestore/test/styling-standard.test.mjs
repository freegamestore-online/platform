import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #391: the styling standard (ADR-001) must exist and the docs that point at
// it must agree with it.

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SITE, '..', '..');
const read = (...parts) => readFileSync(join(...parts), 'utf8');

const ADR_PATH = join(REPO, 'docs', 'adr', '001-tailwind-on-fgs-tokens.md');
const adr = () => read(ADR_PATH);
const skills = () => read(SITE, 'SKILLS.md');
const guidelines = () => read(SITE, 'docs', 'src', 'content', 'docs', 'guidelines.md');
const claude = () => read(REPO, 'CLAUDE.md');

test('ADR-001 exists with status, the three layers and scope', () => {
  assert.ok(existsSync(ADR_PATH), 'docs/adr/001-tailwind-on-fgs-tokens.md must exist');
  const text = adr();
  assert.match(text, /^# ADR-001:/m);
  assert.match(text, /\*\*Status:\*\* Accepted/);
  for (const heading of ['Context', 'Decision', 'Consequences', 'Alternatives considered']) {
    assert.match(text, new RegExp(`^## ${heading}`, 'm'), `missing "${heading}" section`);
  }
  assert.match(text, /@theme inline/);
  assert.match(text, /@source/);
  assert.match(text, /canvas and WebGL rendering/i);
  assert.match(text, /runtime-injected CSS|No runtime-injected CSS/i);
  assert.match(text, /opaque/i);
});

test('ADR-001 names every surface it applies to', () => {
  const text = adr();
  for (const surface of ['games-sdk', 'apps/console', 'apps/admin', 'template-game-']) {
    assert.ok(text.includes(surface), `ADR must mention ${surface}`);
  }
});

test('SKILLS.md, guidelines and CLAUDE.md all point at ADR-001', () => {
  for (const [name, text] of [
    ['SKILLS.md', skills()],
    ['guidelines.md', guidelines()],
    ['CLAUDE.md', claude()],
  ]) {
    assert.match(text, /001-tailwind-on-fgs-tokens/, `${name} must link ADR-001`);
  }
});

test('SKILLS.md and guidelines require Tailwind and carry the utility table', () => {
  for (const [name, text] of [
    ['SKILLS.md', skills()],
    ['guidelines.md', guidelines()],
  ]) {
    assert.match(text, /Tailwind/i, `${name} must name Tailwind`);
    assert.match(text, /required/i, `${name} must say Tailwind is required`);
    for (const utility of ['`bg-surface`', '`text-ink`', '`text-muted`', '`border border-border`', '`text-accent`']) {
      assert.ok(text.includes(utility), `${name} utility table missing ${utility}`);
    }
    assert.match(text, /No feature classes/i, `${name} must forbid feature classes`);
    assert.match(text, /No static inline styles/i, `${name} must forbid static inline styles`);
    assert.match(text, /No injected CSS/i, `${name} must forbid injected CSS`);
    assert.match(text, /bg-popover/, `${name} must require an opaque floating surface`);
  }
});

test('CLAUDE.md carries the one-line styling rule', () => {
  const text = claude();
  assert.match(text, /All UI, including games-sdk\/console\/admin, is React \+ Tailwind on tokens/);
  assert.match(text, /no inline styles or injected CSS/);
  assert.match(text, /don't invent a different convention/);
});
