import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsFileSource } from '../lib/fs-file-source.js';
import { checkNoExternalFetch } from './no-external-fetch.js';

// #373: external requests are allowed; the check warns and lists each host.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fgs-compliance-fetch-'));
  await mkdir(join(dir, 'web', 'src'), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function src(name: string, body: string): Promise<void> {
  await writeFile(join(dir, 'web', 'src', name), body);
}

describe('checkNoExternalFetch (#373)', () => {
  it('passes when there are no external requests', async () => {
    await src('a.ts', "fetch('/api/scores');");
    expect((await checkNoExternalFetch(fsFileSource(dir))).status).toBe('pass');
  });

  it('passes platform, localhost and 127.0.0.1 hosts', async () => {
    await src(
      'a.ts',
      [
        "fetch('https://api.freegamestore.online/v1/x');",
        "fetch('http://localhost:8787/x');",
        "fetch('http://127.0.0.1:3000/x');",
      ].join('\n'),
    );
    expect((await checkNoExternalFetch(fsFileSource(dir))).status).toBe('pass');
  });

  it('warns (does not fail) for one external fetch and names the host', async () => {
    await src('a.ts', "await fetch('https://api.example.com/v1/scores');");
    const r = await checkNoExternalFetch(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/api\.example\.com/);
  });

  it('lists each distinct host once', async () => {
    await src(
      'a.ts',
      [
        "fetch('https://api.example.com/a');",
        "fetch('https://api.example.com/b');",
        "fetch('https://data.other.org/c');",
      ].join('\n'),
    );
    const r = await checkNoExternalFetch(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(
      /3 external request\(s\) to 2 host\(s\): api\.example\.com, data\.other\.org/,
    );
  });

  it('reports XMLHttpRequest and WebSocket hosts too', async () => {
    await src(
      'a.ts',
      [
        'const x = new XMLHttpRequest();',
        "x.open('GET', 'https://xhr.example.com/a');",
        "new WebSocket('wss://ws.example.com/room');",
      ].join('\n'),
    );
    const r = await checkNoExternalFetch(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/ws\.example\.com/);
    expect(r.detail).toMatch(/xhr\.example\.com/);
  });

  it('ignores a commented-out external fetch', async () => {
    await src('a.ts', "// fetch('https://api.example.com/x');\nexport {};");
    expect((await checkNoExternalFetch(fsFileSource(dir))).status).toBe('pass');
  });
});
