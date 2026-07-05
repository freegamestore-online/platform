# Build-safety recommendations for the FGS VibeCode agent

**Status:** #1 + #2 IMPLEMENTED 2026-07-05 (see below); #3 deferred.
**Author:** generated during incident review, 2026-07-05.
**Trigger:** `climberadventure` shipped a broken build to `main` that failed CI
and silently served a stale version for ~30 min.

## Implemented

- **#1 — in-worker build-sanity gate (`src/build-sanity.ts`).** `checkBuildSanity()`
  runs BLOCKING before `deploy`/`push_update` in `infra-exec.ts`. It scans every
  compiled source (`web/src/**.{ts,tsx,js,jsx}`) on a comment/string/template/regex
  -stripped skeleton and blocks on: **duplicate top-level declarations** (the exact
  `climberadventure` failure), multiple `export default`, and unbalanced braces/
  parens/brackets (truncated files). On a hit the deploy is refused and the precise
  problem is returned to the agent as the tool result, so it self-corrects in-session
  instead of failing CI and serving a stale build. Covered by `build-sanity.test.ts`
  (17 cases: regex/JSX/template-literal false-positive guards + the incident pattern).
- **#2 — verify-before-ship prompt** (`template.ts`, game + app prompts): explicit
  "write_file OVERWRITES the whole file — never append a second copy of a function"
  rule, under the typecheck-errors guidance.

#3 (poll deploy status after push → surface CI failure → notify creator) is still open.

---

## What happened

The VibeCode agent generated `web/src/App.tsx` for `climberadventure` with an
entire block of drawing helpers declared **twice**:

- `getPlatformColor`
- `drawMountainBg`
- `drawMountainSilhouette`
- `lerp`

The second copy (≈66 lines) was an exact duplicate of the first. `vite build`
(rollup) rejected it:

```
The symbol "drawMountainBg" has already been declared
The symbol "drawMountainSilhouette" has already been declared
The symbol "lerp" has already been declared
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @climberadventure/web@ build: `vite build`
```

Both CI jobs (**Deploy to R2** and **Platform Compliance**) failed, so R2 was
never updated. The last *good* deploy — the untouched template scaffold, not the
real game — kept being served. From the outside the game looked "published and
working"; it was actually stale and the real game had never shipped.

## Why it's possible

Two independent gaps, both in the platform, not the game:

1. **No build gate before push.** The agent's `write_file` tool is a full-content
   overwrite (`src/tools.ts:187` — `files.set(path, content)`). The model
   regenerated the whole file and re-emitted the helper block without deleting
   the original — a classic "append instead of replace" LLM edit failure. Nothing
   between the model's output and `git push` validates that the code even parses,
   let alone builds. The only build happens on GitHub Actions **after** the push.

2. **Silent deploy failure.** When CI fails, nothing tells the creator. The build
   error is visible only if someone opens the Actions tab. A broken push looks
   identical to a healthy one from the store UI, because the host keeps serving
   the last good R2 artifact.

The agent runs as a Cloudflare Worker, so it **cannot** run `pnpm build`
(no Node, no filesystem). That constraint shapes the fix: catch what we can
statically in-worker, and make the async CI failure loud.

---

## Recommendations

### 1. Add a static "build sanity" gate in-worker (highest value, lowest cost)

There is already an in-worker static checker running over the virtual filesystem:
`runComplianceCheck()` in `src/tools.ts:238`. Extend the same pattern with a
build-sanity pass that runs **automatically before `deploy` / `push_update`**,
not just when the model chooses to call it.

Cheapest high-value check — **duplicate top-level declarations** — would have
caught this exact bug:

- For each `web/src/**/*.ts{,x}`, scan for repeated top-level
  `function <name>`, `const <name> =`, `class <name>`, `export function <name>`
  at column 0 (module scope). Any name declared twice at top level → **fail**.

Complementary cheap static checks (all regex/parse-level, no toolchain needed):

- **Balanced braces / parens** per file (catches truncated generations).
- **No duplicate `import` of the same binding.**
- Optionally parse with a lightweight WASM/JS parser (e.g. `es-module-lexer`,
  which already runs in Workers) to catch syntax errors before push.

Make this gate **blocking**: `deploy` and `push_update` should refuse and return
the failures to the model so it self-corrects in the same session, exactly like a
failed test would.

### 2. Make the model verify before it ships

Prompt/flow change, no infra:

- After the final `write_file` and before `deploy`, require the agent to call the
  (now build-aware) `run_compliance_check` and only proceed on PASS.
- Add an explicit instruction: *"When editing an existing file, replace the whole
  file with the corrected content. Never emit a second copy of a function,
  component, or import that already exists."*

### 3. Close the silent-failure loop (defense in depth)

Even with 1 & 2, an async CI failure should never be silent:

- The agent already has `check_deploy_status` / `get_ci_results` /
  `get_build_logs` tools. After a push, **poll deploy status** and, on failure,
  surface the build log back into the session so the agent (or user) sees it
  immediately instead of after someone notices a stale site.
- Consider a creator-facing notification on failed deploy (the Web Push path in
  `src/push.ts` already exists) so a broken build pings the owner.
- Platform-side: a reconcile/canary check that flags "repo HEAD newer than last
  successful R2 deploy" as drift — the same stale-serving symptom this incident
  produced.

---

## Priority

| # | Change | Effort | Prevents recurrence? |
|---|--------|--------|----------------------|
| 1 | In-worker duplicate-declaration + syntax gate, blocking on deploy | Low | **Yes — directly** |
| 2 | Verify-before-ship prompt + mandatory pre-deploy check | Low | Yes — reinforces #1 |
| 3 | Post-push status poll + failure notification | Medium | No, but kills the silent-stale window |

Start with **#1** — it's a few dozen lines next to an existing static checker and
would have turned this incident into an in-session self-correction the user never
had to see.

## Scope note

This is the FGS agent, but FAS/PAS/FWS/PWS agents share the same
generate-then-push-then-CI-builds shape. If #1 lands here and proves out, port the
same in-worker build-sanity gate to the sibling store agents (vendored, per
platform convention — copy, don't depend).
