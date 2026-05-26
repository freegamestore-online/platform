import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Games should save progress and/or high scores locally so players feel
 * rewarded for returning. This check looks for `localStorage` usage or
 * the `useHighScore` hook import (from the games SDK) anywhere under
 * `web/src/`.
 *
 * WARN level — not every game needs persistence. Short-session games
 * (Flappy Bird, reaction timers) are perfectly valid without saves. The
 * guideline is "Saves progress/high scores locally," not a hard gate.
 */
export async function checkUsesLocalStorage(source: FileSource): Promise<CheckResult> {
  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;

    const content = await source.read(path);
    if (!content) continue;

    // Direct localStorage usage
    if (/\blocalStorage\b/.test(content)) {
      return {
        name: 'Local storage for progress/scores',
        status: 'pass',
        detail: `localStorage usage found in ${path}`,
      };
    }

    // SDK high-score hook
    if (/\buseHighScore\b/.test(content)) {
      return {
        name: 'Local storage for progress/scores',
        status: 'pass',
        detail: `useHighScore hook found in ${path}`,
      };
    }
  }

  return {
    name: 'Local storage for progress/scores',
    status: 'warn',
    detail: 'no localStorage usage or useHighScore hook found in web/src/',
    suggestions: [
      'Consider saving high scores or progress with localStorage so returning players feel rewarded.',
      'The games SDK provides a useHighScore() hook that handles serialisation and leaderboard formatting.',
    ],
  };
}
