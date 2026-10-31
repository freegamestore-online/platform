/** Lightweight markdown renderer for chat messages.
 *  Supports: **bold**, *italic*, `code`, ```blocks```, [links](url),
 *  - lists, # headings, --- dividers. No npm dependency. */

/** Allow only http(s)/mailto and same-origin relative links; reject
 *  javascript:, data:, vbscript:, etc. from untrusted assistant output. */
export function isSafeHref(url: string): boolean {
  const u = url.trim();
  // Reject any control character or internal whitespace FIRST. Browsers strip
  // tab/CR/LF while parsing a URL, so `java\tscript:` parses as `javascript:` —
  // a hand-rolled "scheme-like prefix" regex is defeated by the embedded tab and
  // would wrongly pass it. Killing these chars up front closes that bypass.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — see above.
  if (/[\u0000-\u0020\u007F-\u009F]/.test(u) || /\s/.test(u)) return false;
  // Reject protocol-relative URLs (`//host`, `\\host`): they carry no scheme so
  // they'd fall through to the scheme-less "safe" branch, but the browser
  // resolves `//evil.example` to `https://evil.example` — an off-site link from
  // prompt-injectable assistant output.
  if (/^[/\\]{2}/.test(u)) return false;
  // Positive allowlist: explicit safe schemes …
  if (/^(https?:|mailto:)/i.test(u)) return true;
  // … any OTHER scheme-like prefix (foo:) is unsafe …
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return false;
  // … otherwise it's scheme-less (relative / anchor / plain), which is safe.
  return true;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const line = blocks[i]!;

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < blocks.length && !blocks[i]!.startsWith('```')) {
        codeLines.push(blocks[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre
          key={elements.length}
          className="bg-panel border border-line rounded-lg py-[0.6rem] px-[0.8rem] text-[0.78rem] font-[monospace] overflow-x-auto my-[0.3rem] mx-0"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    if (line.startsWith('### ')) {
      elements.push(
        <div key={elements.length} className="font-bold text-[0.95rem] mt-2 mb-[0.2rem] mx-0">
          {inline(line.slice(4))}
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <div
          key={elements.length}
          className="font-bold text-[1.05rem] mt-[0.6rem] mb-[0.2rem] mx-0"
        >
          {inline(line.slice(3))}
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <div
          key={elements.length}
          className="font-extrabold text-[1.15rem] mt-[0.6rem] mb-[0.2rem] mx-0"
        >
          {inline(line.slice(2))}
        </div>,
      );
      i++;
      continue;
    }

    // Divider
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <hr key={elements.length} className="border-0 border-t border-line my-2 mx-0" />,
      );
      i++;
      continue;
    }

    // List item
    if (/^[-*] /.test(line)) {
      elements.push(
        <div key={elements.length} className="flex gap-[0.4rem] my-[0.15rem] mx-0">
          <span className="text-muted shrink-0">•</span>
          <span>{inline(line.slice(2))}</span>
        </div>,
      );
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={elements.length} className="h-[0.3rem]" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={elements.length} className="my-[0.1rem] mx-0">
        {inline(line)}
      </div>,
    );
    i++;
  }

  return <>{elements}</>;
}

type InlineRule = 'code' | 'link' | 'bold' | 'italic' | 'url';

// Each inline rule, in TIE-BREAK priority: when two rules match at the same
// position the earlier one wins (code spans first so their contents stay
// literal; bold before italic so `**` is not read as two `*`).
const INLINE_RULES: [InlineRule, RegExp][] = [
  ['code', /`([^`]+?)`/],
  ['link', /\[(.+?)\]\((.+?)\)/],
  ['bold', /\*\*(.+?)\*\*/s],
  ['italic', /\*(.+?)\*/s],
  ['url', /https?:\/\/[^\s<>]+/],
];

const LINK_CLASS = 'text-accent underline';

/** Parse inline markdown: **bold**, *italic*, `code`, [link](url), bare URLs.
 *
 *  At each step the rule whose match starts EARLIEST in the remaining text is
 *  applied (#100). Trying rules in a fixed order, each matching anywhere in the
 *  rest of the line, emitted everything before a later **bold** / *italic* as
 *  plain text — so a link or code span earlier in the line was never parsed,
 *  and `*` inside code or a URL turned into italics. */
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let best: { rule: InlineRule; match: RegExpMatchArray } | null = null;
    for (const [rule, re] of INLINE_RULES) {
      const match = remaining.match(re);
      if (match?.index !== undefined && (!best || match.index < best.match.index!)) {
        best = { rule, match };
      }
    }
    if (!best) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const { rule, match } = best;
    const at = match.index!;
    if (at > 0) parts.push(<span key={key++}>{remaining.slice(0, at)}</span>);
    remaining = remaining.slice(at + match[0].length);

    switch (rule) {
      case 'bold':
        parts.push(<strong key={key++}>{match[1]}</strong>);
        break;
      case 'italic':
        parts.push(<em key={key++}>{match[1]}</em>);
        break;
      case 'code':
        parts.push(
          <code
            key={key++}
            className="bg-panel border border-line rounded py-[0.1rem] px-[0.3rem] text-[0.82em] font-[monospace]"
          >
            {match[1]}
          </code>,
        );
        break;
      case 'link': {
        // Only allow safe schemes. Assistant output is untrusted (prompt
        // injection), and React does NOT block `javascript:`/`data:` hrefs — a
        // crafted link could exfiltrate the user's BYO API keys on click. Render
        // an unsafe URL as plain text instead.
        const rawHref = match[2] ?? '';
        const href = isSafeHref(rawHref) ? rawHref : null;
        parts.push(
          href ? (
            <a key={key++} href={href} target="_blank" rel="noopener" className={LINK_CLASS}>
              {match[1]}
            </a>
          ) : (
            <span key={key++}>{match[1]}</span>
          ),
        );
        break;
      }
      case 'url':
        parts.push(
          <a key={key++} href={match[0]} target="_blank" rel="noopener" className={LINK_CLASS}>
            {match[0]}
          </a>,
        );
        break;
    }
  }

  return parts;
}
