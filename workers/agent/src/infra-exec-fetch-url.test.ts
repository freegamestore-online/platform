// #461 — fetch_url's SSRF filter was a substring regex over the raw URL, so
// every non-dotted spelling of a loopback/private address passed, and public
// URLs whose PATH happened to contain "10." were refused.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { executeInfraTool, fetchUrlError } from "./infra-exec";

afterEach(() => vi.unstubAllGlobals());

const BLOCKED: [string, RegExp][] = [
  // loopback in every spelling the URL parser canonicalises
  ["https://127.0.0.1/", /IPv4/],
  ["https://2130706433/", /IPv4/], // decimal
  ["https://0x7f000001/", /IPv4/], // hex
  ["https://0177.0.0.1/", /IPv4/], // octal
  ["https://127.1/", /IPv4/], // shortened
  ["https://0x7f.1/", /IPv4/],
  ["https://[::1]/", /IPv6/],
  ["https://[::ffff:127.0.0.1]/", /IPv6/], // IPv4-mapped
  ["https://[::ffff:7f00:1]/", /IPv6/],
  ["https://[0:0:0:0:0:ffff:7f00:0001]/", /IPv6/],
  ["https://[64:ff9b::7f00:1]/", /IPv6/], // NAT64
  ["https://[2002:7f00:1::]/", /IPv6/], // 6to4
  // unspecified / private / link-local / CGNAT / multicast / reserved
  ["https://0.0.0.0/", /IPv4/],
  ["https://[::]/", /IPv6/],
  ["https://10.1.2.3/", /IPv4/],
  ["https://172.16.0.1/", /IPv4/],
  ["https://172.31.255.255/", /IPv4/],
  ["https://192.168.1.1/", /IPv4/],
  ["https://169.254.169.254/latest/meta-data/", /IPv4/],
  ["https://100.64.0.1/", /IPv4/],
  ["https://192.0.0.1/", /IPv4/],
  ["https://198.18.0.1/", /IPv4/],
  ["https://224.0.0.1/", /IPv4/],
  ["https://255.255.255.255/", /IPv4/],
  ["https://[fe80::1]/", /IPv6/],
  ["https://[fd12:3456::1]/", /IPv6/],
  ["https://[ff02::1]/", /IPv6/],
  ["https://[::ffff:10.0.0.1]/", /IPv6/],
  // internal names
  ["https://localhost/", /internal hostnames/],
  ["https://LOCALHOST./", /internal hostnames/],
  ["https://foo.localhost/", /internal hostnames/],
  ["https://metadata.google.internal/computeMetadata/v1/", /internal hostnames/],
  ["https://printer.local/", /internal hostnames/],
  // scheme / credentials / garbage
  ["http://example.com/", /https/],
  ["ftp://example.com/", /https/],
  ["https://user:pw@example.com/", /credentials/],
  ["https://user@example.com/", /credentials/],
  ["not a url", /valid URL/],
  ["", /required/],
];

const ALLOWED = [
  "https://example.com/",
  "https://example.com/10.5/", // "10." in the PATH is not an address
  "https://example.com/?next=http://localhost/", // ...nor in the query
  "https://127-0-0-1.example.com/", // a public name that merely looks like one
  "https://8.8.8.8/",
  "https://1.1.1.1/dns-query",
  "https://11.0.0.1/",
  "https://172.15.255.255/",
  "https://172.32.0.1/",
  "https://100.63.255.255/",
  "https://100.128.0.1/",
  "https://[2606:4700:4700::1111]/",
  "https://[2001:db8::1]/",
];

describe("fetchUrlError — literal-address SSRF guard", () => {
  it.each(BLOCKED)("refuses %s", (url, reason) => {
    expect(fetchUrlError(url)).toMatch(reason);
  });

  it.each(ALLOWED)("allows %s", (url) => {
    expect(fetchUrlError(url)).toBeNull();
  });

  it("rejects a non-string url", () => {
    expect(fetchUrlError(undefined)).toMatch(/required/);
    expect(fetchUrlError(42)).toMatch(/required/);
  });
});

describe("executeInfraTool fetch_url", () => {
  const ctx = {
    appId: null,
    files: new Map<string, string>(),
    env: { GITHUB_TOKEN: "t", CF_API_TOKEN: "c", CF_ACCOUNT_ID: "a" },
    config: getConfig("games"),
    onDeployStatus: vi.fn(),
    onAppBound: vi.fn(),
    onAppDeployed: vi.fn(),
  };
  const call = (url: unknown) => executeInfraTool({ id: "1", name: "fetch_url", input: { url } }, ctx);

  it("never issues the request for a loopback address in decimal, hex or IPv6 form", async () => {
    const fetch = vi.fn(async () => new Response("secret"));
    vi.stubGlobal("fetch", fetch);
    for (const url of ["https://2130706433/", "https://0x7f000001/", "https://[::ffff:127.0.0.1]/", "https://[::1]/"]) {
      const out = await call(url);
      expect(out, url).toMatch(/^Error: can only fetch public HTTPS URLs/);
      expect(out, url).not.toContain("secret");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  /** A fetch stub: DNS-over-HTTPS answers from `dns`, everything else from `pages`. */
  function stub(
    dns: Record<string, { A?: string[]; AAAA?: string[]; fail?: boolean }>,
    pages: Record<string, () => Response>,
  ) {
    const seen: { url: string; method?: string; redirect?: string }[] = [];
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      if (u.host === "cloudflare-dns.com") {
        const rec = dns[u.searchParams.get("name") ?? ""] ?? { A: ["93.184.216.34"] };
        if (rec.fail) return new Response("down", { status: 502 });
        const type = u.searchParams.get("type") as "A" | "AAAA";
        const data = rec[type] ?? [];
        return Response.json({ Status: 0, Answer: data.map((d) => ({ type: type === "A" ? 1 : 28, data: d })) });
      }
      seen.push({ url: input, method: init?.method, redirect: init?.redirect });
      return (pages[input] ?? (() => new Response("not found", { status: 404 })))();
    });
    vi.stubGlobal("fetch", fetch);
    return { fetch, seen };
  }
  const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });
  const callWith = (input: Record<string, unknown>) => executeInfraTool({ id: "1", name: "fetch_url", input }, ctx);

  it("fetches a public https URL even when its path contains an address-like string", async () => {
    const { seen } = stub({}, { "https://example.com/10.5/": () => new Response("hello", { status: 200, statusText: "OK" }) });
    const out = await call("https://example.com/10.5/");
    expect(out).toContain("200");
    expect(out).toContain("hello");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.redirect).toBe("manual");
  });

  describe("DNS resolution", () => {
    it.each([
      ["a private A record", { A: ["10.0.0.5"] }],
      ["a loopback A record", { A: ["127.0.0.1"] }],
      ["the metadata address", { A: ["169.254.169.254"] }],
      ["a private AAAA record", { AAAA: ["fd00::1"] }],
      ["a mapped-loopback AAAA record", { AAAA: ["::ffff:7f00:1"] }],
      ["one private answer among public ones", { A: ["93.184.216.34", "192.168.1.1"] }],
    ])("refuses a public-looking name with %s, and never fetches it", async (_n, rec) => {
      const { seen } = stub({ "sneaky.example.com": rec }, { "https://sneaky.example.com/": () => new Response("secret") });
      const out = await call("https://sneaky.example.com/");
      expect(out).toMatch(/resolves to a non-public address/);
      expect(out).not.toContain("secret");
      expect(seen).toHaveLength(0);
    });

    it("fails closed when the resolver cannot be reached", async () => {
      const { seen } = stub({ "example.com": { fail: true } }, {});
      expect(await call("https://example.com/")).toMatch(/could not verify/);
      expect(seen).toHaveLength(0);
    });

    it("does not resolve a literal address (fetchUrlError already judged it)", async () => {
      const { fetch } = stub({}, { "https://8.8.8.8/": () => new Response("dns") });
      expect(await call("https://8.8.8.8/")).toContain("dns");
      expect(fetch.mock.calls.every(([u]) => !String(u).includes("cloudflare-dns.com"))).toBe(true);
    });
  });

  describe("redirects", () => {
    it("follows a redirect to another public URL", async () => {
      const { seen } = stub({}, {
        "https://example.com/a": redirect("/b"),
        "https://example.com/b": () => new Response("landed", { status: 200 }),
      });
      expect(await call("https://example.com/a")).toContain("landed");
      expect(seen.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    });

    it.each([
      ["the metadata address", "https://169.254.169.254/latest/meta-data/"],
      ["a loopback literal", "https://[::1]/admin"],
      ["an internal name", "https://metadata.google.internal/"],
      ["plain http", "http://example.com/"],
      ["a name that resolves privately", "https://rebind.example.net/"],
    ])("refuses a redirect to %s", async (_n, to) => {
      const { seen } = stub({ "rebind.example.net": { A: ["10.1.1.1"] } }, {
        "https://example.com/": redirect(to),
        [to]: () => new Response("secret"),
      });
      const out = await call("https://example.com/");
      expect(out).toMatch(/a redirect led somewhere that can't be fetched/);
      expect(out).not.toContain("secret");
      expect(seen.map((r) => r.url)).toEqual(["https://example.com/"]);
    });

    it("stops after three redirects", async () => {
      const { seen } = stub({}, {
        "https://example.com/0": redirect("/1"),
        "https://example.com/1": redirect("/2"),
        "https://example.com/2": redirect("/3"),
        "https://example.com/3": redirect("/4"),
        "https://example.com/4": () => new Response("too far"),
      });
      const out = await call("https://example.com/0");
      expect(out).toMatch(/too many redirects/);
      expect(seen).toHaveLength(4);
    });

    it("allows exactly three hops", async () => {
      stub({}, {
        "https://example.com/0": redirect("/1"),
        "https://example.com/1": redirect("/2"),
        "https://example.com/2": redirect("/3"),
        "https://example.com/3": () => new Response("ok", { status: 200 }),
      });
      expect(await call("https://example.com/0")).toContain("ok");
    });
  });

  describe("method", () => {
    it.each(["POST", "PUT", "DELETE", "PATCH", "CONNECT"])("refuses %s without making any request", async (method) => {
      const { fetch } = stub({}, {});
      expect(await callWith({ url: "https://example.com/", method })).toMatch(/only supports the GET and HEAD/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("allows GET and HEAD in any case, defaulting to GET", async () => {
      const { seen } = stub({}, { "https://example.com/": () => new Response("x") });
      await callWith({ url: "https://example.com/" });
      await callWith({ url: "https://example.com/", method: "head" });
      await callWith({ url: "https://example.com/", method: "GET" });
      expect(seen.map((r) => r.method)).toEqual(["GET", "HEAD", "GET"]);
    });

    it("keeps the method across redirects", async () => {
      const { seen } = stub({}, {
        "https://example.com/a": redirect("/b", 307),
        "https://example.com/b": () => new Response("x"),
      });
      await callWith({ url: "https://example.com/a", method: "HEAD" });
      expect(seen.map((r) => r.method)).toEqual(["HEAD", "HEAD"]);
    });
  });
});
