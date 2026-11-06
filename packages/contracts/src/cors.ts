// No localhost here (#486): a local dev origin is trusted per deployment, by the
// caller, only when its DEV_ORIGIN env var names it.
export function corsHeaders(request: Request, domain: string): Record<string, string> {
  const origin = request.headers.get('Origin');
  const firstParty =
    origin === `https://console.${domain}` || origin === `https://publish.${domain}`;
  const allowed = origin && firstParty ? origin : `https://console.${domain}`;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}
