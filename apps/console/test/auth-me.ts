import { vi } from 'vitest';

// resolveCreatorUser asks auth's /me whether the account still stands behind a
// valid token (#499). Tests that care about the OTHER upstream (admin, GitHub)
// stub fetch with this: auth's /me answers `meStatus`, every other request goes
// to `rest`, which is returned so the test can assert on it alone.
export function stubFetchWithAuth<T extends (...args: never[]) => unknown>(
  rest: T = vi.fn() as unknown as T,
  meStatus = 200,
): T {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://auth.freegamestore.online/me') {
      return new Response('{}', { status: meStatus });
    }
    return (rest as unknown as (i: RequestInfo | URL, n?: RequestInit) => unknown)(input, init);
  });
  return rest;
}
