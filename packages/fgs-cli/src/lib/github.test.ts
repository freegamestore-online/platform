import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDeviceFlow } from './github.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('device authorization errors (#534)', () => {
  it('explains how the OAuth app owner can enable Device Flow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'device_flow_disabled',
            error_description: 'Device Flow must be explicitly enabled for this App',
          },
          { status: 400 },
        ),
      ),
    );
    await expect(startDeviceFlow('test-client')).rejects.toThrow(
      /400.*device_flow_disabled.*OAuth app owner.*Developer settings.*OAuth apps.*Enable Device Flow/,
    );
  });

  it('identifies incorrect client credentials with safe, local guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'incorrect_client_credentials',
            error_description: 'gho_sensitive-token',
          },
          { status: 401 },
        ),
      ),
    );
    const error = await startDeviceFlow('test-client').catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /401.*incorrect_client_credentials.*FGS_GITHUB_CLIENT_ID/,
    );
    expect((error as Error).message).not.toContain('gho_sensitive-token');
  });

  it.each(['', '<html>upstream failure</html>', '{broken', 'null', '[]'])(
    'falls back to the HTTP status for an unusable body: %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => new Response(body, { status: 502 })),
      );
      await expect(startDeviceFlow('test-client')).rejects.toThrow(
        'GitHub device-code request failed: 502',
      );
    },
  );

  it('never echoes arbitrary fields, descriptions, codes, headers or response bodies', async () => {
    const secrets = ['gho_private', 'device_private', 'user_private', 'Bearer private'];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: secrets[0],
            error_description: secrets.join(' '),
            device_code: secrets[1],
            user_code: secrets[2],
            access_token: secrets[0],
          },
          { status: 400, headers: { Authorization: secrets[3]! } },
        ),
      ),
    );
    const error = await startDeviceFlow('test-client').catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    for (const secret of secrets) expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message.length).toBeLessThan(500);
  });

  it('preserves successful authorization, polling and identity lookup', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          device_code: 'device-test',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(Response.json({ access_token: 'dummy-access-token' }))
      .mockResolvedValueOnce(Response.json({ login: 'octocat' }));
    vi.stubGlobal('fetch', fetch);
    const flow = await startDeviceFlow('test-client');
    expect(flow.userCode).toBe('ABCD-EFGH');
    expect(flow.verificationUri).toBe('https://github.com/login/device');
    const result = flow.poll();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ accessToken: 'dummy-access-token', login: 'octocat' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
