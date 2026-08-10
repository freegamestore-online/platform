interface Env {
  SESSIONS: KVNamespace;
}

const COOKIE_NAME = "fgs_pub_session";
const COOKIE_DOMAIN = ".freegamestore.online";

function parseCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match?.[1] ?? null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = parseCookie(context.request);
  if (token) {
    await context.env.SESSIONS.delete(`sessions:${token}`);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=; Domain=${COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
};
