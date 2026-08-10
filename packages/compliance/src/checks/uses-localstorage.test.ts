import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkUsesLocalStorage } from './uses-localstorage.js';

describe('checkUsesLocalStorage', () => {
  it('passes when a game reads localStorage', async () => {
    const files = new Map([
      ['web/src/App.tsx', 'const best = Number(localStorage.getItem("best") ?? 0);'],
    ]);
    const r = await checkUsesLocalStorage(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('web/src/App.tsx');
  });

  it('warns when nothing under web/src/ persists anything', async () => {
    const files = new Map([['web/src/App.tsx', 'export default () => <div>hi</div>;']]);
    const r = await checkUsesLocalStorage(mapFileSource(files));
    expect(r.status).toBe('warn');
  });

  it('ignores localStorage outside web/src/', async () => {
    const files = new Map([['scripts/seed.ts', 'localStorage.setItem("x", "1");']]);
    const r = await checkUsesLocalStorage(mapFileSource(files));
    expect(r.status).toBe('warn');
  });

  // Regression: the check used to accept `useHighScore`, a hook the games SDK
  // has never exported (only `useAuth`, `useGameSounds`, `useLeaderboard`,
  // `useSound`). A game importing it would false-pass, and the warn text told
  // developers to call an API that does not exist.
  it('does NOT pass on useHighScore — no such hook exists in the SDK', async () => {
    const files = new Map([
      [
        'web/src/App.tsx',
        'import { useHighScore } from "@freegamestore/games";\nconst [s] = useHighScore();',
      ],
    ]);
    const r = await checkUsesLocalStorage(mapFileSource(files));
    expect(r.status).toBe('warn');
  });

  it('never mentions useHighScore in its output', async () => {
    const files = new Map([['web/src/App.tsx', 'export default () => <div/>;']]);
    const r = await checkUsesLocalStorage(mapFileSource(files));
    const text = [r.detail, ...(r.suggestions ?? [])].join(' ');
    expect(text).not.toContain('useHighScore');
  });
});
