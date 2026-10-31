import { useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import { ErrorBox, Loading } from './Overview.tsx';

// Admin cross-game usage dashboard (#351). Every number comes from the admin
// endpoint /api/analytics/platform, which reads the game analytics dataset.

export interface PlatformGameUsage {
  id: string;
  name: string;
  status: string | null;
  creatorGithub: string | null;
  views7: number;
  views30: number;
  distinctPages7: number;
  distinctPages30: number;
  daily: number[];
  flagged: boolean;
}

export interface PlatformUsage {
  generatedAt: string;
  days: number;
  visitorsRecorded: false;
  totals: { views7: number; views30: number; distinctPages7: number; distinctPages30: number };
  daily: Array<{ t: string; views: number }>;
  games: PlatformGameUsage[];
  flaggedCount: number;
}

type SortKey = 'name' | 'views7' | 'views30' | 'distinctPages30' | 'flagged';

const fmt = (n: number) => n.toLocaleString();

/** Bars for a series, as SVG geometry. Plain attributes, so no style props. */
function Bars({
  values,
  height,
  width,
  label,
}: {
  values: number[];
  height: number;
  width: number;
  label: string;
}) {
  const max = Math.max(1, ...values);
  const slot = width / Math.max(1, values.length);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 1 : 0, (v / max) * (height - 1));
        return (
          <rect
            key={i}
            x={i * slot}
            y={height - h}
            width={Math.max(1, slot - 1)}
            height={h}
            className="fill-accent"
            opacity={v > 0 ? 0.85 : 0.15}
          >
            <title>{`${v.toLocaleString()} views`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums text-ink">{value}</div>
      {note && <div className="text-xs mt-1 text-muted">{note}</div>}
    </div>
  );
}

export function PlatformUsagePage({ navigate }: { navigate: (h: string) => void }) {
  const [data, setData] = useState<PlatformUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('views30');
  const [sortDesc, setSortDesc] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api<PlatformUsage>('/api/analytics/platform')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const filtered = data.games.filter(
      (g) =>
        (!flaggedOnly || g.flagged) && (!q || g.name.toLowerCase().includes(q) || g.id.includes(q)),
    );
    const dir = sortDesc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'flagged')
        return (Number(a.flagged) - Number(b.flagged)) * dir || a.name.localeCompare(b.name);
      return (a[sortKey] - b[sortKey]) * dir || a.name.localeCompare(b.name);
    });
  }, [data, sortKey, sortDesc, flaggedOnly, search]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(key !== 'name');
    }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (sortDesc ? ' ↓' : ' ↑') : '');
  const th = (key: SortKey, text: string, align: 'left' | 'right' = 'right') => (
    <th className={`py-2 px-2 font-medium ${align === 'left' ? 'text-left' : 'text-right'}`}>
      <button type="button" onClick={() => sortBy(key)} className="font-medium text-muted">
        {text}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink">
            Usage{' '}
            <span className="text-sm font-normal text-muted">across {data.games.length} games</span>
          </h1>
          <p className="text-xs mt-1 text-muted">
            Page views from the platform loader. Visitors aren&apos;t recorded (no cookie, no IP
            stored), so &ldquo;distinct pages&rdquo; stands in for them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFlaggedOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              flaggedOnly ? 'border-warning bg-warning text-white' : 'border-line text-muted'
            }`}
          >
            No views ({data.flaggedCount})
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm w-44"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card label="Views · 7 days" value={fmt(data.totals.views7)} />
        <Card label="Views · 30 days" value={fmt(data.totals.views30)} />
        <Card label="Distinct pages · 7 days" value={fmt(data.totals.distinctPages7)} />
        <Card label="Distinct pages · 30 days" value={fmt(data.totals.distinctPages30)} />
      </div>

      <div className="rounded-xl border border-line bg-panel p-4 mb-4">
        <div className="text-xs mb-2 text-muted">All games, last {data.days} days</div>
        <div className="h-24">
          <Bars
            values={data.daily.map((d) => d.views)}
            height={100}
            width={data.daily.length * 4}
            label={`Platform views per day, last ${data.days} days`}
          />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              {th('name', 'Game', 'left')}
              {th('views7', 'Views 7d')}
              {th('views30', 'Views 30d')}
              {th('distinctPages30', 'Distinct pages 30d')}
              <th className="py-2 px-2 font-medium text-left text-muted">Trend 30d</th>
              {th('flagged', 'Status', 'left')}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="border-t border-line">
                <td className="py-2 px-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/games/${g.id}`)}
                    className="font-medium text-left text-ink"
                  >
                    {g.name}
                  </button>
                  <div className="text-xs text-muted">
                    {g.id}
                    {g.creatorGithub ? ` · ${g.creatorGithub}` : ''}
                  </div>
                </td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(g.views7)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(g.views30)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(g.distinctPages30)}</td>
                <td className="py-2 px-2 w-32">
                  <div className="h-8">
                    <Bars
                      values={g.daily}
                      height={30}
                      width={g.daily.length}
                      label={`${g.name} views, last 30 days`}
                    />
                  </div>
                </td>
                <td className="py-2 px-2">
                  {g.flagged ? (
                    <span
                      title="No page views in 30 days. The game is probably missing the platform analytics loader."
                      className="inline-flex items-center rounded-full border border-warning text-warning px-1.5 py-0.5 text-[10px] font-semibold"
                    >
                      no views
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{g.status ?? 'live'}</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  No games match.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-line">
            <tr className="font-semibold">
              <td className="py-2 px-2 text-ink">Total · {data.games.length} games</td>
              <td className="py-2 px-2 text-right tabular-nums">{fmt(data.totals.views7)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{fmt(data.totals.views30)}</td>
              <td className="py-2 px-2 text-right tabular-nums">
                {fmt(data.totals.distinctPages30)}
              </td>
              <td />
              <td className="py-2 px-2 text-xs font-normal text-muted">
                {data.flaggedCount} with no views
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
