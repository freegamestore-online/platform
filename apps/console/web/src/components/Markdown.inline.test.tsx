import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

// #100: inline rules were tried in a fixed order (bold, italic, code, link,
// url), each matching ANYWHERE in the rest of the line and emitting everything
// before it as plain text. A link or code span that came before a later
// **bold** / *italic* was swallowed into that prefix and never parsed.

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown inline rule order (#100)', () => {
  it('renders a link that precedes bold text', () => {
    const out = html('See [docs](https://x.io) — **important**');
    expect(out).toContain('<a href="https://x.io"');
    expect(out).toContain('>docs</a>');
    expect(out).toContain('<strong>important</strong>');
    expect(out).not.toContain('[docs]');
  });

  it('keeps asterisks inside inline code literal', () => {
    const out = html('Use `a*b*c` here');
    expect(out).toMatch(/<code[^>]*>a\*b\*c<\/code>/);
    expect(out).not.toContain('<em>');
  });

  it('keeps a URL containing asterisks whole', () => {
    const out = html('Open https://x.io/a*b*c now');
    expect(out).toContain('href="https://x.io/a*b*c"');
    expect(out).not.toContain('<em>');
  });

  it('renders code that precedes bold text', () => {
    const out = html('Run `pnpm build` then **deploy**');
    expect(out).toMatch(/<code[^>]*>pnpm build<\/code>/);
    expect(out).toContain('<strong>deploy</strong>');
  });

  it('renders a link that precedes italic text', () => {
    const out = html('[guide](/help) is *short*');
    expect(out).toContain('<a href="/help"');
    expect(out).toContain('<em>short</em>');
  });

  it('still renders each rule on its own and in order', () => {
    const out = html('**b** *i* `c` [l](https://l.io) https://u.io');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<em>i</em>');
    expect(out).toMatch(/<code[^>]*>c<\/code>/);
    expect(out).toContain('href="https://l.io"');
    expect(out).toContain('href="https://u.io"');
    expect(out.indexOf('<strong>')).toBeLessThan(out.indexOf('<em>'));
    expect(out.indexOf('<em>')).toBeLessThan(out.indexOf('<code'));
  });

  it('still renders an unsafe link as plain text', () => {
    const out = html('[click](javascript:alert(1)) and **bold**');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
    expect(out).toContain('<strong>bold</strong>');
  });
});
