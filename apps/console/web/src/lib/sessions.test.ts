import { describe, expect, it } from 'vitest';
import {
  activityByGameId,
  activityLabel,
  activityTone,
  formatTokens,
  mapServerSession,
  type ServerSession,
  toDrafts,
} from './sessions';

const NOW = Date.UTC(2026, 6, 3, 12, 0, 0); // fixed clock for determinism

function session(over: Partial<ServerSession> = {}): ServerSession {
  return { id: 's1', name: 'My Game', deployed: false, createdAt: '2026-06-29 21:26:52', ...over };
}

describe('mapServerSession', () => {
  it('maps gameId/gameUrl to appId/appUrl and parses the D1 date', () => {
    const p = mapServerSession(
      session({ gameId: 'snake', gameUrl: 'https://snake.freegamestore.online', deployed: true }),
      NOW,
    );
    expect(p.appId).toBe('snake');
    expect(p.appUrl).toBe('https://snake.freegamestore.online');
    expect(p.deployed).toBe(true);
    expect(p.createdAt).toBe(new Date(Date.parse('2026-06-29 21:26:52')).toISOString());
    expect(Number.isNaN(p.updatedAt)).toBe(false);
  });

  it('falls back to the injected now for an unparseable date (never NaN)', () => {
    const p = mapServerSession(session({ createdAt: 'not-a-date' }), NOW);
    expect(p.updatedAt).toBe(NOW);
    expect(p.createdAt).toBe(new Date(NOW).toISOString());
  });

  it("names an untitled session 'Untitled'", () => {
    expect(mapServerSession(session({ name: '' }), NOW).name).toBe('Untitled');
  });

  it('carries token usage through when present', () => {
    const p = mapServerSession(session({ tokens: { input: 100, output: 40 } }), NOW);
    expect(p.tokens).toEqual({ input: 100, output: 40 });
  });

  it('carries activity through and uses its timestamp for sorting', () => {
    const p = mapServerSession(
      session({
        activity: { phase: 'writing', detail: 'Writing', updatedAt: '2026-07-03T13:00:00Z' },
      }),
      NOW,
    );
    expect(p.activity?.phase).toBe('writing');
    expect(p.updatedAt).toBe(Date.parse('2026-07-03T13:00:00Z'));
  });
});

describe('formatTokens', () => {
  it('passes small counts through and compacts thousands/millions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-3)).toBe('0');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(45678)).toBe('46k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('toDrafts', () => {
  it('keeps only undeployed sessions that are not already bound to a game', () => {
    const drafts = toDrafts([
      session({ id: 'a', deployed: false }),
      session({ id: 'b', deployed: true, gameId: 'snake' }),
      session({ id: 'c', deployed: false }),
      session({ id: 'd', deployed: false, gameId: 'live-but-misflagged' }),
    ]);
    expect(drafts.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('returns [] when everything is deployed', () => {
    expect(toDrafts([session({ deployed: true }), session({ deployed: true })])).toEqual([]);
  });

  it("defaults a missing title to 'Untitled'", () => {
    expect(toDrafts([session({ name: '' })])[0]!.name).toBe('Untitled');
  });

  it('carries draft activity', () => {
    expect(
      toDrafts([session({ activity: { phase: 'error', detail: 'boom' } })])[0]!.activity?.phase,
    ).toBe('error');
  });
});

describe('activity helpers', () => {
  it('labels and tones busy/failed/live statuses', () => {
    expect(activityLabel({ phase: 'writing' })).toBe('Writing');
    expect(activityTone({ phase: 'writing' })).toBe('accent');
    expect(activityLabel({ phase: 'building' })).toBe('Building');
    expect(activityLabel({ phase: 'error', detail: 'boom' })).toBe('Failed');
    expect(activityTone({ phase: 'error' })).toBe('danger');
    expect(activityLabel(undefined, true)).toBe('Live');
  });

  it('indexes the newest live-session activity by game id', () => {
    const byGame = activityByGameId([
      session({
        id: 'old',
        deployed: true,
        gameId: 'snake',
        activity: { phase: 'idle', updatedAt: '2026-07-03T10:00:00Z' },
      }),
      session({
        id: 'new',
        deployed: true,
        gameId: 'snake',
        activity: { phase: 'building', updatedAt: '2026-07-03T11:00:00Z' },
      }),
    ]);
    expect(byGame.get('snake')?.phase).toBe('building');
  });
});
