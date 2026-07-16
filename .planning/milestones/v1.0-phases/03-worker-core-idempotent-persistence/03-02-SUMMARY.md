---
phase: 03-worker-core-idempotent-persistence
plan: 02
subsystem: queue
tags: [bullmq, ioredis, redis, zod, vitest, typescript, queue-factory]

requires:
  - phase: 02-high-speed-ingestion-api
    provides: API enqueue wire shape { source, payload: InboundEvent, fingerprint } that EventJobData must match
  - phase: 01-foundation-local-infra
    provides: @omnisync/queue, @omnisync/types, @omnisync/config packages; ioredis/BullMQ pinned versions

provides:
  - Side-effect-free createRedisConnection(url) + createEventsQueue(connection) factories in @omnisync/queue
  - EventJobData Zod schema in @omnisync/types codifying the API wire contract for worker safeParse
  - WORKER_CONCURRENCY env var (coerced int 1-50, default 5) in @omnisync/config
  - apps/api structurally db-free (no @omnisync/db import anywhere in API surface)
  - vitest test scaffold for packages/queue with no-socket-on-import guard

affects:
  - 03-03-PLAN (worker build — consumes createRedisConnection + createEventsQueue, WORKER_CONCURRENCY, EventJobData)
  - 03-04-PLAN (buildWorker factory — stalledInterval + drainDelay go here as WorkerOptions, not QueueOptions)

tech-stack:
  added: [vitest@4.1.8 + @vitest/coverage-v8@4.1.8 in packages/queue devDeps]
  patterns:
    - Side-effect-free factory pattern — packages never call new Redis() or new Queue() at module load
    - EventJobData schema codifies API↔worker wire contract at the types package boundary
    - Dependency removal as structural enforcement (D-14 removes @omnisync/db from API dep graph)

key-files:
  created:
    - packages/queue/vitest.config.ts
    - packages/queue/tests/factory.test.ts
  modified:
    - packages/queue/src/index.ts
    - packages/queue/package.json
    - packages/types/src/event.ts
    - packages/config/src/env.ts
    - apps/api/src/index.ts
    - apps/api/package.json
    - pnpm-lock.yaml

key-decisions:
  - "D-09 AMENDMENT: guardInterval removed from @omnisync/queue — dead config in BullMQ v5 (QueueScheduler removed in v2); stalledInterval + drainDelay relocate to buildWorker as WorkerOptions in Plan 03-04; supersedes Phase 1 D-10 'do NOT change values' comment"
  - "EventJobData payload field typed as InboundEvent (full validated shape) — matches API wire shape { source, payload: parsed.data, fingerprint } exactly"
  - "ING-05 is now structural: @omnisync/db removed from apps/api dependencies, not just conventions"

patterns-established:
  - "Factory pattern: packages export factory functions, never open connections at module load"
  - "WORKER_CONCURRENCY uses z.coerce.number() for string→number coercion from process.env"
  - "Worktree pnpm install must be run from the worktree root, not the main repo root"

requirements-completed: [QUE-02, QUE-03, QUE-04]

duration: 23min
completed: 2026-06-11
---

# Phase 03 Plan 02: Queue Factory Refactor & Shared Package Hardening Summary

**Side-effect-free createRedisConnection + createEventsQueue factories, EventJobData Zod schema, WORKER_CONCURRENCY env var, and API fully db-free — enabling safe worker construction in Wave 1**

## Performance

- **Duration:** 23 min
- **Started:** 2026-06-11T00:18:27Z
- **Completed:** 2026-06-11T00:41:31Z
- **Tasks:** 3 of 3
- **Files modified:** 7 (+ 2 created)

## Accomplishments

- Replaced module-level `new Redis()` + `new Queue()` socket-on-import antipattern with `createRedisConnection(url)` + `createEventsQueue(connection)` factories — package is now safe to import in test environments without REDIS_URL
- Removed `guardInterval: 30_000` from `queueOptions` export (D-09 amendment: dead config in BullMQ v5 — QueueScheduler removed in v2, stalledInterval/drainDelay are WorkerOptions not QueueOptions)
- Added `EventJobData` Zod schema to `@omnisync/types` exactly matching the API wire shape `{ source, payload: InboundEvent, fingerprint: hex64 }` — worker can now `safeParse(job.data)` as a poison-message guard
- Added `WORKER_CONCURRENCY` (coerced int 1-50, default 5) to `@omnisync/config` env validation
- Rewired `apps/api/src/index.ts` to use the new factories; removed `@omnisync/db` import and `prisma.$disconnect()` — ING-05 is now a structural property
- All 25 existing API tests remain green; 2 new queue factory tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor @omnisync/queue to side-effect-free factories + remove guardInterval (D-07/D-08/D-09)** - `37dafff` (feat, TDD)
2. **Task 2: Add EventJobData schema (D-10) + WORKER_CONCURRENCY env var (D-12)** - `2b38680` (feat)
3. **Task 3: Rewire apps/api/src/index.ts onto queue factories + drop @omnisync/db (D-07/D-14)** - `7666356` (feat)

**Plan metadata:** *(docs commit hash — see below)*

## Files Created/Modified

- `packages/queue/src/index.ts` — Replaced with side-effect-free factories; no module-level connections or env reads
- `packages/queue/package.json` — Added vitest@4.1.8 + @vitest/coverage-v8@4.1.8 devDeps; test/test:coverage scripts
- `packages/queue/vitest.config.ts` — Vitest config for packages/queue (include: tests/**/*.test.ts, coverage provider v8)
- `packages/queue/tests/factory.test.ts` — Factory smoke tests: no-socket-on-import guard + D-09 regression check
- `packages/types/src/event.ts` — Appended EventJobData schema + type after InboundEvent
- `packages/config/src/env.ts` — Added WORKER_CONCURRENCY coerced int (1-50, default 5)
- `apps/api/src/index.ts` — Rewired to createRedisConnection + createEventsQueue; removed prisma import/disconnect
- `apps/api/package.json` — Removed @omnisync/db from dependencies
- `pnpm-lock.yaml` — Updated for new queue devDeps + API dep removal

## Decisions Made

**D-09 AMENDMENT (record in STATE decisions log):** `guardInterval` is dead config in BullMQ v5. `QueueScheduler` was removed in BullMQ v2; its responsibilities were folded into the `Worker` class. The current `queueOptions` export included `guardInterval: 30_000` which had zero effect — not a `QueueOption` in v5. `stalledInterval` and `drainDelay` are `WorkerOptions` and will be set in `buildWorker` factory in Plan 03-04. This supersedes Phase 1 D-10's "do NOT change values" comment.

**ING-05 is now structural:** Removing `@omnisync/db` from `apps/api/package.json` means the API cannot accidentally import a DB client in future — the constraint is enforced at dependency resolution time, not convention.

**EventJobData.payload typed as InboundEvent:** The API enqueues `{ source, payload: parsed.data, fingerprint }` where `parsed.data` is an `InboundEvent`. The schema codifies this existing wire shape exactly — no wire format change.

## Deviations from Plan

None — plan executed exactly as written. The worktree pnpm install discovery (needing to run `pnpm install` from the worktree root rather than the main repo root) was an infrastructure-level detail, not a deviation from the plan.

## Issues Encountered

**Worktree pnpm isolation:** The worktree has its own independent `package.json` + `pnpm-lock.yaml`. Running `pnpm install` from the main repo (`/d/Aff/proj/omnisync/`) reads the main branch's package.json files and doesn't install new devDeps added in the worktree. Resolution: always run `pnpm install` from the worktree root (`/d/Aff/proj/omnisync/.claude/worktrees/agent-a67a4f329beafd2c4/`).

**Package dist/ must exist for cross-package typecheck:** After cloning the worktree from master (which had no `dist/` directories since those are gitignored), API typecheck failed because `@omnisync/config`, `@omnisync/queue`, and `@omnisync/types` had no compiled output. Resolution: built each package (`pnpm --filter @omnisync/... build`) before running API typecheck. This is expected behavior for a fresh worktree.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `@omnisync/queue` is safe to import in worker tests without REDIS_URL — Wave 1 can start
- `createRedisConnection` and `createEventsQueue` are the canonical factory pattern for all future entrypoints (worker, dashboard)
- `EventJobData` schema is ready for worker's `safeParse(job.data)` poison-message guard in Plan 03-03
- `WORKER_CONCURRENCY` is in config, ready for `buildWorker` concurrency option in Plan 03-04
- API has no DB dependency — confirmed by both typecheck and the removed package.json entry

---
*Phase: 03-worker-core-idempotent-persistence*
*Completed: 2026-06-11*

## Self-Check: PASSED

Files verified present:
- packages/queue/src/index.ts — FOUND
- packages/queue/tests/factory.test.ts — FOUND
- packages/queue/vitest.config.ts — FOUND
- packages/types/src/event.ts — FOUND
- packages/config/src/env.ts — FOUND
- apps/api/src/index.ts — FOUND

Commits verified:
- 37dafff (Task 1: queue factory refactor) — FOUND
- 2b38680 (Task 2: EventJobData + WORKER_CONCURRENCY) — FOUND
- 7666356 (Task 3: API rewire + db removal) — FOUND
- 3f578f0 (Docs: SUMMARY + STATE + ROADMAP) — FOUND
