# Moved

The game-creation design is cross-repo (admin owns provisioning, agent owns the
VibeCode session, publisher is the UX surface, `template-game-canvas` is the
scaffold), so its home is the platform repo:

**`platform/docs/unified-game-creation.md`** in `freegamestore-online/platform`.

This flow was unified in 2026-07: VibeCode is the single create → edit entry,
`template-game-canvas` is the one template, and admin's `/api/provision` is the
one provision path.
