export interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  /** Token with Analytics Engine read scope for the per-game stats (#354). Optional:
   *  the stats endpoints answer 503 until it is set via `wrangler secret put`. */
  CF_ANALYTICS_API_TOKEN?: string;
  GITHUB_TOKEN: string;
  /** This admin's OWN HS256 signing key — it mints + verifies its own
   *  sessions via /v1/auth/exchange (not shared with FAS). */
  SESSION_SIGNING_KEY: string;
  /** FGS-owned `freegamestore` D1 — fgs/host reads from this same table. */
  DB: D1Database;
  /** Service binding to the auth worker (verify fgs_token via /me). */
  AUTH: Fetcher;
  /** Service binding to the agent worker — used to proxy complimentary-grant
   *  admin calls to the vault DB it owns (authenticated by INTERNAL_TOKEN). */
  AGENT?: Fetcher;
  /** Workers Static Assets — the built React admin app in public/. */
  ASSETS?: Fetcher;
  /** Shared secret for trusted worker-to-worker provision calls (the agent has
   *  no user fgs_token at deploy time). Presented as X-Internal-Token. */
  INTERNAL_TOKEN?: string;
  /** KV for the CI test report (#24). OPTIONAL — the namespace does not exist
   *  yet, so the endpoints answer 503 until it is created and bound. Declared
   *  optional deliberately: a `[[kv_namespaces]]` entry pointing at a
   *  non-existent id makes `wrangler deploy` FAIL, which would break every
   *  admin deploy rather than just this feature. */
  CI_KV?: KVNamespace;
  /** Shared secret CI presents as X-CI-Token when uploading a report (#24). */
  CI_TOKEN?: string;
  /** Cloudflare zone id for freegamestore.online (#23 item 6). Only `zone_name`
   *  exists in config today and the Analytics GraphQL API keys on `zoneTag`, so
   *  this must be supplied before the traffic widget can resolve. */
  CF_ZONE_ID?: string;
  /** Comma-separated allowlist of admin emails. The console UI + every
   *  observability endpoint are restricted to these (verified Google emails
   *  resolved via the auth worker's /me). Falls back to the sole owner. */
  ADMIN_EMAILS?: string;
}
