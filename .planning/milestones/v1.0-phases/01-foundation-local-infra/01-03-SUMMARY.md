---
phase: 01-foundation-local-infra
plan: "03"
subsystem: infra
tags: [zod, bullmq, ioredis, redis, env-validation, queue]

# Dependency graph
requires:
  - phase: 01-foundation-local-infra/01-01
    provides: pnpm workspace, Turborepo, base tsconfig, ESM monorepo skeleton

provides:
  - "@omnisync/config: Zod v4 validated fail-fast env loader (DATABASE_URL, DIRECT_URL, REDIS_URL)"
  - "@omnisync/queue: BullMQ 5.77 'events' queue over ioredis with locked interval config (QUE-01)"
  - ".env.example: documented env contract for all apps"

affects:
  - 01-04-PLAN (app stubs depend on config + queue packages)
  - 02-ingestion-api (ingestion API uses both @omnisync/config and @omnisync/queue)
  - 03-worker (worker uses @omnisync/queue connection and queueOptions)

# Tech tracking
tech-stack:
  added:
    - "zod@4.4.3 (zod/v4 subpath import)"
    - "bullmq@5.77.7"
    - "ioredis@5.10.1 (pinned to match BullMQ bundled version)"
    - "@types/node (devDep for both packages)"
  patterns:
    - "Zod v4 safeParse + z.treeifyError for fail-fast env validation"
    - "ESM NodeNext package with explicit .js extensions in source imports"
    - "BullMQ connection export pattern: ioredis Redis instance + Queue"
    - "Locked interval constants (guardInterval/stalledInterval/drainDelay) as const for free-tier Upstash viability"

key-files:
  created:
    - packages/config/src/env.ts
    - packages/config/src/index.ts
    - packages/config/package.json
    - packages/config/tsconfig.json
    - packages/queue/src/index.ts
    - packages/queue/package.json
    - packages/queue/tsconfig.json
    - .env.example
  modified:
    - pnpm-lock.yaml

key-decisions:
  - "ioredis pinned to 5.10.1 in @omnisync/queue to match BullMQ's bundled version — prevents TypeScript type conflict between two different ioredis versions in pnpm resolution"
  - "Used { Redis } named export from ioredis instead of default import — required for ESM + NodeNext + verbatimModuleSyntax"
  - "Added @types/node to both packages' devDeps — base tsconfig lib ES2022 alone does not expose process/console globals for TypeScript"
  - "z.treeifyError verified as the correct Zod v4 error formatting API (not fromError or formatError from v3)"

patterns-established:
  - "Package tsconfig extends ../../tsconfig.base.json and overrides outDir/rootDir/types for node globals"
  - "ESM package exports pattern: exports['.'].types + exports['.'].default both pointing to dist/"

requirements-completed:
  - QUE-01

# Metrics
duration: 21min
completed: "2026-06-02"
---

# Phase 1 Plan 03: Config and Queue Packages Summary

**Zod v4 fail-fast env loader (@omnisync/config) and BullMQ 'events' queue with locked Upstash-safe interval config (@omnisync/queue, QUE-01)**

## Performance

- **Duration:** 21 min
- **Started:** 2026-06-02T04:23:00Z
- **Completed:** 2026-06-02T04:44:13Z
- **Tasks:** 2
- **Files modified:** 8 created + pnpm-lock.yaml

## Accomplishments

- `@omnisync/config` exports a Zod v4 validated `env` object that calls `process.exit(1)` on missing/invalid vars, using `z.treeifyError` for structured error output
- `.env.example` documents `NODE_ENV`, `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` with local docker Postgres + Redis defaults
- `@omnisync/queue` establishes the shared BullMQ `events` queue with ioredis connection (`maxRetriesPerRequest: null`) and exports locked interval constants: `guardInterval: 30000`, `stalledInterval: 300000`, `drainDelay: 30` (QUE-01)
- Both packages build cleanly with `tsc` under NodeNext/ESM module resolution

## Task Commits

Each task was committed atomically:

1. **Task 1: @omnisync/config — Zod-validated fail-fast env loader + .env.example** - `f8259ff` (feat)
2. **Task 2: @omnisync/queue — BullMQ events queue (QUE-01)** - `f7adb99` (feat)

## Files Created/Modified

- `packages/config/src/env.ts` — Zod v4 schema (safeParse + z.treeifyError + process.exit), exports `env`
- `packages/config/src/index.ts` — re-export barrel (`export * from "./env.js"`)
- `packages/config/package.json` — `@omnisync/config`, ESM, zod@^4.4.3, @types/node devDep
- `packages/config/tsconfig.json` — extends base, types: ["node"]
- `packages/queue/src/index.ts` — ioredis Redis connection + BullMQ Queue 'events' + locked queueOptions
- `packages/queue/package.json` — `@omnisync/queue`, ESM, bullmq@^5.77.0, ioredis@5.10.1 (pinned), @types/node
- `packages/queue/tsconfig.json` — extends base, types: ["node"]
- `.env.example` — env contract documentation (committed to repo)
- `pnpm-lock.yaml` — updated with zod, bullmq, ioredis, @types/node dependencies

## Decisions Made

- **ioredis 5.10.1 pinned** in `@omnisync/queue`: BullMQ 5.77.7 bundles its own ioredis 5.10.1 internally. When the workspace installs a different version (5.11.0), TypeScript sees two incompatible `AbstractConnector` definitions causing a type error in `{ connection }` passed to `new Queue()`. Pinning to 5.10.1 resolves the conflict.
- **Named `{ Redis }` import** from ioredis instead of default `IORedis`: With `verbatimModuleSyntax` + `NodeNext`, the default export from CJS ioredis module lacks construct signatures in TypeScript. The named `Redis` export works correctly.
- **`@types/node` added as devDep** to both packages: The base tsconfig `lib: ["ES2022"]` does not inject Node.js globals (`process`, `console`). Packages building with `tsc` need explicit `types: ["node"]` + the `@types/node` package.
- **`z.treeifyError` confirmed** as the correct Zod v4 error API (research flagged this as needing verification). `z.fromError` does not exist in 4.4.3; `z.treeifyError(ZodError)` returns a structured tree and is the correct call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/node to both packages**
- **Found during:** Task 1 (build attempt)
- **Issue:** TypeScript errors `Cannot find name 'process'` and `Cannot find name 'console'` — Node.js globals not available without @types/node
- **Fix:** Added `@types/node` as devDependency; added `"types": ["node"]` to tsconfig.json
- **Files modified:** packages/config/package.json, packages/config/tsconfig.json (same pattern for queue)
- **Verification:** `pnpm --filter @omnisync/config build` exits 0
- **Committed in:** f8259ff, f7adb99

**2. [Rule 3 - Blocking] Pinned ioredis to 5.10.1 to resolve BullMQ type conflict**
- **Found during:** Task 2 (build attempt)
- **Issue:** TypeScript error `Type 'Redis' is not assignable to type 'ConnectionOptions'` — BullMQ bundles ioredis 5.10.1 internally; workspace ioredis 5.11.0 creates a dual-version scenario where `AbstractConnector` classes from different versions are incompatible
- **Fix:** Pinned `"ioredis": "5.10.1"` in packages/queue/package.json to match BullMQ's bundled version
- **Files modified:** packages/queue/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @omnisync/queue build` exits 0
- **Committed in:** f7adb99

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for TypeScript builds to pass. No scope creep — these are standard ESM + pnpm monorepo issues for CJS-based packages.

## Issues Encountered

- BullMQ 5.77.7 installed instead of the research-referenced 5.77.6 (latest patch release). No functional difference.
- ESM + NodeNext + verbatimModuleSyntax requires careful attention to ioredis import style. `import IORedis from "ioredis"` fails (no construct signatures on CJS default); `import { Redis } from "ioredis"` is the correct form.

## Known Stubs

None — both packages expose real implementations. `eventsQueue` is a live BullMQ Queue instance (connection only; no Worker or job production yet, as specified by the plan).

## User Setup Required

None - no external service configuration required during this plan. All infrastructure is local (docker-compose from Plan 01-01). The `.env.example` serves as documentation; a local `.env` file is needed before running any app (covered in subsequent plans).

## Next Phase Readiness

- `@omnisync/config` ready to be imported by all apps and packages as the single source of validated env config
- `@omnisync/queue` ready for use by the ingestion API (producer) in Phase 2 and worker (consumer) in Phase 3
- `queueOptions` constants available for Worker configuration in Phase 3 without risk of accidental change
- `.env.example` committed — developers can `cp .env.example .env` and fill in values

---
*Phase: 01-foundation-local-infra*
*Completed: 2026-06-02*

## Self-Check: PASSED

- packages/config/src/env.ts: FOUND
- packages/config/src/index.ts: FOUND
- packages/queue/src/index.ts: FOUND
- .env.example: FOUND
- 01-03-SUMMARY.md: FOUND
- commit f8259ff: FOUND
- commit f7adb99: FOUND
