import { resolveCreatorUser, type SessionEnv } from "./_auth";
import { listUserGames, type GameRepo } from "./_games";

interface Env extends SessionEnv {
  GITHUB_TOKEN: string;
  CREATORS: KVNamespace;
  MAX_APPS_PER_USER: string;
}

interface CreatorInfo {
  github: string;
  games: GameRepo[];
  banned: boolean;
  maxGames: number;
  remaining: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // Accept both the legacy publisher KV session and the canonical fgs_token JWT
  // (auth consolidation). The old code only read the KV session, so a user who
  // signed in through the auth worker (the normal path now) had a valid identity
  // for /auth/me but got 401 here — surfacing as "Sign in to publish."
  const cu = await resolveCreatorUser(context.request, context.env);
  if (!cu) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = cu.github;

  // Registry-primary ownership (see _games.ts): a member sees the admin-all view;
  // everyone else sees the games they own by registry `creatorGithub` — which
  // shows a game the instant it's provisioned, even before an outside-collaborator
  // invite is accepted. `remaining` is computed off the same `owned` list that
  // create.ts gates on, so the slot count and the create gate never disagree.
  const { owned } = await listUserGames(context.env, user);

  // KV for ban status.
  const raw = await context.env.CREATORS.get(user);
  const kvRecord = raw ? JSON.parse(raw) : null;
  const banned = kvRecord?.banned ?? false;
  const maxGames = parseInt(context.env.MAX_APPS_PER_USER || "5");

  const creator: CreatorInfo = {
    github: user,
    games: owned,
    banned,
    maxGames,
    remaining: Math.max(0, maxGames - owned.length),
  };

  return new Response(JSON.stringify({ user, creator }), {
    headers: { "Content-Type": "application/json" },
  });
};
