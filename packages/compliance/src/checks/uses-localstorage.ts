import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Games should save progress and/or high scores locally so players feel
 * rewarded for returning. This check looks for `localStorage` usage
 * anywhere under `web/src/`.
 *
 * Direct `localStorage` use is the only signal: the games SDK ships no
 * local-persistence hook (its own localStorage keys are just the theme
 * and text-size prefs), and `useLeaderboard` posts to the remote
 * leaderboard Worker rather than storing anything locally.
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

    if (/\blocalStorage\b/.test(content)) {
      return {
        name: 'Local storage for progress/scores',
        status: 'pass',
        detail: `localStorage usage found in ${path}`,
      };
    }
  }

  return {
    name: 'Local storage for progress/scores',
    status: 'warn',
    detail: 'no localStorage usage found in web/src/',
    suggestions: [
      'Consider saving high scores or progress with localStorage so returning players feel rewarded.',
      // Hidden: the global leaderboard is not surfaced to users right now (issue
      // #31), so stop recommending useLeaderboard(). Restore alongside the
      // games-sdk export when the leaderboard is re-enabled.
      // 'To also publish scores to the global leaderboard, use useLeaderboard() from @freegamestore/games — it complements a local save rather than replacing it.',
    ],
  };
}
