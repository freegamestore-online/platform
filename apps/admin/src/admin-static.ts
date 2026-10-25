export interface AdminStaticDeps {
  authenticate(request: Request): Promise<{ email: string | null; isAdmin: boolean }>;
  renderSignIn(email: string | null): string;
  assets?: Fetcher;
}

/** Serve the console shell only after the same allowlist gate as its APIs. */
export async function serveAdminStatic(request: Request, deps: AdminStaticDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/sw.js' && deps.assets) {
    const response = await deps.assets.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Service-Worker-Allowed', '/');
    return new Response(response.body, { status: response.status, headers });
  }

  const { email, isAdmin } = await deps.authenticate(request);
  if (!isAdmin) {
    return new Response(deps.renderSignIn(email), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (deps.assets) {
    const assetRes = await deps.assets.fetch(request);
    if (assetRes.status !== 404) return assetRes;
    return deps.assets.fetch(
      new Request(new URL('/', request.url).toString(), { headers: request.headers }),
    );
  }
  return new Response('admin app assets missing (build web/)', { status: 500 });
}
