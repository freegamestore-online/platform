import { useState } from "react";
import type { LeaderboardEntry } from "../hooks/useLeaderboard";

interface LeaderboardProps {
  topScores: LeaderboardEntry[];
  recentScores: LeaderboardEntry[];
  loading: boolean;
}

/**
 * Drop-in leaderboard panel for the sidebar.
 * Copy this file + useLeaderboard.ts into your game's src/ directory.
 */
export function Leaderboard({ topScores, recentScores, loading }: LeaderboardProps) {
  const [tab, setTab] = useState<"top" | "recent">("top");
  const scores = tab === "top" ? topScores : recentScores;

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
        Loading scores...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex gap-1">
        {(["top", "recent"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1 text-xs font-semibold rounded-lg"
            style={{
              background: tab === t ? "var(--accent)" : "transparent",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {t === "top" ? "Top" : "Recent"}
          </button>
        ))}
      </div>
      {scores.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          No scores yet. Be the first!
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {scores.map((entry, i) => (
            <div
              key={`${entry.player_name}-${entry.score}-${i}`}
              className="flex items-center justify-between text-xs py-1"
              style={{ borderBottom: "1px solid var(--line)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-5 text-right font-semibold"
                  style={{ color: i < 3 ? "var(--accent)" : "var(--muted)" }}
                >
                  {i + 1}
                </span>
                <span className="truncate max-w-[8rem]">{entry.player_name}</span>
              </div>
              <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>
                {entry.score.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
