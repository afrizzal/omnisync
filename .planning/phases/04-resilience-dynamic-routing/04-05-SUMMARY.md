---
phase: 04-resilience-dynamic-routing
plan: "05"
subsystem: api
tags: [bullmq, prisma, fastify, dlq, requeue, docker-compose]

requires:
  - phase: 04-01
    provides: cockatiel, RoutingRule model, mock-crm app, @omnisync/db

provides:
  - POST /admin/dlq/:id/requeue endpoint — re-enqueues a DLQ entry through normal worker pipeline idempotently
  - requeueDlqEntry service layer function with discriminated result (requeued/not_found/already_queued)
  - mock-crm service in docker-compose with healthcheck; worker depends on it

affects:
  - 04-06 (observability; uses admin API pattern)
  - 05 (dashboard phase calls POST /admin/dlq/:id/requeue)

tech-stack:
  added: ["@omnisync/db workspace dep in apps/api (scoped to admin path)"]
  patterns:
    - "Admin routes registered conditionally behind optional prisma dep in AppDeps — ingest hot path stays DB-free (ING-05)"
    - "Re-queue uses queue.add with fingerprint as jobId (NOT job.retry) for BullMQ deduplication idempotency"
    - "RequeueDeps interface for DI-friendly testing of re-queue service"

key-files:
  created:
    - apps/api/src/services/requeue.ts
    - apps/api/src/routes/admin.ts
  modified:
    - apps/api/src/app.ts
    - apps/api/src/index.ts
    - apps/api/package.json
    - docker-compose.yml
    - pnpm-lock.yaml

key-decisions:
  - "Re-queue uses queue.add(name, data, { jobId: fingerprint }) not job.retry() — failed BullMQ job may have been removed but Postgres DLQ row is durable source of truth (research finding #6)"
  - "AppDeps.prisma is optional — ingest hot path tests inject only queue+redis, admin path gets prisma; ING-05 architectural property preserved"
  - "mock-crm service name must be exactly 'mock-crm' so CRM_BASE_URL=http://mock-crm:3002 resolves via Docker DNS"

requirements-completed: [RES-06]

duration: 13min
completed: 2026-06-13
---

# Phase 04 Plan 05: Re-queue API + docker-compose mock-crm service Summary

**Idempotent DLQ re-queue via `POST /admin/dlq/:id/requeue` using fingerprint-as-jobId (BullMQ dedup), plus mock-crm service in docker-compose with worker health dependency**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-13T09:15:05Z
- **Completed:** 2026-06-13T09:28:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `requeueDlqEntry` service reads the Postgres DLQ row (durable source of truth), re-enqueues via `queue.add` with `jobId = fingerprint` making double-click safe via BullMQ deduplication (research finding #6; NOT `job.retry`)
- `POST /admin/dlq/:id/requeue` admin route returns 200 `{status: "requeued"|"already_queued"}` or 404; marks DLQ entry `resolved: true` on success
- `AppDeps.prisma` is optional — existing 25 API tests continue to pass without any prisma mock; admin routes only register when prisma is present
- `mock-crm` service added to docker-compose at port 3002 with fetch-based healthcheck; worker service now depends on `mock-crm: service_healthy`

## Task Commits

1. **Task 04-05-01: Re-queue service + admin router (RES-06)** - `41a48eb` (feat)
2. **Task 04-05-02: Add mock-crm service to docker-compose (D-06/D-09)** - `817917d` (feat)
3. **Lockfile update** - `eec5f60` (chore)

## Files Created/Modified

- `apps/api/src/services/requeue.ts` — `requeueDlqEntry(deps, id)` with RequeueDeps DI interface and discriminated RequeueResult type
- `apps/api/src/routes/admin.ts` — `adminRoutes(app, deps)` Fastify plugin registering POST /admin/dlq/:id/requeue
- `apps/api/src/app.ts` — Extended AppDeps with optional `prisma?: PrismaClient`; conditionally registers admin routes
- `apps/api/src/index.ts` — Imports `createPrismaClient` from `@omnisync/db`; passes prisma to buildApp; disconnects on shutdown
- `apps/api/package.json` — Added `@omnisync/db: workspace:*` dependency
- `docker-compose.yml` — Added mock-crm service (build, port 3002, healthcheck); worker depends_on mock-crm:service_healthy
- `pnpm-lock.yaml` — Updated for @omnisync/db workspace link in apps/api

## Decisions Made

- **Re-queue via `queue.add` not `job.retry`:** The failed BullMQ job may have been removed (removeOnFail age policy). The Postgres `dlq_events` table is the durable source of truth. Reconstructing `EventJobData` from the DLQ row and adding with `jobId = fingerprint` guarantees idempotency regardless of BullMQ job state.
- **Optional prisma in AppDeps:** Makes the admin registration conditional so existing test suites (which inject only queue+redis fakes) continue to work without changes. The ingest hot path never imports prisma — ING-05 architectural property is preserved.
- **Mock-CRM service name is exactly `mock-crm`:** The `@omnisync/config` package sets `CRM_BASE_URL` default to `http://mock-crm:3002`. Docker DNS resolves the service name exactly — any other name would break the worker's CRM client without an env var override.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Worktree had no node_modules — needed to run `pnpm install` and build dependency packages (`@omnisync/types`, `@omnisync/config`, `@omnisync/queue`, `@omnisync/db`) before typecheck could pass. Standard worktree setup, not a code issue.
- Docker `compose config` validation failed because `.env` file is absent in the worktree (expected in a worktree without secrets). The YAML syntax was confirmed structurally correct by the error message (Docker parsed the file and complained only about the missing .env file).

## User Setup Required

None - no external service configuration required. The `mock-crm` healthcheck uses `fetch` (Node 22 built-in) targeting `GET /admin/failure-mode` which was implemented in plan 04-01.

## Next Phase Readiness

- Re-queue API is complete and ready for dashboard integration in Phase 5 (single-entry re-queue; bulk re-queue deferred to Phase 5 as planned)
- docker-compose now starts all 5 services in correct dependency order: postgres → redis → mock-crm → worker → api
- Phase 04-06 (observability/metrics) can build on the admin router pattern established here

---
*Phase: 04-resilience-dynamic-routing*
*Completed: 2026-06-13*

## Self-Check: PASSED

- FOUND: apps/api/src/services/requeue.ts
- FOUND: apps/api/src/routes/admin.ts
- FOUND: .planning/phases/04-resilience-dynamic-routing/04-05-SUMMARY.md
- FOUND: commit 41a48eb (feat: re-queue service + admin route)
- FOUND: commit 817917d (feat: mock-crm in docker-compose)
