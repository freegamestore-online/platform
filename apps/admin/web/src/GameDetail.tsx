import { useEffect, useState } from 'react';
import { ApiError, api, fetchAllSessions, type SessionRow, timeAgo } from './api.ts';
import { ErrorBox, Loading } from './Overview.tsx';

/** Everything the detail page needs, from one round trip (`/api/games/:id/detail`). */
interface GameDetail {
  id: string;
  name: string;
  listed: boolean;
  status: 'pending' | 'live' | 'failed';
  creatorGithub: string | null;
  hostedOn: string;
  route: { configured: boolean; r2Prefix?: string };
  url: string;
  repo: string;
  http: { ok: boolean; status: number | null; error?: string };
  runs: {
    conclusion: string;
    sha: string | null;
    message: string;
    updatedAt: string | null;
    url: string | null;
  }[];
  forkedFrom?: ForkedFrom | null;
}

/** A remix's source: an attribution snapshot (#35), or a legacy bare source id. */
type ForkedFrom = { id: string; name: string; creatorGithub: string; forkedAt: string } | string;

function sourceId(from: ForkedFrom): string {
  return typeof from === 'string' ? from : from.id;
}

function forkSourceLabel(from: ForkedFrom): string {
  return typeof from === 'string' ? from : `${from.name} (${from.id}) by @${from.creatorGithub}`;
}

interface Traffic {
  host: string;
  since: string;
  until: string;
  totals: { requests: number; pageViews: number; visitors: number };
  days: { date: string | null; requests: number; pageViews: number; visitors: number }[];
}

interface DeleteResult {
  ok?: boolean;
  error?: string;
  steps?: { name: string; status: 'ok' | 'skip' | 'fail'; detail: string }[];
}

const OK = '#059669';
const WARN = '#d97706';
const BAD = '#dc2626';

export function GameDetail({ id, navigate }: { id: string; navigate: (h: string) => void }) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [healing, setHealing] = useState(false);
  // null = not loaded yet; "unconfigured" = the CF token/zone are not set, which
  // is the expected state today and must read as such rather than as an error.
  const [traffic, setTraffic] = useState<Traffic | 'unconfigured' | { error: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);

  useEffect(() => {
    api<GameDetail>(`/api/games/${id}/detail`)
      .then(setDetail)
      .catch((e) => setError(e.message));
    // Sessions are filtered client-side: the list endpoint already carries
    // gameId, so a per-game server query would be a second proxy hop for data
    // the page is fetching anyway.
    fetchAllSessions()
      .then((all) => setSessions(all.filter((s) => s.gameId === id)))
      .catch(() => setSessions([]));
    // Never let analytics failure take the page down — it is the least important
    // thing here and the page must still show reachability and deploy history.
    api<Traffic>(`/api/games/${id}/traffic`)
      .then(setTraffic)
      .catch((e) =>
        setTraffic(
          e instanceof ApiError && e.status === 503
            ? 'unconfigured'
            : { error: (e as Error).message },
        ),
      );
  }, [id]);

  if (error) return <ErrorBox message={error} />;
  if (!detail) return <Loading />;

  const healRoute = async () => {
    setHealing(true);
    try {
      const res = await api<{
        ok?: boolean;
        error?: string;
        step?: { name: string; status: 'ok' | 'skip' | 'fail'; detail: string };
      }>(`/api/games/${id}/heal-route`, { method: 'POST' });
      setResult({ ok: res.ok, error: res.error, steps: res.step ? [res.step] : [] });
      if (res.ok) setDetail((d) => (d ? { ...d, route: { configured: true } } : d));
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setHealing(false);
    }
  };

  const deprovision = async () => {
    setDeleting(true);
    try {
      const res = await api<DeleteResult>(`/api/games/${id}`, { method: 'DELETE' });
      setResult(res);
      if (res.ok) setDetail({ ...detail, listed: false, route: { configured: false } });
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const source = detail.forkedFrom;

  return (
    <div>
      <button
        onClick={() => navigate('/games')}
        className="text-sm mb-3"
        style={{ color: 'var(--accent)' }}
      >
        ← Games
      </button>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>
          {detail.name}{' '}
          <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>
            {detail.id}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={healRoute}
            disabled={healing || !detail.listed}
            title="Re-insert this game's D1 hosting route now instead of waiting for the hourly reconcile. Idempotent."
            className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--line)', color: 'var(--accent)' }}
          >
            {healing ? 'Healing…' : 'Re-heal route'}
          </button>
          <button
            onClick={() => setConfirming(true)}
            disabled={deleting || !detail.listed}
            className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: BAD, color: BAD }}
          >
            {detail.listed ? 'Deprovision' : 'Deprovisioned'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <Card
          label="Reachability"
          value={detail.http.status !== null ? `HTTP ${detail.http.status}` : 'Unreachable'}
          tone={detail.http.ok ? OK : BAD}
          note={
            detail.http.error ? detail.http.error.slice(0, 80) : detail.url.replace('https://', '')
          }
        />
        <Card
          label="Build status"
          value={detail.status}
          tone={detail.status === 'live' ? OK : detail.status === 'pending' ? WARN : BAD}
          note={detail.status === 'live' ? 'a deploy has succeeded' : 'never built successfully'}
        />
        <Card
          label="Hosting route"
          value={detail.route.configured ? 'configured' : 'missing'}
          tone={detail.route.configured ? OK : BAD}
          note={
            detail.route.configured
              ? (detail.route.r2Prefix ?? '')
              : 'host will 404 — use Re-heal route'
          }
        />
        <Card
          label="Registry"
          value={detail.listed ? 'listed' : 'unlisted'}
          tone={detail.listed ? OK : BAD}
          note={`hosted on ${detail.hostedOn}${detail.creatorGithub ? ` · ${detail.creatorGithub}` : ''}`}
        />
      </div>

      {source && (
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          Remixed from{' '}
          <button
            onClick={() => navigate(`/games/${sourceId(source)}`)}
            className="underline"
            style={{ color: 'var(--accent)' }}
          >
            {forkSourceLabel(source)}
          </button>
          {typeof source === 'object' && (
            <> · forked {new Date(source.forkedAt).toLocaleDateString()}</>
          )}
        </p>
      )}

      {/* A 200 from the host proves nothing on its own — it answers for the
          template scaffold too (#22). Say so where an operator would otherwise
          read green and stop looking. */}
      {detail.http.ok && detail.status !== 'live' && (
        <div
          className="rounded-xl border px-4 py-3 mb-4 text-sm"
          style={{ borderColor: WARN, color: WARN }}
        >
          This game answers HTTP 200 but has never built successfully — the host is serving the
          template scaffold, not the creator's code.
        </div>
      )}

      <Section title="Traffic (30 days)">
        {traffic === null && <Empty text="Loading…" />}
        {traffic === 'unconfigured' && (
          <Empty text="Not configured — set CF_API_TOKEN and CF_ZONE_ID on the admin worker to enable Cloudflare Analytics." />
        )}
        {traffic && typeof traffic === 'object' && 'error' in traffic && (
          <Empty text={traffic.error} />
        )}
        {traffic && typeof traffic === 'object' && 'totals' in traffic && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              label="Requests"
              value={traffic.totals.requests.toLocaleString()}
              tone="var(--ink)"
              note={traffic.host}
            />
            <Card
              label="Page views"
              value={traffic.totals.pageViews.toLocaleString()}
              tone="var(--ink)"
              note={`${traffic.since} → ${traffic.until}`}
            />
            <Card
              label="Unique visitors"
              value={traffic.totals.visitors.toLocaleString()}
              tone="var(--ink)"
              note={`${traffic.days.length} day(s) reported`}
            />
          </div>
        )}
      </Section>

      <Section title="Recent deploys">
        {detail.runs.length === 0 && <Empty text="No deploy.yml runs found." />}
        <div className="space-y-2">
          {detail.runs.map((r, i) => (
            <div
              key={`${r.sha}-${i}`}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs font-semibold"
                  style={{
                    color:
                      r.conclusion === 'success'
                        ? OK
                        : r.conclusion === 'failure' || r.conclusion === 'timed_out'
                          ? BAD
                          : WARN,
                  }}
                >
                  {r.conclusion}
                </span>
                <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                  {r.sha ?? '?'}
                  {r.updatedAt ? ` · ${timeAgo(r.updatedAt)}` : ''}
                </span>
              </div>
              <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--ink)' }}>
                {r.message || '(no commit message)'}
              </div>
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className="text-[11px]"
                  style={{ color: 'var(--accent)' }}
                >
                  view run
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={`VibeCode sessions (${sessions.length})`}>
        {sessions.length === 0 && <Empty text="No sessions are bound to this game." />}
        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/sessions/${s.id}`)}
              className="w-full text-left rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                  {s.name}
                </span>
                <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                  {s.deployed ? 'deployed' : 'draft'} · {timeAgo(s.updatedAt || s.createdAt)}
                </span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
                {s.user} · {s.id}
              </div>
            </button>
          ))}
        </div>
      </Section>

      {result && (
        <Section title="Action result">
          {result.error && (
            <div className="text-sm" style={{ color: BAD }}>
              {result.error}
            </div>
          )}
          <div className="space-y-1">
            {(result.steps ?? []).map((st, i) => (
              <div key={i} className="text-xs flex items-center gap-2">
                <span
                  style={{
                    color: st.status === 'ok' ? OK : st.status === 'skip' ? 'var(--muted)' : BAD,
                  }}
                >
                  {st.status.toUpperCase()}
                </span>
                <span style={{ color: 'var(--ink)' }}>{st.name}</span>
                <span style={{ color: 'var(--muted)' }}>{st.detail}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div
            role="dialog"
            aria-label="Confirm deprovision"
            className="w-full max-w-md rounded-xl border p-5"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
          >
            <h2 className="text-base font-bold mb-2" style={{ color: 'var(--ink)' }}>
              Deprovision {detail.id}?
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Delists it from the store, drops its hosting route, and archives the GitHub repo. The
              repo is archived, never hard-deleted, so the code survives.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={deprovision}
                disabled={deleting}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: BAD, color: '#fff' }}
              >
                {deleting ? 'Deprovisioning…' : 'Deprovision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone: string;
  note?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-lg font-bold mt-0.5" style={{ color: tone }}>
        {value}
      </div>
      {note && (
        <div className="text-[11px] mt-0.5 break-words" style={{ color: 'var(--muted)' }}>
          {note}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-4 mb-4"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm" style={{ color: 'var(--muted)' }}>
      {text}
    </p>
  );
}
