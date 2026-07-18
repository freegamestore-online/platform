// Pure mapping/filtering for Studio session data (the agent's /sessions index).
// Extracted from the hooks so the logic is unit-tested independently of
// React/fetch — the studio session list and dashboard inventory both
// depend on getting this right.

export interface ServerSession {
  id: string;
  name: string;
  gameId?: string;
  gameUrl?: string;
  deployed: boolean;
  activity?: SessionActivity;
  tokens?: { input: number; output: number };
  createdAt: string; // D1 datetime text, e.g. "2026-06-29 21:26:52"
  updatedAt?: string;
}

export type SessionActivityPhase = "idle" | "writing" | "provisioning" | "pushing" | "building" | "live" | "error";

export interface SessionActivity {
  phase: SessionActivityPhase;
  detail?: string;
  updatedAt?: string;
}

/** Account-wide usage totals from GET /sessions. */
export interface UsageTotals {
  input: number;
  output: number;
  games: number;
}

/** Compact a token count for display: 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(n: number): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: number;
  appId?: string;
  appUrl?: string;
  deployed: boolean;
  activity?: SessionActivity;
  tokens?: { input: number; output: number };
}

export interface DraftSession {
  id: string;
  name: string;
  createdAt: string;
  gameId?: string;
  activity?: SessionActivity;
}

export function activityLabel(activity: SessionActivity | undefined, deployed = false): string {
  switch (activity?.phase) {
    case "writing":
      return "Writing";
    case "provisioning":
      return "Provisioning";
    case "pushing":
      return "Pushing";
    case "building":
      return "Building";
    case "live":
      return "Live";
    case "error":
      return "Failed";
    case "idle":
      return deployed ? "Live" : "Needs prompt";
    default:
      return deployed ? "Live" : "Draft";
  }
}

export function activityTone(activity: SessionActivity | undefined, deployed = false): "accent" | "success" | "danger" | "muted" {
  switch (activity?.phase) {
    case "writing":
    case "provisioning":
    case "pushing":
    case "building":
      return "accent";
    case "live":
      return "success";
    case "error":
      return "danger";
    case "idle":
      return deployed ? "success" : "muted";
    default:
      return deployed ? "success" : "muted";
  }
}

/** Map an agent session-index row to a studio Project. `nowMs` is injected (not
 *  read from the clock) so the mapping is deterministic and testable; the hook
 *  passes `Date.now()`. A bad/empty date falls back to `nowMs`. */
export function mapServerSession(s: ServerSession, nowMs: number): Project {
  const ms = Date.parse(s.createdAt);
  const valid = !Number.isNaN(ms);
  return {
    id: s.id,
    name: s.name || "Untitled",
    appId: s.gameId,
    appUrl: s.gameUrl,
    deployed: s.deployed,
    activity: s.activity,
    tokens: s.tokens,
    createdAt: valid ? new Date(ms).toISOString() : new Date(nowMs).toISOString(),
    updatedAt: Date.parse(s.activity?.updatedAt || s.updatedAt || s.createdAt) || (valid ? ms : nowMs),
  };
}

/** The undeployed sessions, as dashboard draft rows. A deployed session is already
 *  a Live game in the registry-backed list, so it's excluded here. */
export function toDrafts(sessions: ServerSession[]): DraftSession[] {
  return sessions
    .filter((s) => !s.deployed && !s.gameId)
    .map((s) => ({ id: s.id, name: s.name || "Untitled", createdAt: s.createdAt, gameId: s.gameId, activity: s.activity }));
}

export function activityByGameId(sessions: ServerSession[]): Map<string, SessionActivity> {
  const map = new Map<string, SessionActivity>();
  for (const s of sessions) {
    if (!s.gameId || !s.activity) continue;
    const prev = map.get(s.gameId);
    const prevMs = prev ? Date.parse(prev.updatedAt || "") || 0 : 0;
    const nextMs = Date.parse(s.activity.updatedAt || s.updatedAt || s.createdAt) || 0;
    if (!prev || nextMs >= prevMs) map.set(s.gameId, s.activity);
  }
  return map;
}
