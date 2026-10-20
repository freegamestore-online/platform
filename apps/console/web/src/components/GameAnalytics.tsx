import { useEffect, useState } from 'react';
import {
  ANALYTICS_WINDOWS,
  fetchGameAnalytics,
  type GameAnalyticsConfig,
  type GameAnalyticsResponse,
  saveGameAnalyticsConfig,
  seriesBars,
  statsUnavailableMessage,
} from '../lib/gameAnalytics';
import { Button, Card, Field, Input } from './ui';

const CHART_W = 600;
const CHART_H = 120;

/** Owner-only analytics panel for one live game (#354). Page views and custom
 *  events over time, plus the owner's GA4 and Plausible tags. */
export function GameAnalytics({ gameId }: { gameId: string }) {
  const [days, setDays] = useState<number>(7);
  const [kind, setKind] = useState<string>('pageview');
  const [data, setData] = useState<GameAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [ga4, setGa4] = useState('');
  const [plausible, setPlausible] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGameAnalytics(gameId, { days, kind }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setData(res.data);
        setError(null);
        // Seed the form from the saved config on first load only, so an unsaved
        // edit isn't overwritten when the window changes.
        setGa4((prev) => prev || res.data.config.ga4 || '');
        setPlausible((prev) => prev || res.data.config.plausible || '');
      } else {
        setData(null);
        setError(
          res.status === 503 ? 'Analytics is not set up on this environment yet.' : res.error,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, days, kind]);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    const config: GameAnalyticsConfig = {
      ga4: ga4.trim() || null,
      plausible: plausible.trim() || null,
    };
    const res = await saveGameAnalyticsConfig(gameId, config);
    setSaving(false);
    setSaveMsg(
      res.ok
        ? { kind: 'ok', text: 'Saved. Visitors pick the change up within an hour.' }
        : { kind: 'err', text: res.error },
    );
  }

  const stats = data?.stats ?? null;
  const bars = stats ? seriesBars(stats.series, CHART_W, CHART_H) : [];
  // #364: the API answers 200 with the saved tags even when the numbers can't
  // load; say why instead of drawing an empty chart.
  const statsMissing = data !== null && stats === null;

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <select
          aria-label="Time window"
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {ANALYTICS_WINDOWS.map((d) => (
            <option key={d} value={d}>
              Last {d} day{d === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Cookieless and private. FreeGameStore counts page views and custom events, not individual
        visitors.
      </p>

      {error && (
        <p role="alert" className="text-sm mb-4 text-[#ef4444]">
          {error}
        </p>
      )}

      {statsMissing && (
        <p role="status" className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          {statsUnavailableMessage(data?.statsUnavailable)}
        </p>
      )}

      {!error && !statsMissing && (
        <>
          <div className="flex gap-6 mb-4">
            <div>
              <div className="text-2xl font-bold" data-testid="total-views">
                {stats ? stats.total_views.toLocaleString() : loading ? '…' : '0'}
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {kind === 'pageview' ? 'Page views' : `“${kind}” events`}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {stats ? stats.unique_paths.toLocaleString() : loading ? '…' : '0'}
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Distinct pages
              </div>
            </div>
          </div>

          <svg
            role="img"
            aria-label={`${kind} over the last ${days} days`}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full h-32 mb-4"
            preserveAspectRatio="none"
          >
            {bars.map((b) => (
              <rect
                key={b.t}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                fill="var(--accent)"
                opacity="0.85"
              >
                <title>{`${b.t}: ${b.views}`}</title>
              </rect>
            ))}
          </svg>

          {stats && (
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <BreakdownList
                title="Top pages"
                rows={stats.top_paths.map((r) => [r.path, r.views])}
              />
              <BreakdownList
                title="Referrers"
                rows={stats.top_referrers.map((r) => [r.referrer, r.views])}
              />
              <BreakdownList
                title="Countries"
                rows={stats.top_countries.map((r) => [r.country, r.views])}
              />
              <BreakdownList
                title="Devices"
                rows={stats.device_split.map((r) => [r.device, r.views])}
              />
            </div>
          )}

          {stats && stats.events.length > 0 && (
            <div className="mt-4 text-sm">
              <h3 className="font-semibold mb-1">Custom events</h3>
              <ul className="flex flex-wrap gap-2">
                {stats.events.map((e) => (
                  <li key={e.kind}>
                    <button
                      type="button"
                      onClick={() => setKind(kind === e.kind ? 'pageview' : e.kind)}
                      aria-pressed={kind === e.kind}
                      className="rounded-full border border-[var(--border)] px-3 py-1"
                    >
                      {e.kind} · {e.count.toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3 className="font-semibold text-sm">Your analytics tags</h3>
        <Field
          label="Google Analytics 4 ID"
          htmlFor="ga4-id"
          hint="Optional. Looks like G-XXXXXXXXXX."
        >
          <Input
            id="ga4-id"
            value={ga4}
            onChange={(e) => setGa4(e.target.value)}
            placeholder="G-XXXXXXXXXX"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Plausible domain"
          htmlFor="plausible-domain"
          hint="Optional. The domain your Plausible site uses."
        >
          <Input
            id="plausible-domain"
            value={plausible}
            onChange={(e) => setPlausible(e.target.value)}
            placeholder="mygame.freegamestore.online"
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? 'Saving…' : 'Save tags'}
          </Button>
          {saveMsg && (
            <span
              role={saveMsg.kind === 'err' ? 'alert' : 'status'}
              className={`text-sm ${saveMsg.kind === 'err' ? 'text-[#ef4444]' : ''}`}
            >
              {saveMsg.text}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div>
      <h3 className="font-semibold mb-1">{title}</h3>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No data yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(([label, views]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="truncate">{label || '(direct)'}</span>
              <span className="tabular-nums">{views.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
