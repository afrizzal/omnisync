---
phase: 02-high-speed-ingestion-api
plan: 03
subsystem: api
tags: [fastify, bullmq, ioredis, zod, hmac, redis, webhook, ingestion]

# Dependency graph
requires:
  - phase: 02-high-speed-ingestion-api
    provides: Plan 02-01 (vitest config, rawBody augmentation, env stubs) and Plan 02-02 (buildFingerprint, verifySignature pure functions)
  - phase: 01-foundation-local-infra
    provides: "@omnisync/types (InboundEvent, EventSource), @omnisync/queue (eventsQueue, connection), @omnisync/config (env), @omnisync/db (prisma)"
provides:
  - "buildApp({ queue, redis }) factory — FastifyInstance with helmet, sensible, raw-body, error handler, healthz, and ingest routes wired"
  - "POST /ingest/:source hot path: HMAC verify → Zod validate → fingerprint → Redis SET NX dedup gate → BullMQ enqueue → 202"
  - "GET /healthz liveness endpoint returning { status: ok, uptime }"
  - "Centralized setErrorHandler with INTERNAL_ERROR envelope for 5xx and code passthrough for 4xx"
  - "getSecretForSource() mapping EventSource → WEBHOOK_SECRET_* env var"
  - "apps/api/src/index.ts: live entrypoint with buildApp + listen + SIGINT/SIGTERM shutdown"
  - "Route test suite (22 tests): SC-1 202 queued, SC-2 401 invalid sig, SC-3 422 Zod issues[], SC-4 202 duplicate, ING-05 no DB write"
affects: [03-resilient-worker-queue, 04-worker-resilience, 06-deployment-ci]

# Tech tracking
tech-stack:
  added:
    - "bullmq@^5.77.0 (direct dep for Queue type in AppDeps)"
    - "ioredis@5.10.1 (direct dep for Redis type in AppDeps)"
    - "zod@^4.4.0 (direct dep for z.flattenError in ingest route)"
  patterns:
    - "buildApp({ queue, redis }) factory pattern — enables app.inject() tests without real infra"
    - "Plugin registration order: helmet → sensible → raw-body → error handler → routes"
    - "Source param normalized to uppercase before secret lookup and Zod validation"
    - "Redis SET NX gate with EX-before-NX argument order per ioredis overload signature"
    - "instanceof Buffer guard on request.rawBody before passing to verifySignature"

key-files:
  created:
    - "apps/api/src/app.ts — buildApp factory, AppDeps interface"
    - "apps/api/src/plugins/errorHandler.ts — centralized setErrorHandler"
    - "apps/api/src/lib/secrets.ts — getSecretForSource() map"
    - "apps/api/src/routes/health.ts — GET /healthz"
    - "apps/api/src/routes/ingest.ts — POST /ingest/:source hot path"
    - "apps/api/tests/routes/health.test.ts — healthz smoke test"
    - "apps/api/tests/routes/ingest.test.ts — SC-1 through SC-4 + ING-05"
  modified:
    - "apps/api/src/index.ts — replaced stub with live buildApp + listen + shutdown"
    - "apps/api/package.json — added bullmq, ioredis, zod as direct deps"
    - "apps/api/src/plugins/errorHandler.ts — typed error param as FastifyError for strict mode"
    - "pnpm-lock.yaml — updated after adding direct deps"

key-decisions:
  - "Add bullmq, ioredis, zod as direct deps of @omnisync/api — required for TypeScript to resolve Queue/Redis/z types under NodeNext moduleResolution (pnpm workspace symlinks don't hoist transitive type deps)"
  - "Redis SET NX uses 'EX', seconds, 'NX' order (not 'NX', 'EX', seconds) — matches ioredis overload signature at line 3755 of RedisCommander.d.ts"
  - "instanceof Buffer guard on request.rawBody before passing to verifySignature — TypeScript strict mode requires narrowing from string|Buffer to Buffer"
  - "FastifyError type annotation on setErrorHandler error parameter — strict mode treats setErrorHandler callback param as unknown without annotation"

patterns-established:
  - "buildApp factory: use Pick<Queue, 'add'> and Pick<Redis, 'set'> in AppDeps for minimal mock surface"
  - "Source normalization: rawSource.toUpperCase() before secret lookup AND Zod validation so lowercase URLs work"
  - "Zod flattenError for 422: z.flattenError(parsed.error).fieldErrors → issues[]  (NOT z.treeifyError)"
  - "Test isolation: fresh app + fresh mocks per test via beforeEach/afterEach with app.close()"

requirements-completed: [ING-01, ING-02, ING-03, ING-05, IDM-01]

# Metrics
duration: 18min
completed: 2026-06-09
---

# Phase 02 Plan 03: Fastify Ingestion Application Summary

**Fastify buildApp factory with HMAC→Zod→fingerprint→Redis SET NX→BullMQ hot path achieving 202 ACK with no DB write, fully tested via app.inject() across SC-1 through SC-4**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-09T12:42:46Z
- **Completed:** 2026-06-09T13:01:26Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Built `buildApp({ queue, redis })` factory wiring helmet → sensible → raw-body → error handler → routes in the correct plugin registration order
- Implemented the `POST /ingest/:source` hot path composing all Plan 02 pure functions (verifySignature, buildFingerprint) with Redis SET NX dedup gate and BullMQ enqueue — no DB write on the request path (ING-05)
- Created full route test suite: 22 tests across 4 files covering SC-1 (202 queued), SC-2 (401 invalid sig), SC-3 (422 Zod issues[]), SC-4 (202 duplicate), and ING-05 (queue.add called once with jobId, no Prisma)

## Task Commits

Each task was committed atomically:

1. **Task 1: buildApp factory, plugins, error handler, secrets helper, and /healthz route** - `65e3ea1` (feat)
2. **Task 2: POST /ingest/:source hot path** - `fb2d9d1` (feat)
3. **Task 3: Wire index.ts entrypoint and write app.inject() route tests** - `4e9e7de` (feat)

## Files Created/Modified

- `apps/api/src/app.ts` — buildApp factory with AppDeps interface and plugin registration order
- `apps/api/src/plugins/errorHandler.ts` — setErrorHandler with INTERNAL_ERROR 5xx envelope and 4xx passthrough
- `apps/api/src/lib/secrets.ts` — getSecretForSource() mapping EventSource → WEBHOOK_SECRET_* env var (null for unknown)
- `apps/api/src/routes/health.ts` — GET /healthz returning { status: ok, uptime }
- `apps/api/src/routes/ingest.ts` — five-step hot path: HMAC verify → Zod validate → fingerprint → SET NX → enqueue → 202
- `apps/api/src/index.ts` — live entrypoint: buildApp + listen + shutdown (app.close + prisma.$disconnect)
- `apps/api/tests/routes/health.test.ts` — healthz smoke test
- `apps/api/tests/routes/ingest.test.ts` — SC-1 through SC-4 + ING-05 via app.inject() with mocked queue/redis
- `apps/api/package.json` — added bullmq, ioredis, zod as direct deps
- `pnpm-lock.yaml` — updated

## Decisions Made

- Added `bullmq`, `ioredis`, `zod` as direct deps of `@omnisync/api` — under NodeNext module resolution, TypeScript requires direct deps for type-only imports even when the packages are available via workspace transitive deps
- Redis SET NX call uses `"EX", 86400, "NX"` argument order (EX before NX) per ioredis TypeScript overload signatures
- `instanceof Buffer` guard on `request.rawBody` before passing to `verifySignature` — strict mode requires narrowing from `string | Buffer` to `Buffer`
- `FastifyError` type annotation on `setErrorHandler` callback error param — strict mode treats it as `unknown` otherwise

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added bullmq, ioredis, zod as direct dependencies**
- **Found during:** Task 2 (typecheck verification)
- **Issue:** `@omnisync/api` used `import type { Queue } from "bullmq"`, `import type { Redis } from "ioredis"`, and `import { z } from "zod/v4"` but none of these were direct deps — pnpm NodeNext resolution requires direct deps for type resolution
- **Fix:** Added `bullmq: ^5.77.0`, `ioredis: 5.10.1`, `zod: ^4.4.0` to `apps/api/package.json` dependencies and ran `pnpm install --no-frozen-lockfile`
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @omnisync/api typecheck` exits 0
- **Committed in:** `fb2d9d1` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed ioredis SET NX argument order**
- **Found during:** Task 2 (typecheck)
- **Issue:** Plan code used `redis.set(key, "1", "NX", "EX", 86400)` — ioredis TypeScript overloads require `"EX", seconds, "NX"` order (EX token first)
- **Fix:** Changed to `redis.set(\`idem:${fingerprint}\`, "1", "EX", 86400, "NX")`
- **Files modified:** `apps/api/src/routes/ingest.ts`
- **Verification:** TypeScript overload resolution passes; Redis command is semantically equivalent
- **Committed in:** `fb2d9d1` (Task 2 commit)

**3. [Rule 1 - Bug] Added instanceof Buffer guard for rawBody**
- **Found during:** Task 2 (typecheck)
- **Issue:** `request.rawBody` is typed as `string | Buffer | undefined`; strict mode rejected passing it directly to `verifySignature(rawBody: Buffer, ...)`
- **Fix:** Added `const rawBody = request.rawBody; if (!(rawBody instanceof Buffer)) { ... return 401; }` guard before the HMAC call
- **Files modified:** `apps/api/src/routes/ingest.ts`
- **Verification:** TypeScript strict mode passes; behavior is correct (non-Buffer rawBody → 401)
- **Committed in:** `fb2d9d1` (Task 2 commit)

**4. [Rule 1 - Bug] Typed setErrorHandler error param as FastifyError**
- **Found during:** Task 2 (typecheck)
- **Issue:** TypeScript strict mode typed the `error` param in `setErrorHandler` callback as `unknown`
- **Fix:** Added `import type { FastifyError } from "fastify"` and annotated the param as `(error: FastifyError, request, reply)`
- **Files modified:** `apps/api/src/plugins/errorHandler.ts`
- **Verification:** TypeScript strict mode passes
- **Committed in:** `fb2d9d1` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 bugs from TypeScript strict mode)
**Impact on plan:** All fixes required for correct TypeScript compilation under strict/NodeNext. No scope creep — functionality is exactly as planned.

## Issues Encountered

- Worktree lacked node_modules initially; required `pnpm install --no-frozen-lockfile` after adding new deps (expected for isolated worktree environment)
- Workspace packages (`@omnisync/types`, `@omnisync/config`, `@omnisync/queue`, `@omnisync/db`) needed to be built with `pnpm --filter <pkg> build` before typecheck would resolve their types (standard pnpm workspace build order requirement)

## User Setup Required

None - no external service configuration required. Route tests use mocked queue and redis — no real infrastructure needed.

## Next Phase Readiness

- Phase 02 fully complete: all ingestion primitives (fingerprint, HMAC) + application wiring (app factory, hot path, health, error handler) + route test suite (SC-1..SC-4) are done
- Phase 03 (resilient worker queue) can immediately import `{ buildApp, AppDeps }` from `@omnisync/api` and use the `POST /ingest/:source` endpoint
- No blockers for Phase 03

## Self-Check: PASSED

All created files confirmed present. All task commits verified:
- `65e3ea1` Task 1: buildApp factory, plugins, health route
- `fb2d9d1` Task 2: ingest.ts hot path (with type fixes)
- `4e9e7de` Task 3: index.ts entrypoint + route tests

---
*Phase: 02-high-speed-ingestion-api*
*Completed: 2026-06-09*
