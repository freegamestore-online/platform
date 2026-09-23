// FGS admin API client. All endpoints are same-origin on the admin worker
// (auth: Google-signed fgs_token cookie; every call 401s when signed out —
// App.tsx catches that and shows the sign-in screen).

export const LOGIN_URL =
  'https://auth.freegamestore.online/login/google?redirect=' +
  encodeURIComponent('https://admin.freegamestore.online/');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── types matching the FGS admin worker responses ─────────────────────────────

export interface PlatformStats {
  games: number;
  creators: number;
  errors24h: number;
  errorsTotal: number;
  errorSeries: { d: string; c: number }[];
}

export interface GameInfo {
  id: string;
  name: string;
  org: string;
  cfProject: string;
  domain: string;
  /** Build lifecycle (#22): "live" once a deploy.yml run has concluded success,
   *  "pending" while a provisioned game has never built, "failed" when its only
   *  builds failed. Optional because a console build can outlive a worker that
   *  predates the field — treat a missing value as "live", same rule the worker
   *  applies to a registry entry with no status. */
  status?: 'pending' | 'live' | 'failed';
}

export interface QualityData {
  timestamp: string;
  games: { id: string; score: number; loadTimeMs: number; consoleErrors: string[] }[];
}

export interface ErrorRow {
  ts: string;
  source: string;
  user_github: string | null;
  message: string;
  stack: string | null;
  context: string | null;
}

export interface Creator {
  login: string;
  games: string[];
}

export interface RegisteredUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string | null;
  lastSeen: string | null;
  keys: string[];
  grant: { provider: string; model: string; expiresAt: string | null } | null;
}

export interface CompGrant {
  userId: string;
  provider: string;
  model: string;
  note: string | null;
  grantedBy: string | null;
  expiresAt: string | null;
}

/** One page of the admin session index (#25). */
export interface SessionsPage {
  sessions: SessionRow[];
  next_cursor: string | null;
  total: number;
}

/** Fetch one page of sessions. */
export function fetchSessionsPage(cursor: string | null, limit = 20): Promise<SessionsPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return api<SessionsPage>(`/api/sessions?${qs}`);
}

/** Walk every page.
 *
 *  For the views that AGGREGATE over all sessions — the Ops agent queue, and the
 *  per-game / per-user lists that filter client-side. Before #25 they relied on
 *  one unparameterised call returning everything; with a default page size of 20
 *  that would have silently truncated them to the newest 20 rows. Paging through
 *  at the max size keeps them correct at any fleet size, and is bounded by
 *  `total`, so it cannot spin if the server misreports `next_cursor`. */
export async function fetchAllSessions(): Promise<SessionRow[]> {
  const out: SessionRow[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page: SessionsPage = await fetchSessionsPage(cursor, 100);
    out.push(...(page.sessions ?? []));
    if (!page.next_cursor || page.sessions.length === 0) break;
    cursor = page.next_cursor;
  }
  return out;
}

export interface SessionRow {
  id: string;
  user: string;
  userId: string;
  name: string;
  gameId?: string;
  gameUrl?: string;
  deployed: boolean;
  activity?: SessionActivity;
  tokens: { input: number; output: number };
  createdAt: string;
  updatedAt: string;
}

export type ActivityPhase =
  | 'idle'
  | 'writing'
  | 'provisioning'
  | 'pushing'
  | 'building'
  | 'live'
  | 'error';

export interface SessionActivity {
  phase: ActivityPhase;
  detail?: string;
  updatedAt?: string;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool_result' | string;
  content?: string;
  ts?: number;
  toolCalls?: { name: string; input?: { path?: string; id?: string; name?: string } }[];
  toolResults?: { id: string; content: string }[];
}

export interface SessionHistory {
  messages: TranscriptMessage[];
  appId: string | null;
  appName: string | null;
  deployStatus: { phase: string; appUrl?: string; error?: string } | null;
  tokenUsage: { input: number; output: number };
  fileCount: number;
}

export interface SessionErrorEntry {
  timestamp: string;
  source: string;
  message: string;
}

export interface ProvisionStep {
  name: string;
  status: 'ok' | 'skip' | 'fail';
  detail: string;
}

export function timeAgo(ts: string | number | undefined): string {
  if (!ts) return '—';
  const d =
    typeof ts === 'number'
      ? new Date(ts)
      : new Date(String(ts).replace(' ', 'T') + (String(ts).endsWith('Z') ? '' : 'Z'));
  const s = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(s)) return String(ts);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
