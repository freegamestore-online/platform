/**
 * GitHub commit history helper, used by `fas list` (and any future
 * command that needs "what changed recently" per app).
 *
 * Reads GH_TOKEN / GITHUB_TOKEN from env to lift the 60/hr anonymous
 * rate limit. Failures degrade silently — the caller decides whether
 * to show "rate-limited" or just nothing.
 */

export interface CommitInfo {
  sha: string;
  message: string;
  authoredAt: string; // ISO-8601
  htmlUrl: string;
}

export interface AppHistory {
  /** ISO-8601 of the most recent commit, or null if unavailable. */
  lastUpdated: string | null;
  /** Up to 3 most recent commits, newest first. Empty if unavailable. */
  commits: CommitInfo[];
  /** "rate-limited" | "not-found" | undefined */
  error?: 'rate-limited' | 'not-found' | 'network';
}

const EMPTY: AppHistory = { lastUpdated: null, commits: [] };

export async function fetchAppHistory(slug: string): Promise<AppHistory> {
  if (!slug) return EMPTY;
  const headers: Record<string, string> = {
    'User-Agent': 'fas-cli',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${slug}/commits?per_page=3`, { headers });
  } catch {
    return { ...EMPTY, error: 'network' };
  }
  if (res.status === 404) return { ...EMPTY, error: 'not-found' };
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/rate limit/i.test(body)) return { ...EMPTY, error: 'rate-limited' };
    return { ...EMPTY, error: 'rate-limited' }; // 403 + no body usually = rate-limit on github
  }
  if (!res.ok) return EMPTY;

  interface GhCommit {
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { date: string };
      committer?: { date: string };
    };
  }
  const raw = (await res.json().catch(() => [])) as GhCommit[];
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY;
  const commits: CommitInfo[] = raw.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authoredAt: c.commit.author?.date ?? c.commit.committer?.date ?? '',
    htmlUrl: c.html_url,
  }));
  return { lastUpdated: commits[0]?.authoredAt ?? null, commits };
}

/**
 * Human-friendly relative time. "5 minutes ago", "yesterday", "3 days ago",
 * "2 months ago". Tuned for terminal output, not pluralization-perfect.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.max(1, Math.round((now.getTime() - t) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 30) return `${diffDay} days ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear} year${diffYear === 1 ? '' : 's'} ago`;
}
