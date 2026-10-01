import { describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './delete';

// Regression for #77: /auth/delete deleted only a legacy KV entry and answered
// { ok: true }, so the UI promised permanent deletion of data that survived.
// Until real cross-service deletion exists it must fail loudly and do nothing.

async function post(cookie = 'fgs_pub_session=legacy123; __Host-fgs_token=a.b.c') {
  const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
  const context = {
    request: new Request('https://console.freegamestore.online/auth/delete', {
      method: 'POST',
      headers: { Cookie: cookie },
    }),
    env: { SESSIONS: kv, CREATORS: kv },
  } as unknown as Parameters<typeof onRequestPost>[0];
  return { res: await onRequestPost(context), kv };
}

describe('POST /auth/delete', () => {
  it('reports failure instead of claiming the account was deleted', async () => {
    const { res } = await post();
    expect(res.status).toBe(501);
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBeUndefined();
    expect(body.error).toMatch(/nothing was deleted/i);
  });

  it('does not partially delete data or end the session', async () => {
    const { res, kv } = await post();
    expect(kv.delete).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
