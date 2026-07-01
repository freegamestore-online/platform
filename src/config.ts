/** Store configuration — one codebase, multiple deployments. */

export interface StoreConfig {
  store: "apps" | "games";
  org: string;
  domain: string;
  noun: string;
  Noun: string;
  nounPlural: string;
  storeRepo: string;
  storeName: string;
  agentName: string;
  accentColor: string;
  categories: string;
  auditParam: string;
  cfProjectName: (id: string) => string;
  /** Path B hosting: register a D1 host route + registry entry via admin and
   *  serve from R2 (per-repo deploy.yml uploads on push), instead of creating a
   *  per-app CF Pages project. When false/undefined the legacy CF Pages flow is
   *  used. FGS games are on Path B; FAS apps stay on CF Pages for now. */
  pathB?: boolean;
  /** R2 bucket + key prefix the per-repo deploy.yml syncs build output to.
   *  host route r2_prefix = `<r2Prefix>/<slug>`; upload target
   *  = `s3://<r2Bucket>/<r2Prefix>/<slug>/`. Only meaningful when pathB. */
  r2Bucket?: string;
  r2Prefix?: string;
}

const CONFIGS: Record<string, StoreConfig> = {
  apps: {
    store: "apps",
    org: "freeappstore-online",
    domain: "freeappstore.online",
    noun: "app",
    Noun: "App",
    nounPlural: "apps",
    storeRepo: "freeappstore",
    storeName: "FreeAppStore",
    agentName: "freeappstore-agent",
    accentColor: "#2563eb",
    categories: "utilities, productivity, learning, lifestyle, finance, health, creative, social",
    auditParam: "app",
    cfProjectName: (id: string) => `free${id.replace(/-/g, "")}app`,
  },
  games: {
    store: "games",
    org: "freegamestore-online",
    domain: "freegamestore.online",
    noun: "game",
    Noun: "Game",
    nounPlural: "games",
    storeRepo: "freegamestore",
    storeName: "FreeGameStore",
    agentName: "freegamestore-agent",
    accentColor: "#10b981",
    categories: "arcade, puzzle, strategy, racing, sports, cards, board, rpg, action, casual",
    auditParam: "game",
    cfProjectName: (id: string) => id,
    pathB: true,
    r2Bucket: "fgs-games",
    r2Prefix: "games",
  },
};

export function getConfig(store: string): StoreConfig {
  return CONFIGS[store] || CONFIGS.apps;
}
