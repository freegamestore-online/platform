// Regression check for the weekly audit's browser-side code (#148's sibling
// failure: every game failed with "ReferenceError: __name is not defined").
//
// The audit runs under tsx, and tsx always compiles with esbuild's keepNames.
// That injects a `__name(...)` helper into any named function declared inside a
// page.evaluate() callback, but the helper only exists in Node, so the browser
// throws. This loads audit.ts through tsx's own loader and audits a local page,
// which is the same transform path the weekly job takes.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tsImport } from 'tsx/esm/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PAGE = `<!doctype html><html><head><title>fixture</title></head>
<body><main><button>Play</button><a href="#">Help</a></main></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

describe('audit browser code under tsx', () => {
  it('audits a page without throwing __name / keepNames helper errors', async () => {
    const { auditUrl } = (await tsImport(
      './audit.ts',
      import.meta.url,
    )) as typeof import('./audit.ts');
    const result = await auditUrl(url);
    expect(result).toBeDefined();
  }, 120_000);
});
