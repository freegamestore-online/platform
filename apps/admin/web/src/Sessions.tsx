import { useCallback, useEffect, useState } from 'react';
import { fetchSessionsPage, type SessionRow, timeAgo } from './api.ts';
import { ActivityBadge } from './Ops.tsx';
import { ErrorBox, Loading } from './Overview.tsx';

const PAGE_SIZE = 20;

export function Sessions({ navigate }: { navigate: (h: string) => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Cursors for pages already visited. The API is forward-only (it hands back a
  // next_cursor and nothing else), so "Previous" is served from this trail
  // rather than by asking the server to walk backwards.
  const [trail, setTrail] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const page = await fetchSessionsPage(cursor, PAGE_SIZE);
      setRows(page.sessions ?? []);
      setTotal(page.total ?? 0);
      setNextCursor(page.next_cursor ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const goNext = () => {
    if (!nextCursor) return;
    setTrail((t) => [...t.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
    void load(nextCursor);
  };

  const goPrev = () => {
    if (pageIndex === 0) return;
    const prev = trail[pageIndex - 1] ?? null;
    setPageIndex((i) => i - 1);
    void load(prev);
  };

  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Loading />;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const last = pageIndex * PAGE_SIZE + rows.length;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1 text-ink">
        VibeCode sessions <span className="text-sm font-normal text-muted">({total})</span>
      </h1>
      <p className="text-sm mb-4 text-muted">
        Every user's studio chats, newest first. Click a row for the live transcript — and to chat
        into the session on their behalf.
      </p>
      <div className="rounded-xl border overflow-x-auto border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Session</th>
              <th className="px-4 py-2.5">Game</th>
              <th className="px-4 py-2.5">Activity</th>
              <th className="px-4 py-2.5">Tokens</th>
              <th className="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/sessions/${s.id}`)}
                className="border-t cursor-pointer hover:opacity-80 border-line"
              >
                <td className="px-4 py-2.5 font-medium text-ink">{s.user}</td>
                <td className="px-4 py-2.5">
                  <span className="text-ink">{s.name}</span>
                  <br />
                  <span className="text-[10px] text-muted">{s.id}</span>
                </td>
                <td className="px-4 py-2.5">
                  {s.gameId ? (
                    <a
                      href={s.gameUrl || `https://${s.gameId}.freegamestore.online`}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="text-accent"
                    >
                      {s.gameId}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                {/* The failure reason is shown INLINE, not just as the badge's
                    title tooltip — a tooltip is invisible on touch and unusable
                    for scanning a wave of failures, which is the whole triage
                    case this column exists for (#21). */}
                <td className="px-4 py-2.5 max-w-xs">
                  <ActivityBadge session={s} />
                  {s.activity?.phase === 'error' && s.activity.detail && (
                    <div
                      className="text-[10px] mt-1 leading-snug line-clamp-2 break-words text-danger"
                      title={s.activity.detail}
                    >
                      {s.activity.detail}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted">
                  {s.tokens.input + s.tokens.output > 0
                    ? `${Math.round((s.tokens.input + s.tokens.output) / 1000)}k`
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">
                  {timeAgo(s.updatedAt || s.createdAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-muted" colSpan={6}>
                  No sessions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 mt-3">
        <span className="text-xs text-muted">
          {total === 0
            ? 'No sessions'
            : `Showing ${first}–${last} of ${total} · page ${pageIndex + 1} of ${pages}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={pageIndex === 0 || loading}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 border-line text-muted"
          >
            Previous
          </button>
          <button
            onClick={goNext}
            disabled={!nextCursor || loading}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 border-line text-muted"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
