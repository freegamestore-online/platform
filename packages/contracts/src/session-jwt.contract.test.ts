import { describe, expect, it } from 'vitest';
import {
  FGS_ISSUER,
  signHs256Jwt,
  verifyHs256Jwt,
} from '../../../contracts/session-jwt/v1/contract';

const KEY = 'fgs-test-key';
const now = () => Math.floor(Date.now() / 1000);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');

/** A genuinely signed token with an arbitrary header and payload, built here so the
 *  contract's own signer can't hide a bug in its verifier. */
async function forge(header: object, payload: object, key = KEY): Promise<string> {
  const data = `${b64(header)}.${b64(payload)}`;
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
  return `${data}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, '')}`;
}
const HS256 = { alg: 'HS256', typ: 'JWT' };

describe('session-jwt contract', () => {
  it('round-trips and stamps the FGS issuer', async () => {
    const token = await signHs256Jwt({ sub: 'github:1', exp: now() + 60 }, KEY);
    expect(await verifyHs256Jwt(token, KEY)).toMatchObject({ sub: 'github:1', iss: FGS_ISSUER });
  });

  it('refuses a token signed with another key', async () => {
    const token = await signHs256Jwt({ sub: 'a', exp: now() + 60 }, 'other');
    expect(await verifyHs256Jwt(token, KEY)).toBeNull();
  });

  it('refuses a token minted for another store (wrong iss) even with a valid signature', async () => {
    const claims = { sub: 'a', exp: now() + 60 };
    expect(
      await verifyHs256Jwt(await forge(HS256, { ...claims, iss: 'freeappstore' }), KEY),
    ).toBeNull();
    // A wrong iss is refused even where a missing one is tolerated.
    expect(
      await verifyHs256Jwt(await forge(HS256, { ...claims, iss: 'freeappstore' }), KEY, {
        allowMissingIss: true,
      }),
    ).toBeNull();
  });

  it('a missing iss is refused unless the caller opts in', async () => {
    const t = await forge(HS256, { sub: 'a', exp: now() + 60 });
    expect(await verifyHs256Jwt(t, KEY)).toBeNull();
    expect(await verifyHs256Jwt(t, KEY, { allowMissingIss: true })).toMatchObject({ sub: 'a' });
  });

  it.each([{ alg: 'none' }, { alg: 'HS512' }, { alg: 'hs256' }, {}])(
    'refuses header %j',
    async (h) => {
      expect(
        await verifyHs256Jwt(await forge(h, { sub: 'a', iss: FGS_ISSUER, exp: now() + 60 }), KEY),
      ).toBeNull();
    },
  );

  it('refuses an expired token and one with no or non-numeric exp', async () => {
    for (const exp of [now() - 5, undefined, 'soon']) {
      const t = await forge(HS256, { sub: 'a', iss: FGS_ISSUER, exp });
      expect(await verifyHs256Jwt(t, KEY), String(exp)).toBeNull();
    }
  });

  it('refuses malformed input without throwing', async () => {
    for (const t of ['', 'a.b', 'a.b.c.d', '!!.@@.##', 'e30.e30.AAAA']) {
      expect(await verifyHs256Jwt(t, KEY), t).toBeNull();
    }
  });

  it('fails closed on an empty key', async () => {
    const token = await signHs256Jwt({ sub: 'a', exp: now() + 60 }, KEY);
    expect(await verifyHs256Jwt(token, '')).toBeNull();
    await expect(signHs256Jwt({ sub: 'a' }, '')).rejects.toThrow();
  });

  it('checks aud and typ only when asked', async () => {
    const t = await signHs256Jwt(
      { sub: 'a', exp: now() + 60, aud: 'console', typ: 'fgs_session' },
      KEY,
    );
    expect(await verifyHs256Jwt(t, KEY)).not.toBeNull();
    expect(await verifyHs256Jwt(t, KEY, { aud: 'console', typ: 'fgs_session' })).not.toBeNull();
    expect(await verifyHs256Jwt(t, KEY, { aud: 'agent' })).toBeNull();
    expect(await verifyHs256Jwt(t, KEY, { typ: 'handoff' })).toBeNull();
  });

  it('still accepts a standard-alphabet signature (admin sessions minted before #490)', async () => {
    // Find a payload whose signature contains + or / in standard base64.
    for (let i = 0; i < 200; i++) {
      const t = await forge(HS256, { sub: `u${i}`, iss: FGS_ISSUER, exp: now() + 60 });
      if (/[+/]/.test(t.split('.')[2]!)) {
        expect(await verifyHs256Jwt(t, KEY)).toMatchObject({ sub: `u${i}` });
        return;
      }
    }
    throw new Error('no +// signature found');
  });
});
