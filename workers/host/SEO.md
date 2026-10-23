# Hosted game discovery

The host enriches `/` and `/index.html` for a routed game that appears in the
public `https://freegamestore.online/registry.json`. It uses that listing's name
and description, never source-repository text or player data. Missing status is
legacy live, as documented in admin's `readGameStatus`; explicit `live`,
`published` and `approved` are public. Other explicit values are excluded from
discovery, including private/unpublished. Unlike the admin UI's typo-tolerant
reader, discovery fails closed for unknown values. No new visibility field is
inferred from a game's npm `private` flag.

The registry entry's URL must match the resolved route's HTTPS origin. Without
both a name and a description the host preserves the original HTML. Otherwise
HTMLRewriter replaces canonical/title/description and social tags, preserving
the game body and scripts. Canonical URLs always point to the root, without
tracking parameters. Range requests and SPA paths retain existing serving
behavior. Transformed roots have no R2 ETag and use no-store so validators for
the original artifact cannot hide a metadata update.

Public routed games with a built index receive a one-root sitemap and robots
Allow rule plus sitemap URL. Other existing routes receive robots Disallow and
a sitemap 404. Unknown routes keep their 404s. These are crawl preferences,
not authentication or access controls; no existing private asset protections
are weakened. The public registry is cached in-isolate for at most 60 seconds;
fetch errors fail closed for discovery and do not stop gameplay.

Meaningful public descriptions/instructions remain on the storefront's static
game detail pages. No splash screen or gameplay interstitial is introduced.
Bundled new-game HTML carries SEO defaults; the host applies the same approved
metadata contract to games created from the external template repositories.
Source compliance warns on missing defaults without blocking host-managed games.

After the existing automated host deployment succeeds, run the read-only full
registry audit from the repository root:

```sh
node scripts/check-game-seo.mjs
```

Record the complete result, registry count, deployed SHA and remote workflow URL
on #383. A local test run or pre-rollout audit is not rollout evidence. Never
deploy production locally or request plaintext credentials to bypass an outage.
