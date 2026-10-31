import { useState } from 'react';
import type { LeaderboardEntry } from './useLeaderboard.js';

export interface LeaderboardProps {
  topScores: LeaderboardEntry[];
  recentScores: LeaderboardEntry[];
  loading: boolean;
}

export function Leaderboard({
  topScores,
  recentScores,
  loading,
}: LeaderboardProps): React.JSX.Element {
  const [tab, setTab] = useState<'top' | 'recent'>('top');
  const scores = tab === 'top' ? topScores : recentScores;

  if (loading) {
    return <div className="px-4 py-3 text-xs text-muted">Loading scores...</div>;
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex gap-1">
        {(['top', 'recent'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${
              tab === t ? 'bg-accent text-white' : 'bg-transparent text-muted'
            }`}
          >
            {t === 'top' ? 'Top' : 'Recent'}
          </button>
        ))}
      </div>
      {scores.length === 0 ? (
        <div className="text-xs text-muted">No scores yet. Be the first!</div>
      ) : (
        <div className="flex flex-col gap-1">
          {scores.map((entry, i) => (
            <div
              key={`${entry.player_name}-${entry.score}-${i}`}
              className="flex items-center justify-between border-b border-line py-1 text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 text-right font-semibold ${i < 3 ? 'text-accent' : 'text-muted'}`}
                >
                  {i + 1}
                </span>
                <span className="max-w-[8rem] truncate">{entry.player_name}</span>
              </div>
              <span className="font-display font-bold">{entry.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
