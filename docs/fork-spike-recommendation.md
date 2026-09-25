# Fork spike recommendation (#45)

## Finding

The current Remix implementation in `apps/admin/src/publish.ts` enumerates source
blobs and applies `slice(0, MAX_FILES)` where `MAX_FILES = 40`. It therefore
copies only the first 40 eligible files under `web/src/` and `web/public/`.
This is the truncation bug tracked by #30 and #45: a source with 41 eligible
files produces a successful-looking Remix commit containing only 40 files.

The regression test in `apps/admin/src/publish.test.ts` reproduces this with 41
deterministic source files. It asserts that 40 source blobs are read, 40 paths
are committed, `web/src/file-41.ts` is absent, and the existing status detail
reports `copied 40 files ... (first 40 of 41)`. The current path is therefore a
silent truncation, not a whole-repository clone.

## Fork API spike evidence

`apps/admin/src/fork-spike.ts` is an isolated proof of concept. It is not
imported by `publish.ts` or any production provisioning route. The spike calls:

1. `POST /repos/{owner}/{repo}/forks` with `organization` and `name`.
2. `GET /repos/{source}/commits/{default_branch}`.
3. `GET /repos/{fork}/commits/{default_branch}`.

It treats a matching default-branch SHA as the completeness check. No contents,
tree, or blob endpoint is used, so there is no per-file enumeration or
`MAX_FILES` cap. The live API test also confirmed that a repository can be
forked into the target organisation (including this source's fork relationship)
and that the fork represents the complete Git history rather than a
file-by-file reconstruction. GitHub's fork network also permits a fork of a
fork; the completeness invariant remains the matching default-branch SHA, not
an enumerated file list.

On 2026-09-25, the disposable live test fork
`serge-ivo/fgs-fork-api-spike-45-20260925` to
`freegamestore-online/fgs-fork-api-spike-45-20260925` reported the same `main`
commit on both sides:

`91349f7c88a0f987e01c226f8232d609b429e60c`

Those test repositories are deleted as part of this issue's cleanup. The
deterministic spike tests retain the repository names and SHA as the durable
evidence, without depending on the disposable repositories continuing to exist.

| Concern | Remix (file-by-file) | Fork API (whole repository) |
| --- | --- | --- |
| Transfer mechanism | Reads and recreates each selected blob | GitHub forks repository Git data |
| Completeness | Silently limited to first 40 eligible files | Verified by matching source/fork commit SHA |
| File enumeration | Required | None |
| Atomic unit | A best-effort generated commit | GitHub-created complete repository fork |
| Current production status | Active | Spike only; not wired |

## Recommendation

### Phase 1 — immediate safety

Keep the existing Remix path temporarily, but reject or surface a clear error
when the eligible source file count is greater than or equal to `MAX_FILES`.
Never report a truncated copy as a successful Remix.

### Phase 2 — migrate

Use a fork-then-rename provisioning flow. Fork the source into the organisation,
rename it to the requested game id where required, and verify source and fork
default-branch SHAs before continuing with FreeGameStore-specific setup.

### Phase 3 — retire the blob copier

After Phase 2 has production monitoring and migration coverage, remove the
file-by-file Remix overlay and its `MAX_FILES` limit. Retain an explicit commit
SHA verification as the whole-repository completeness invariant.
