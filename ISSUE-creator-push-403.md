# BUG: game creators get 403 pushing to their own repo (no collaborator added)

**Severity:** high — every new creator is blocked from pushing and has to ask an
org owner for manual access. (Reported by Dawson re: `freegamestore-online/uno`.)

## Symptom
A creator publishes a game, then `git push` to `freegamestore-online/<game>`
fails with **403**. They ask an owner to "grant access," which shouldn't be
needed — provisioning is supposed to add them as a collaborator.

## Evidence (`uno`, 2026-06-04)
- `GET /repos/freegamestore-online/uno/collaborators?affiliation=direct` → **[]**
- `GET /repos/freegamestore-online/uno/invitations` → **[]** (no pending invite)
- Registry entry for `uno` has `"developer": "FreeGameStore"` and **no
  `creatorGithub`** field.

So the creator was never added (not even an invitation was sent).

## Root cause
The provision flow *has* the right step but it's never reached:

1. `src/index.ts`, the `POST /api/provision` handler, authenticates the caller
   and derives their GitHub login:
   ```ts
   const login = await verifySession(authHeader.slice(7), env.SESSION_SIGNING_KEY);
   ...
   const body = await request.json() as any;
   const result = await handlePublish(body, env as any);   // ← login is DROPPED
   ```
   It passes the **raw body** to `handlePublish` and never injects `login`. So
   `req.creatorGithub` is only set if the *client* (fgs CLI / VibeCode agent /
   form) happened to include it — and these games don't.

2. `src/publish.ts` "Step 1b: Add creator as collaborator with push access"
   (~line 189) is gated on that value:
   ```ts
   if (req.creatorGithub) {            // ← undefined → whole step skipped
     ghApi(`/repos/${config.org}/${id}/collaborators/${req.creatorGithub}`, "PUT", { permission: "push" })
   }
   ```
   With `creatorGithub` undefined, no collaborator/invitation is ever created → 403.

(FAS does NOT have this bug: its backend `/v1/publish` sets
`creatorGithub: user.githubLogin` from the verified session before calling the
admin. FGS's admin should do the same.)

## Fix
1. **Source `creatorGithub` from the verified session, not the client body.**
   In the `/api/provision` handler (`src/index.ts`):
   ```ts
   const result = await handlePublish({ ...body, creatorGithub: body.creatorGithub || login }, env as any);
   ```
   This makes every provision add the authenticated creator as a push
   collaborator, and it can't be spoofed (it's the verified login).
2. **Record `creatorGithub` in the registry entry** (it's missing on `uno`).
   This is also the ownership record the MCP's `ownsGame`/`update_files` and
   `list_games` rely on (see `freegamestore-online/mcp`), so games published
   without it can't be managed by their creator via MCP either.

## GitHub invitation caveat (don't miss this)
Adding an **outside** collaborator (creator not in the `freegamestore-online`
org) creates a **pending invitation** that the user must **accept** (via the
GitHub email/notification) before they can push — so they'll still get 403
until they accept. Two options:
- Surface "check your email / accept the GitHub invite to
  `freegamestore-online/<game>`" in the publish output and docs, **or**
- Add creators to the org (org members get push immediately, no invite step).

The collaborator step already treats HTTP 201 (invite created) as success, but
the creator isn't told to accept it — close that UX gap.

## Backfill (existing games are already broken)
Games provisioned before the fix have no collaborator. Backfill: for each game,
add its creator as a push collaborator and set `creatorGithub` in the registry.
**For `uno` specifically:** get Dawson's GitHub login and run
`PUT /repos/freegamestore-online/uno/collaborators/<dawson-login>` with
`{ "permission": "push" }`, then have him **accept the invite**. (An org owner /
the admin worker's `GH_*` token can do this; `GH_ADMIN_TOKEN` in Doppler
`fgs/prd` has `admin:org`+`repo`.)

## Files
- `src/index.ts` — `/api/provision` handler (inject `creatorGithub = login`).
- `src/publish.ts` — Step 1b (~line 189), already correct once `creatorGithub` is set.
- Registry write — include `creatorGithub`.
