# Registry, ownership, and remix-attribution contract — v1

This directory is the versioned, runtime-neutral contract used by the separately
deployed FGS packages. The JSON files are fixtures, not production dependencies.
Each package runs its own adapter tests against them.

## Shared rules

### Game IDs

A provisionable game ID is 3–58 characters, matches
`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, and therefore contains only lowercase
letters, digits, and dashes without a leading or trailing dash. IDs beginning
`free`, `pro`, or `template-game-` are reserved. The explicit reserved IDs are
`freegamestore`, `submissions`, all current `template-game-*` repositories,
`brand`, `ops`, and `sdk`.

### Registry reads

A registry reader returns exactly one of:

- `available`: a valid `games` array was read;
- `missing`: both authoritative and fallback reads confirmed the file is absent;
- `unavailable`: an auth/network/server/parse failure prevented a trustworthy
  result.

`unavailable` must never be converted to an empty array, a missing game, or an
ownership denial. Readers may prefer authenticated GitHub Contents and then use
the raw CDN fallback. Mutation paths require a Contents response with a SHA and
must fail safely when one cannot be obtained.

### Ownership facts

The shared evaluator returns facts, rather than one overloaded `owns` boolean:
`isCreator` is a case-insensitive `creatorGithub` match; `isOrgMember` comes
from GitHub membership; `isLegacyAcceptedCollaborator` is only evaluated for a
registry entry with no `creatorGithub`. Operations map those facts to local
authority according to `operation-matrix.json`.

### Remix attribution

A rich immutable snapshot is `{ id, name, creatorGithub, forkedAt }`, with a
canonical valid ID, non-empty name, valid GitHub login, and parseable timestamp.
Legacy string lineage is retained. It is upgraded to rich attribution only when
the source registry entry supplies a valid ID, non-empty name, valid creator,
and the descendant supplies a parseable historical timestamp. Missing facts
preserve the string; invalid values are omitted. A deleted source retains rich
credit but must not produce a live-source link.

## Package-local responsibilities

Production transport remains local: Cloudflare bindings, OAuth/session parsing,
GitHub retry and headers, raw-vs-Contents fetching, D1 mutation, repository
provisioning, MCP tools, and browser rendering. Admin exclusively owns registry
writes, host-route mutation, collaborator invites, and generated Remix shell
injection. Console owns HTTP/UI projections; agent owns session gating; MCP owns
OAuth/tool authorization. Shared fixtures prevent semantic drift without adding
a cross-runtime deployment dependency.
