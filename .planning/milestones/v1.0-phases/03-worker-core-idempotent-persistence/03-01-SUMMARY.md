---
phase: 03-worker-core-idempotent-persistence
plan: 01
subsystem: database
tags: [prisma, postgresql, migrations, vitest, integration-test, idempotency]

# Dependency graph
requires:
  - phase: 01-foundation-local-infra
    provides: Prisma 7 setup, docker-compose postgres, packages/db package structure
  - phase: 02-high-speed-ingestion-api
    provides: events table schema baseline with fingerprint unique constraint, vitest config pattern

provides:
  - Event model with externalId String + occurredAt DateTime canonical envelope columns (D-01)
  - Standalone DeadLetterEvent with fingerprint index, nullable eventId (no FK) (D-06)
  - Applied migration 20260610173016_add_event_canonical_columns_and_redesign_dlq
  - createPrismaClient({ max }) factory for configurable pg pool sizing (D-12)
  - packages/db vitest scaffold with smoke test proving $executeRaw ON CONFLICT works

affects: [03-02, 03-03, 03-04, 03-05, worker, persistence, dlq, idempotency]

# Tech tracking
tech-stack:
  added: [vitest@4.1.8, "@vitest/coverage-v8@4.1.8 (packages/db devDeps)"]
  patterns:
    - createPrismaClient(opts) factory pattern — exposes pool max alongside singleton
    - packages/db vitest.setup.ts uses DATABASE_URL ?? fallback (CI-overridable)
    - $executeRaw tagged template with 'COMPLETED'::"EventStatus" + ::jsonb cast

key-files:
  created:
    - packages/db/prisma/migrations/20260610173016_add_event_canonical_columns_and_redesign_dlq/migration.sql
    - packages/db/vitest.config.ts
    - packages/db/vitest.setup.ts
    - packages/db/tests/smoke.test.ts
  modified:
    - packages/db/prisma/schema.prisma
    - packages/db/src/index.ts
    - packages/db/package.json
    - pnpm-lock.yaml

key-decisions:
  - "$executeRaw chosen over createMany skipDuplicates — returns affected count 1/0 for duplicate-absorbed log (D-03/D-05)"
  - "createPrismaClient factory added alongside singleton — API keeps singleton, worker uses factory with pool max (D-12)"
  - "packages/db vitest scaffold has no coverage thresholds — apps/worker owns the 80% coverage gate (D-13)"
  - "smoke.test.ts uses fixed 64-char fingerprint cleaned in beforeEach/afterAll — safe for repeated runs against live DB"

patterns-established:
  - "Pattern: vitest.setup.ts uses DATABASE_URL ?? 'localhost:5433 default' so CI can override with services env var"
  - "Pattern: $executeRaw ON CONFLICT (fingerprint) DO NOTHING returns 1=inserted / 0=conflict — drives duplicate-absorbed log"
  - "Pattern: createPrismaClient(opts) factory for pool-sized clients; singleton for API/existing consumers"

requirements-completed: [IDM-02, QUE-04]

# Metrics
duration: 15min
completed: 2026-06-11
---

# Phase 03 Plan 01: DB Foundation Summary

**Prisma schema migration adding externalId+occurredAt to events, DLQ redesigned to standalone (no FK), and createPrismaClient factory proven via $executeRaw ON CONFLICT smoke test against real Postgres**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-10T17:22:37Z
- **Completed:** 2026-06-10T17:37:13Z
- **Tasks:** 3 (Task 1: schema migrations, Task 2: factory, Task 3: smoke test TDD)
- **Files modified:** 7

## Accomplishments

- Applied migration adding `externalId String` + `occurredAt DateTime` columns to events table (D-01 canonical envelope columns) — required by the worker normalizer in Plan 03-02
- Redesigned `dlq_events` to standalone: dropped FK constraint, made eventId nullable plain column, added fingerprint+resolved indexes, denormalized source/eventType/payload — fixes the latent DLQ-under-DB-outage bug (D-06)
- Exported `createPrismaClient({ max? })` factory from `@omnisync/db` so the worker can size its pg pool to concurrency without touching the singleton (D-12 / SC-4)
- Proved the exact idempotent-insert SQL — `INSERT … ON CONFLICT (fingerprint) DO NOTHING` with `'COMPLETED'::"EventStatus"` and `::jsonb` cast — runs and absorbs duplicates against the real migrated schema; resolves Phase 3 Research Open Question #1

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migrations D-01+D-06** - `ce2d746` (feat)
2. **Task 2: createPrismaClient(opts) factory D-12** - `e1fe8b8` (feat)
3. **Task 3: $executeRaw smoke test (TDD)** - `b2cfc3c` (test)

**Plan metadata:** (added in final docs commit)

## Files Created/Modified

- `packages/db/prisma/schema.prisma` — Added externalId+occurredAt to Event; replaced DeadLetterEvent with standalone shape (no FK, eventId nullable, fingerprint/resolved indexes)
- `packages/db/prisma/migrations/20260610173016_.../migration.sql` — DROP CONSTRAINT FK, make eventId nullable, ADD COLUMN externalId/occurredAt, CREATE INDEX fingerprint
- `packages/db/src/index.ts` — Added createPrismaClient({ max }) factory; singleton preserved
- `packages/db/package.json` — Added vitest@4.1.8 + @vitest/coverage-v8, test/test:coverage scripts
- `packages/db/vitest.config.ts` — Vitest config for packages/db (no coverage thresholds, passWithNoTests)
- `packages/db/vitest.setup.ts` — DATABASE_URL env stub pointing to localhost:5433 docker-compose postgres
- `packages/db/tests/smoke.test.ts` — Single integration test: first insert=1, duplicate=0, count=1

## Decisions Made

- `$executeRaw` selected over `createMany skipDuplicates` because it returns the affected row count (1 vs 0), enabling the `duplicate absorbed` log entry in the worker. The more explicit SQL is also better interview narrative.
- `createPrismaClient` factory exposed alongside the singleton (not replacing it) — zero impact on existing API consumers; worker constructs its own client with WORKER_CONCURRENCY + 2 pool slots.
- No coverage thresholds on `packages/db` vitest config — the 80% gate belongs to `apps/worker` where the business logic lives; packages/db is infrastructure, its smoke test is de-risk, not coverage.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- **Docker advisory lock timeout** on first migration attempt: the interactive prompt from the background migration process held a Postgres advisory lock. Fixed by terminating stale connections with `pg_terminate_backend` and re-running. Not a schema or config bug.
- **pnpm install needed before migration**: The worktree had no node_modules on init. Ran `pnpm install` to populate before running prisma CLI.

## User Setup Required

None — no external service configuration required. Postgres runs in docker-compose (port 5433).

## Next Phase Readiness

- Plan 03-02 (EventJobData schema + queue factory refactor) can proceed immediately — Event schema is now complete with canonical columns
- Plan 03-03 (worker processor + normalizer) can proceed — schema foundation is in place
- `createPrismaClient({ max: WORKER_CONCURRENCY + 2 })` is ready for use in `apps/worker/src/index.ts`
- The $executeRaw SQL is proven; it can be copied verbatim into `packages/worker/src/persistence/persist-event.ts`

---
*Phase: 03-worker-core-idempotent-persistence*
*Completed: 2026-06-11*

## Self-Check: PASSED
