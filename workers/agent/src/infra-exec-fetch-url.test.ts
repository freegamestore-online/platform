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

  it("fetches a public https URL even when its path contains an address-like string", async () => {
    const fetch = vi.fn(async () => new Response("hello", { status: 200, statusText: "OK" }));
    vi.stubGlobal("fetch", fetch);
    const out = await call("https://example.com/10.5/");
    expect(out).toContain("200");
    expect(out).toContain("hello");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
