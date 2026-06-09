---
phase: 02-high-speed-ingestion-api
plan: 01
subsystem: api
tags: [fastify, vitest, zod, typescript, env-validation, webhook-secrets]

# Dependency graph
requires:
  - phase: 01-foundation-local-infra
    provides: workspace packages (@omnisync/config, @omnisync/db, @omnisync/queue, @omnisync/types), tsconfig.base.json, pnpm workspace
provides:
  - Extended env schema with four required WEBHOOK_SECRET_* vars (fail-fast on missing)
  - Fastify 5.x + @fastify/sensible + @fastify/helmet + fastify-raw-body installed in apps/api
  - Vitest 4.x + @vitest/coverage-v8 installed in apps/api with green run on empty test set
  - vitest.config.ts with setupFiles + tests/ include glob
  - vitest.setup.ts with all required env var stubs (prevents process.exit(1) in tests)
  - FastifyRequest.rawBody?: Buffer type augmentation in apps/api/src/types/fastify.d.ts
affects:
  - 02-02 (pure-function tests rely on vitest scaffold and env stubs)
  - 02-03 (route tests rely on fastify deps, rawBody type, env stubs)

# Tech tracking
tech-stack:
  added:
    - fastify@5.8.5
    - "@fastify/sensible@6.0.4"
    - "@fastify/helmet@13.0.2"
    - fastify-raw-body@5.0.0
    - vitest@4.1.8
    - "@vitest/coverage-v8@4.1.8"
  patterns:
    - "Env stubs in vitest.setup.ts set before any @omnisync/config import to prevent IIFE process.exit(1)"
    - "passWithNoTests: true in vitest config for clean runs on empty test directory"
    - "FastifyRequest module augmentation via declare module 'fastify' in src/types/"

key-files:
  created:
    - apps/api/vitest.config.ts
    - apps/api/vitest.setup.ts
    - apps/api/src/types/fastify.d.ts
  modified:
    - packages/config/src/env.ts
    - apps/api/package.json
    - .env.example
    - pnpm-lock.yaml

key-decisions:
  - "Added passWithNoTests: true to vitest config so vitest run exits 0 on empty test directory (vitest v4 exits 1 by default)"
  - "Workspace dep @omnisync/queue pinned to workspace:* (not workspace:^) for consistency with other workspace deps"

patterns-established:
  - "Pattern: vitest.setup.ts stubs all env vars before test execution, making @omnisync/config safe to import in tests"
  - "Pattern: FastifyRequest augmentation lives in src/types/fastify.d.ts — included in build, provides global rawBody?: Buffer type"

requirements-completed: [IDM-01]

# Metrics
duration: 9min
completed: 2026-06-09
---

# Phase 2 Plan 01: Env Schema Extension + API Test Scaffold Summary

**Fastify 5.x + Vitest 4.x test scaffold installed in apps/api with four required WEBHOOK_SECRET_* env vars, env stubs to prevent exit(1) in tests, and FastifyRequest.rawBody Buffer augmentation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-09T12:13:14Z
- **Completed:** 2026-06-09T12:22:20Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Extended @omnisync/config Env schema with four required WEBHOOK_SECRET_* vars (fail-fast D-01 behavior preserved, z.treeifyError unchanged)
- Installed Fastify 5.8.5 + sensible + helmet + fastify-raw-body as runtime deps and vitest@4.1.8 + coverage-v8 as devDeps in apps/api
- Created vitest.config.ts, vitest.setup.ts (with all env stubs), and src/types/fastify.d.ts (rawBody augmentation) — vitest run exits 0 clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend @omnisync/config env schema** - `f6efa04` (feat)
2. **Task 2: Install Fastify + Vitest dependencies** - `f1f3711` (chore)
3. **Task 3: Create vitest config, env stubs, rawBody type** - `eec9b56` (feat)

**Plan metadata:** _(docs commit to follow)_

## Files Created/Modified

- `packages/config/src/env.ts` - Added four WEBHOOK_SECRET_* required fields to Env z.object
- `.env.example` - Appended four WEBHOOK_SECRET_* example entries
- `apps/api/package.json` - Added fastify + plugins, vitest + coverage-v8, workspace queue/types deps, test script
- `pnpm-lock.yaml` - Updated lockfile for new deps
- `apps/api/vitest.config.ts` - Vitest config with setupFiles, node env, tests/ include, passWithNoTests
- `apps/api/vitest.setup.ts` - Env var stubs for all seven required keys (DATABASE_URL, DIRECT_URL, REDIS_URL + 4 webhook secrets)
- `apps/api/src/types/fastify.d.ts` - Module augmentation: FastifyRequest.rawBody?: Buffer

## Decisions Made

- **passWithNoTests: true** added to vitest config: vitest v4 exits with code 1 when no test files exist by default; the plan requires exit 0. Adding this to the config (rather than the CLI script) is the idiomatic solution and avoids changing the `"test": "vitest run"` script.
- **workspace:* for @omnisync/queue**: pnpm defaulted to `workspace:^`; corrected to `workspace:*` to match all other workspace deps and the plan spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added passWithNoTests: true to vitest config**
- **Found during:** Task 3 (Create vitest config, env stubs, rawBody type augmentation)
- **Issue:** Plan acceptance criteria requires `vitest run` to exit 0 on empty test set; vitest v4 exits 1 by default when no test files match the include glob
- **Fix:** Added `passWithNoTests: true` to the `test` object in vitest.config.ts
- **Files modified:** apps/api/vitest.config.ts
- **Verification:** `pnpm --filter @omnisync/api exec vitest run` exits 0 with "No test files found, exiting with code 0"
- **Committed in:** eec9b56 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - vitest v4 behavior change from plan assumption)
**Impact on plan:** Essential for acceptance criteria. No scope creep.

## Issues Encountered

- Worktree had only the Initial commit (README.md only) — needed to merge master into the worktree branch before any project files were available. This is expected worktree setup behavior.

## Known Stubs

None — this plan creates infrastructure only (config, test scaffold, type declarations). No UI rendering or data flow stubs.

## User Setup Required

None — no external service configuration required. All new env vars are documented in .env.example.

## Next Phase Readiness

- Plan 02-02 can import @omnisync/config in tests without triggering process.exit(1) (env stubs active)
- Plan 02-03 can use FastifyRequest.rawBody type in HMAC verification code
- Fastify deps installed and resolvable in apps/api
- Vitest binary available in apps/api

---
*Phase: 02-high-speed-ingestion-api*
*Completed: 2026-06-09*
