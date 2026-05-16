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

function openerFor(url: string): { cmd: string; args: string[] } {
  switch (platform()) {
    case 'darwin':
      return { cmd: 'open', args: [url] };
    case 'win32':
      // `start` is a cmd builtin, not an executable, so we can't spawn it
      // directly. The empty `""` is the window-title arg `start` requires
      // when its target is a quoted string.
      return { cmd: 'cmd.exe', args: ['/c', 'start', '""', url] };
    default:
      return { cmd: 'xdg-open', args: [url] };
  }
}
