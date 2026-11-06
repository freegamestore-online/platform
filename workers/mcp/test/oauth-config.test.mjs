import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { MCP_ACCESS_TOKEN_TTL_SECONDS } = await import(pathToFileURL(resolve(root, 'src/oauth-config.ts')).href);

test('MCP access tokens default to 30 days', () => {
  assert.equal(MCP_ACCESS_TOKEN_TTL_SECONDS, 30 * 86_400);
});

test('the OAuth provider is configured S256-only, so discovery metadata stops advertising plain (#445)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(resolve(root, 'src/index.ts'), 'utf8');
  assert.match(src, /new OAuthProvider\(\{[\s\S]*allowPlainPKCE:\s*false[\s\S]*\}\)/);
});
