/** @vitest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// platform#393 (ADR-001): SDK UI is Tailwind utilities on the platform tokens.
// Inline `style` is allowed only for values computed at runtime, each marked
// `// Dynamic: …`. No CSS strings, no <style>, no runtime stylesheet injection.
// The check reads syntax, so a comment cannot hide a violation.

/** `{ ... } as React.CSSProperties`, `( ... )` and `{ ... } satisfies T` all wrap the same object. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function violations(source: string, filename = 'component.tsx'): string[] {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const errors: string[] = [];

  function visit(node: ts.Node) {
    // A string constant named *_CSS is a stylesheet in disguise. GAME_TOKENS_CSS is the one documented token helper.
    if (
      ts.isVariableDeclaration(node) &&
      /_CSS$/.test(node.name.getText(tree)) &&
      node.name.getText(tree) !== 'GAME_TOKENS_CSS'
    ) {
      errors.push('CSS string');
    }
    if (
      ts.isCallExpression(node) &&
      /(?:createElement|createElementNS)$/.test(node.expression.getText(tree)) &&
      node.arguments.some((arg) => ts.isStringLiteral(arg) && arg.text === 'style')
    ) {
      errors.push('style injection');
    }
    if (ts.isCallExpression(node) && /(?:^|\.)insertRule$/.test(node.expression.getText(tree))) {
      errors.push('style injection');
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      /(?:textContent|innerHTML|cssText|adoptedStyleSheets)$/.test(node.left.getText(tree))
    ) {
      errors.push('CSS/HTML injection');
    }
    if (ts.isNewExpression(node) && node.expression.getText(tree) === 'CSSStyleSheet') {
      errors.push('style injection');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(tree) === 'style') errors.push('style element');
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(tree) !== 'style') continue;
        // The marker must sit in this attribute's leading trivia: the line above `style=`.
        if (!/(?:\/\/|\/\*)\s*Dynamic: .+/.test(attr.getFullText(tree))) {
          errors.push('uncommented style');
        }
        const init = attr.initializer;
        const expression = init && ts.isJsxExpression(init) ? init.expression : undefined;
        const object = expression ? unwrap(expression) : undefined;
        if (!object || !ts.isObjectLiteralExpression(object)) {
          errors.push('indirect style');
          continue;
        }
        for (const prop of object.properties) {
          if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
            errors.push('non-dynamic style');
            continue;
          }
          const value = unwrap(ts.isPropertyAssignment(prop) ? prop.initializer : prop.name);
          if (
            ts.isStringLiteral(value) ||
            ts.isNoSubstitutionTemplateLiteral(value) ||
            ts.isNumericLiteral(value) ||
            ts.isConditionalExpression(value)
          ) {
            errors.push('static style');
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}

const here = fileURLToPath(new URL('.', import.meta.url));

/** Every non-test .ts/.tsx file under src, including feel/. */
function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${dir}${entry.name}/`, `${rel}/`);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe('SDK styling discipline (#393)', () => {
  const files = sourceFiles(here);

  it('scans the component files', () => {
    expect(files).toEqual(
      expect.arrayContaining(['GameShell.tsx', 'StartScreen.tsx', 'feel/ScorePopup.tsx']),
    );
  });

  for (const file of files) {
    it(`${file} uses compiled utilities with only documented dynamic styles`, () => {
      expect(violations(readFileSync(`${here}${file}`, 'utf8'), file)).toEqual([]);
    });
  }

  describe('the detector', () => {
    it('rejects static, uncommented and indirect styles', () => {
      expect(violations('<div style={{ color: "red" }} />')).toContain('uncommented style');
      expect(violations('<div // Dynamic: fake exemption\n style={{ color: "red" }} />')).toContain(
        'static style',
      );
      expect(violations('<div // Dynamic: fake\n style={{ width: `10px` }} />')).toContain(
        'static style',
      );
      expect(violations('<div style={savedStyle} />')).toContain('indirect style');
      expect(violations('<div // Dynamic: spread\n style={{ ...base }} />')).toContain(
        'non-dynamic style',
      );
    });

    it('rejects CSS strings and every form of runtime stylesheet', () => {
      expect(violations('export const NAVBAR_CSS = `body {}`')).toContain('CSS string');
      expect(violations('document.createElement("style")')).toContain('style injection');
      expect(violations('sheet.insertRule(".a{}")')).toContain('style injection');
      expect(violations('new CSSStyleSheet()')).toContain('style injection');
      expect(violations('style.textContent = "body {}"')).toContain('CSS/HTML injection');
      expect(violations('document.adoptedStyleSheets = []')).toContain('CSS/HTML injection');
      expect(violations('<style>{"body {}"}</style>')).toContain('style element');
    });

    it('allows the documented token helper and commented dynamic values', () => {
      expect(violations('export const GAME_TOKENS_CSS = `:root {}`')).toEqual([]);
      expect(violations('<div // Dynamic: size from props\n style={{ width: size }} />')).toEqual(
        [],
      );
      expect(
        violations('<li // Dynamic: stagger\n style={{ "--i": i } as React.CSSProperties} />'),
      ).toEqual([]);
    });

    it('does not accept a comment that is not on the style attribute', () => {
      expect(
        violations('// Dynamic: far away\nconst a = 1;\n<div style={{ left: x }} />'),
      ).toContain('uncommented style');
    });
  });
});
