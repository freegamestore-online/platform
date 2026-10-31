# Admin before/after screenshots (#395)

Each image tiles one admin screen four ways: columns are **before | after**, rows are
**light | dark**. The "before" build is `d760cc8`, the "after" build is `22bc08f`. Both were
rendered at 1280x900 with the same mocked `/api/*` data and a fixed clock, so any difference
comes from the styling migration. The mock data is invented; no production data is shown.

Screens: sign-in, overview, games, game detail (live, failed, fork), errors, ops, users,
user detail (two), grants, CI report, sessions, session view (two), provision, usage.
