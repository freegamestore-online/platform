/**
 * CSP violation receiver — CF Pages Function at /v1/csp-report.
 *
 * Browsers POST a JSON body when a Content-Security-Policy directive blocks
 * something, or when Content-Security-Policy-Report-Only would have blocked.
 * We log them so they appear in `wrangler tail` and Cloudflare Pages logs.
 *
 * No DB / KV writes yet — that's a follow-up once we want trend analysis.
 *
 * Same-origin endpoint (storefront posts to its own /v1/csp-report), so no
 * CORS gymnastics. Always returns 204.
 *
 * Caps inbound size at 16 KB so a buggy / hostile client can't flood the log.
 */

const MAX_BYTES = 16 * 1024;

export async function onRequestPost(context) {
  try {
    const len = Number(context.request.headers.get('content-length') || '0');
    if (len > MAX_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    // Some browsers send application/csp-report, some send application/reports+json,
    // some send application/json. We accept all three — parse as JSON either way.
    const raw = await context.request.text();
    if (raw.length > MAX_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 1000) }; }
    // Truncate for log readability. CF logs cap per line, so keep it tight.
    const summary = JSON.stringify(parsed).slice(0, 2000);
    const ua = context.request.headers.get('user-agent') || '';
    console.log(`csp-report ua="${ua.slice(0, 100)}" report=${summary}`);
  } catch (err) {
    console.error('csp-report handler error:', err && err.message);
  }
  // Browsers don't care about the response body for reports. 204 is correct.
  return new Response(null, { status: 204 });
}

// Reject other methods politely — saves the log noise of a 404 dance.
export function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('CSP report endpoint — POST only', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
