// Tiny ANSI styling without pulling chalk. Auto-disables when stdout
// isn't a TTY (CI logs, redirected output) so plain text is captured.

const isTTY = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] !== '1';

const wrap =
  (open: string, close: string) =>
  (s: string): string =>
    isTTY ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const bold = wrap('1', '22');
export const dim = wrap('2', '22');
export const cyan = wrap('36', '39');
export const green = wrap('32', '39');
export const yellow = wrap('33', '39');
export const red = wrap('31', '39');

export function header(s: string): string {
  const line = '─'.repeat(Math.min(s.length + 4, 60));
  return `\n${cyan(line)}\n${cyan('  ')}${bold(s)}\n${cyan(line)}\n`;
}

export function step(n: number, total: number, label: string): string {
  return cyan(`[${n}/${total}]`) + ' ' + bold(label);
}
