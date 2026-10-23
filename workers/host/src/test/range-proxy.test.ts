import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock('../seo', async (original) => ({ ...await original<typeof import('../seo')>(), publicGame: vi.fn().mockResolvedValue(undefined) }));
import { __clearRouteCache, type Route } from "../host";
import worker from "../index";

// #74: (1) suffix Range requests (`bytes=-N`) got a Content-Range describing the
// WHOLE file while only N bytes were sent; (2) the console/publish proxy let
// fetch() follow redirects server-side, so a Pages Function 302 (e.g.
// /auth/handoff setting the session cookie) never reached the browser.

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const SIZE = 1000;
const DATA = "x".repeat(SIZE);
const route: Route = { slug: "space", zone: "freegamestore.online", r2_prefix: "games/space", store: "games" };

function db(): D1Database {
  return {
    prepare: () => ({ bind: () => ({ first: async () => route }) }),
  } as unknown as D1Database;
}

/** R2 stub: parses Range into the shapes R2 actually returns. */
function bucket(): R2Bucket {
  return {
    get: async (_key: string, opts?: { range?: Headers }) => {
      const header = opts?.range?.get("range") ?? "";
      const m = /^bytes=(\d*)-(\d*)$/.exec(header);
      let range: R2Range | undefined;
      let body = DATA;
      if (m) {
        if (m[1] === "") {
          range = { suffix: Number(m[2]) };
          body = DATA.slice(-Number(m[2]));
        } else if (m[2] === "") {
          range = { offset: Number(m[1]) };
          body = DATA.slice(Number(m[1]));
        } else {
          const offset = Number(m[1]);
          const length = Number(m[2]) - offset + 1;
          range = { offset, length };
          body = DATA.slice(offset, offset + length);
        }
      }
      // Production R2 reports the whole-object range even for a plain GET.
      return { size: SIZE, httpEtag: '"e"', range: range ?? { offset: 0, length: SIZE }, body } as unknown as R2ObjectBody;
    },
  } as unknown as R2Bucket;
}

async function get(range: string) {
  __clearRouteCache();
  const req = new Request("https://space.freegamestore.online/clip.mp4", {
    headers: { host: "space.freegamestore.online", range },
  });
  return worker.fetch(req, { DB: db(), APPS: bucket() } as never, ctx);
}

describe("Range responses (#74)", () => {
  it("answers a suffix range with the tail's Content-Range", async () => {
    const res = await get("bytes=-100");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 900-999/1000");
  });

  it("clamps a suffix longer than the file to the whole file", async () => {
    const res = await get("bytes=-5000");
    expect(res.headers.get("content-range")).toBe("bytes 0-999/1000");
  });

  it("still answers an explicit range", async () => {
    expect((await get("bytes=100-199")).headers.get("content-range")).toBe("bytes 100-199/1000");
  });

  it("answers a plain GET (no Range) with 200, not 206", async () => {
    __clearRouteCache();
    const req = new Request("https://space.freegamestore.online/clip.mp4", {
      headers: { host: "space.freegamestore.online" },
    });
    const res = await worker.fetch(req, { DB: db(), APPS: bucket() } as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
  });

  it("still answers an open-ended range", async () => {
    expect((await get("bytes=900-")).headers.get("content-range")).toBe("bytes 900-999/1000");
  });
});

describe("console proxy redirects (#74)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Upstream Pages stub that behaves like fetch(): follows 3xx unless told not to. */
  function upstream(location: string) {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        if (init.redirect === "manual") {
          const headers = new Headers({ location });
          headers.append("set-cookie", "__Host-fgs_token=abc; Path=/; HttpOnly; Secure");
          return new Response(null, { status: 302, headers });
        }
        // Followed server-side: the browser would get the final page, and the
        // 302's Set-Cookie would be lost.
        return new Response("<html>studio</html>", { status: 200 });
      }),
    );
    return calls;
  }

  const handoff = () =>
    worker.fetch(
      new Request("https://console.freegamestore.online/auth/handoff?token=t", {
        headers: { host: "console.freegamestore.online" },
      }),
      { DB: db(), APPS: bucket() } as never,
      ctx,
    );

  it("passes the redirect and its Set-Cookie through to the browser", async () => {
    const calls = upstream("https://console.freegamestore.online/create");
    const res = await handoff();
    expect(calls[0]?.redirect).toBe("manual");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://console.freegamestore.online/create");
    expect(res.headers.get("set-cookie")).toContain("__Host-fgs_token=abc");
  });

  it("rewrites a Location on the upstream pages.dev origin back to the public host", async () => {
    upstream("https://freegamestore-publisher.pages.dev/create?x=1");
    const res = await handoff();
    expect(res.headers.get("location")).toBe("https://console.freegamestore.online/create?x=1");
  });
});
