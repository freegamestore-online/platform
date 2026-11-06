import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Open a URL in the user's default browser. Doesn't wait for the browser to
 * exit — it just hands off to the OS opener and resolves once that's spawned.
 */
export function openUrl(url: string): Promise<void> {
  const { cmd, args } = openerFor(url);
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', rejectFn);
    child.on('spawn', () => {
      child.unref();
      resolveFn();
    });
  });
}

/** http(s) only, and never a command line: the URL is always ONE argv entry. */
export function openerFor(url: string): { cmd: string; args: string[] } {
  if (!/^https?:\/\//i.test(url)) throw new Error(`refusing to open a non-http(s) URL: ${url}`);
  switch (platform()) {
    case 'darwin':
      return { cmd: 'open', args: [url] };
    case 'win32':
      // Not `cmd /c start`: cmd re-parses the line, so an unquoted `&` in the URL
      // ended the command there and `%VAR%` expanded (#455). The URL handler is a
      // real executable, so the URL stays one argument and cmd never sees it.
      return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
    default:
      return { cmd: 'xdg-open', args: [url] };
  }
}
