import { useEffect, useState } from 'react';
import { api, type PlatformStats } from './api.ts';

export function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function Overview() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PlatformStats>('/api/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stats) return <Loading />;

  const max = Math.max(1, ...stats.errorSeries.map((p) => p.c));
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Games" value={stats.games} />
        <Stat label="Creators" value={stats.creators} />
        <Stat
          label="Errors (24h)"
          value={stats.errors24h}
          tone={stats.errors24h > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Errors (total)"
          value={stats.errorsTotal}
          tone={stats.errorsTotal > 0 ? 'warn' : undefined}
        />
      </div>
      <h2 className="text-sm font-semibold mb-3 text-muted">Errors (last 14 days)</h2>
      <div className="flex items-end gap-1.5 h-36 rounded-xl border border-line bg-panel p-3">
        {stats.errorSeries.length === 0 && (
          <p className="text-sm self-center mx-auto text-muted">No errors logged.</p>
        )}
        {stats.errorSeries.map((p) => (
          <div
            key={p.d}
            className="flex-1 flex flex-col items-center justify-end gap-1 h-full"
            title={`${p.d}: ${p.c}`}
          >
            <span className="text-[10px] text-muted">{p.c}</span>
            <div
              className={`w-3/4 rounded-t min-h-[2px] ${p.c > 0 ? 'bg-danger' : 'bg-line'}`}
              // Dynamic: bar height is computed from the error count
              style={{ height: `${Math.round((p.c / max) * 90)}%` }}
            />
            <span className="text-[9px] text-muted">{p.d.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-warning'
        : tone === 'good'
          ? 'text-success'
          : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs mt-0.5 text-muted">{label}</div>
    </div>
  );
}
