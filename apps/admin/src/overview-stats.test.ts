import { describe, expect, it } from 'vitest';
import { buildAdminOverviewStats } from './errlog';

describe('admin overview stats contract', () => {
  it('combines registry counts with error-log field names expected by the web app', () => {
    expect(
      buildAdminOverviewStats({ total: 12, last24h: 3, series: [{ d: '2026-10-25', c: 3 }] }, [
        { id: 'chess', creatorGithub: 'Alice' },
        { id: 'tetris', creatorGithub: 'alice' },
        { id: 'snake', creatorGithub: 'bob' },
        { id: '2048' },
      ]),
    ).toEqual({
      games: 4,
      creators: 2,
      errors24h: 3,
      errorsTotal: 12,
      errorSeries: [{ d: '2026-10-25', c: 3 }],
    });
  });

  it('still returns a complete UI-safe shape when the registry is unavailable', () => {
    expect(buildAdminOverviewStats({ total: 0, last24h: 0, series: [] }, null)).toEqual({
      games: 0,
      creators: 0,
      errors24h: 0,
      errorsTotal: 0,
      errorSeries: [],
    });
  });
});
