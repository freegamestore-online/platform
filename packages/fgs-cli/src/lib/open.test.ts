import { afterEach, describe, expect, it, vi } from 'vitest';

// #455: opening the browser must not go through a shell that re-parses the URL.
afterEach(() => vi.resetModules());

async function openerOn(os: string) {
  vi.resetModules();
  vi.doMock('node:os', async (orig) => ({
    ...(await orig<typeof import('node:os')>()),
    platform: () => os,
  }));
  return (await import('./open.js')).openerFor;
}

describe('openerFor', () => {
  const url = 'https://freegamestore.online/a?x=1&y=2&z=%PATH%';

  it('on Windows passes the whole URL as one argument to a real executable, not through cmd', async () => {
    const opener = (await openerOn('win32'))(url);
    expect(opener.cmd).not.toMatch(/cmd/i);
    expect(opener.args).toEqual(['url.dll,FileProtocolHandler', url]);
  });

  it('on macOS and Linux passes the URL as the single argument', async () => {
    expect((await openerOn('darwin'))(url)).toEqual({ cmd: 'open', args: [url] });
    expect((await openerOn('linux'))(url)).toEqual({ cmd: 'xdg-open', args: [url] });
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'calc.exe', '-a /bin/sh', ''])(
    'refuses %j',
    async (bad) => {
      const opener = await openerOn('linux');
      expect(() => opener(bad)).toThrow(/non-http/);
    },
  );
});
