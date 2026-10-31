import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type GameInfo, type QualityData } from './api.ts';
import { ErrorBox, Loading } from './Overview.tsx';

/** Build-status badge (#22). Shown ONLY when a game is not live — the list is
 *  overwhelmingly live games, so badging every row would add noise and bury the
 *  two states an operator needs to spot.
 *
 *  A missing status means the registry entry predates the field, which is
 *  genuinely live; the worker already resolves that, and defaulting here too
 *  keeps the badge correct if an older worker is still serving /api/status. */
function StatusBadge({ status }: { status?: GameInfo['status'] }) {
  if (status !== 'pending' && status !== 'failed') return null;
  const tone = status === 'pending' ? 'border-warning text-warning' : 'border-danger text-danger';
  const title =
    status === 'pending'
      ? 'Provisioned, but no deploy has succeeded yet — this game is not live'
      : 'Every deploy so far has failed — this game has never been live';
  return (
    <span
      title={title}
      className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold align-middle ${tone}`}
    >
      {status}
    </span>
  );
}

interface DeployRow {
  id: string;
  conclusion: string | null;
  drifted: boolean;
}

/** Last deploy outcome, plus a distinct "stale" state for a game whose repo has
 *  moved past its last successful build — players are on older code even though
 *  the last run may have been green long ago. */
function DeployBadge({ row }: { row?: DeployRow }) {
  if (!row) return <span className="text-xs text-muted">—</span>;
  const label = row.drifted ? 'stale' : (row.conclusion ?? 'no runs');
  const tone =
    row.drifted || row.conclusion === 'failure' || row.conclusion === 'timed_out'
      ? 'border-danger text-danger'
      : row.conclusion === 'success'
        ? 'border-success text-success'
        : 'border-warning text-warning';
  const title = row.drifted
    ? 'main has commits that were never built to R2 — players are on an older build'
    : `last deploy.yml run: ${row.conclusion ?? 'none concluded'}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

export function GamesList({ navigate }: { navigate: (h: string) => void }) {
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [quality, setQuality] = useState<Map<string, QualityData['games'][number]>>(new Map());
  const [deploys, setDeploys] = useState<Map<string, DeployRow>>(new Map());
  const [search, setSearch] = useState('');
  const [failingOnly, setFailingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GameInfo[]>('/api/status')
      .then(setGames)
      .catch((e) => setError(e.message));
    api<QualityData>('/api/quality')
      .then((q) => setQuality(new Map((q?.games ?? []).map((g) => [g.id, g]))))
      .catch(() => {}); // 204/no data is fine
    // Server-side cached 5 min (~2 GitHub calls per game). Never fail the list
    // over it — without deploy data the table still renders.
    api<{ games: DeployRow[] }>('/api/status/deploys')
      .then((d) => setDeploys(new Map((d.games ?? []).map((g) => [g.id, g]))))
      .catch(() => {});
  }, []);

  const isFailing = useCallback(
    (id: string) => {
      const d = deploys.get(id);
      // "Failing" = the last deploy concluded badly, OR the repo has moved past
      // its last successful build (drift). Both mean players are not on the code
      // in main; a badge that only showed the former would miss the stale-serving
      // case entirely.
      return !!d && (d.conclusion === 'failure' || d.conclusion === 'timed_out' || d.drifted);
    },
    [deploys],
  );

  const failingCount = useMemo(
    () => (games ?? []).filter((g) => isFailing(g.id)).length,
    [games, isFailing],
  );

  const filtered = useMemo(() => {
    if (!games) return [];
    const q = search.toLowerCase();
    const bySearch = q
      ? games.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q))
      : games;
    return failingOnly ? bySearch.filter((g) => isFailing(g.id)) : bySearch;
  }, [games, search, failingOnly, isFailing]);

  if (error) return <ErrorBox message={error} />;
  if (!games) return <Loading />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-xl font-bold text-ink">
          Games <span className="text-sm font-normal text-muted">({games.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFailingOnly((v) => !v)}
            disabled={deploys.size === 0}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
              failingOnly ? 'border-danger bg-danger text-white' : 'border-line text-muted'
            }`}
            title={
              deploys.size === 0
                ? 'Deploy status unavailable'
                : 'Show only games whose last deploy failed or that are serving a stale build'
            }
          >
            Failing only ({failingCount})
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="rounded-lg border px-3 py-1.5 text-sm w-48 border-line bg-panel text-ink"
          />
        </div>
      </div>
      <div className="rounded-xl border border-line bg-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Game</th>
              <th className="px-4 py-2.5">Deploy</th>
              <th className="px-4 py-2.5">Quality</th>
              <th className="px-4 py-2.5">Load</th>
              <th className="px-4 py-2.5">Live</th>
              <th className="px-4 py-2.5">Repo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const q = quality.get(g.id);
              const qColor = !q
                ? 'text-muted'
                : q.score >= 95
                  ? 'text-success'
                  : q.score >= 80
                    ? 'text-warning'
                    : 'text-danger';
              return (
                <tr key={g.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/games/${g.id}`)}
                      className="font-semibold text-left text-accent"
                    >
                      {g.name}
                    </button>{' '}
                    <span className="text-xs text-muted">{g.id}</span>
                    <StatusBadge status={g.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <DeployBadge row={deploys.get(g.id)} />
                  </td>
                  <td className={`px-4 py-2.5 font-bold ${qColor}`}>{q ? q.score : '—'}</td>
                  <td className="px-4 py-2.5 text-muted">{q ? `${q.loadTimeMs}ms` : '—'}</td>
                  <td className="px-4 py-2.5">
                    <a
                      href={`https://${g.domain}`}
                      target="_blank"
                      rel="noopener"
                      className="text-accent"
                    >
                      {g.domain}
                    </a>
                  </td>
                  <td className="px-4 py-2.5">
                    <a
                      href={`https://github.com/${g.org}/${g.id}`}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-muted"
                    >
                      {g.org}/{g.id}
                    </a>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-muted" colSpan={6}>
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
