import { describe, expect, it } from 'vitest';
import { mintSessionToken } from './auth';
import { resolveCaller } from './caller';
import type { Env } from './env';

// #472 — ownership is matched on the stable numeric GitHub id when the
// credential carries one. The fgs_token `sub` is `github:<id>`; the admin used
// to decode the payload and keep only the login.

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fgsToken = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

function env(): Env {
  return {
    SESSION_SIGNING_KEY: 'signing-key',
    // The auth worker's /me verifies the signature; here it simply accepts.
    AUTH: { fetch: async () => new Response(JSON.stringify({ email: null }), { status: 200 }) },
  } as unknown as Env;
}

const request = (headers: Record<string, string>) =>
  new Request('https://admin.freegamestore.online/api/games/chess', { method: 'PATCH', headers });

describe('resolveCaller — creator identity (#472)', () => {
  it('decodes the numeric GitHub id from the fgs_token sub alongside the login', async () => {
    const caller = await resolveCaller(
      request({ 'X-FGS-Token': fgsToken({ login: 'serge', sub: 'github:42' }) }),
      env(),
    );
    expect(caller.login).toBe('serge');
    expect(caller.githubId).toBe('42');
  });

  it('leaves githubId null for a subject that is not github:<id>, or no subject', async () => {
    for (const payload of [{ login: 'serge', sub: 'google:7' }, { login: 'serge' }]) {
      const caller = await resolveCaller(request({ 'X-FGS-Token': fgsToken(payload) }), env());
      expect(caller.login).toBe('serge');
      expect(caller.githubId).toBeNull();
    }
  });

  it('an admin-minted CLI session carries the GitHub id it was minted with', async () => {
    const bearer = await mintSessionToken('serge', 'signing-key', '2824906');
    const caller = await resolveCaller(request({ Authorization: `Bearer ${bearer}` }), env());
    expect(caller.login).toBe('serge');
    expect(caller.githubId).toBe('2824906');
  });

  it('a CLI session minted before #472 (no gid) falls back to the login', async () => {
    const bearer = await mintSessionToken('serge', 'signing-key');
    const caller = await resolveCaller(request({ Authorization: `Bearer ${bearer}` }), env());
    expect(caller.login).toBe('serge');
    expect(caller.githubId).toBeNull();
  });

  it('is anonymous without a credential', async () => {
    const caller = await resolveCaller(request({}), env());
    expect(caller).toEqual({ admin: null, isAdmin: false, login: null, githubId: null });
  });
});
