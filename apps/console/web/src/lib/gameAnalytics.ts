// Owner analytics client (#354). Talks to /api/analytics/:id, which proxies to the
// admin worker's owner-only stats endpoint.

export interface GameAnalyticsStats {
  total_views: number;
  unique_paths: number;
  series: Array<{ t: string; views: number }>;
  top_paths: Array<{ path: string; views: number }>;
  top_referrers: Array<{ referrer: string; views: number }>;
  top_countries: Array<{ country: string; views: number }>;
  device_split: Array<{ device: string; views: number }>;
  events: Array<{ kind: string; count: number }>;
}

export interface GameAnalyticsConfig {
  ga4: string | null;
  plausible: string | null;
}

export interface GameAnalyticsResponse {
  appId: string;
  days: number;
  kind: string;
  bucket: 'hour' | 'day';
  path: string | null;
  config: GameAnalyticsConfig;
  stats: GameAnalyticsStats;
}

export interface StatsRequest {
  days: number;
  kind?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Windows the owner can pick. Matches the admin cap of 90 days. */
export const ANALYTICS_WINDOWS = [1, 7, 30, 90] as const;

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}

export async function fetchGameAnalytics(
  gameId: string,
  req: StatsRequest,
): Promise<ApiResult<GameAnalyticsResponse>> {
  const qs = new URLSearchParams({ days: String(req.days) });
  if (req.kind && req.kind !== 'pageview') qs.set('kind', req.kind);
  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(gameId)}?${qs.toString()}`, {
      credentials: 'include',
    });
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
    return { ok: true, data: (await res.json()) as GameAnalyticsResponse };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach analytics. Try again." };
  }
}

export async function saveGameAnalyticsConfig(
  gameId: string,
  config: GameAnalyticsConfig,
): Promise<ApiResult<GameAnalyticsConfig>> {
  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(gameId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(config),
    });
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
    const data = (await res.json()) as { config: GameAnalyticsConfig };
    return { ok: true, data: data.config };
  } catch {
    return { ok: false, status: 0, error: "Couldn't save. Try again." };
  }
}

export interface SeriesBar {
  t: string;
  views: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lays out the time series as SVG bars. Geometry is plain numbers, so the chart
 *  needs no runtime inline styles (the rule for game pages under strict CSP). */
export function seriesBars(
  series: Array<{ t: string; views: number }>,
  width: number,
  height: number,
): SeriesBar[] {
  if (series.length === 0) return [];
  const max = Math.max(1, ...series.map((p) => p.views));
  const gap = 2;
  const barWidth = Math.max(1, (width - gap * (series.length - 1)) / series.length);
  return series.map((p, i) => {
    const barHeight = p.views === 0 ? 0 : Math.max(1, (p.views / max) * height);
    return {
      t: p.t,
      views: p.views,
      x: i * (barWidth + gap),
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
}
