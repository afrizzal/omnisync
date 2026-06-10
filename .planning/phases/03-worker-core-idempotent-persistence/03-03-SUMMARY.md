---
phase: 03-worker-core-idempotent-persistence
plan: "03"
subsystem: worker-test-scaffold
tags: [vitest, ci, integration-tests, worker, scaffold]
dependency_graph:
  requires: []
  provides: [worker-test-harness, ci-service-containers]
  affects: [03-04-worker-processor, 03-05-integration-suite]
tech_stack:
  added: [vitest@4.1.8, "@vitest/coverage-v8@4.1.8", bullmq, ioredis, zod, pino]
  patterns: [vitest-passWithNoTests, env-preload-setup-file, ci-services-block]
key_files:
  created:
    - apps/worker/vitest.config.ts
    - apps/worker/vitest.setup.ts
  modified:
    - apps/worker/package.json
    - .github/workflows/ci.yml
    - pnpm-lock.yaml
decisions:
  - "vitest.setup.ts uses ?? operator so CI job-level env vars override local defaults without conditionals"
  - "src/index.ts excluded from coverage — entrypoint wiring is tested indirectly via integration tests"
  - "CI publishes Postgres on 5432 (not 5433 used locally) to avoid port mapping issues in service containers"
  - "pino added as direct dep in Wave 0 so Plan 03-04 needs no package.json edit when it imports pino"
metrics:
  duration_minutes: 6
  completed_date: "2026-06-11"
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 03: Worker Test Scaffold and CI Service Containers Summary

Worker Vitest harness with 80% coverage gate + CI postgres:16/redis:7 service containers with migrate-deploy step — enabling Wave 1/Wave 2 integration tests to run locally and in CI.

## What Was Built

### Task 1: Worker test scaffold (D-13 / Wave 0)
- Extended `apps/worker/package.json` with runtime deps (`bullmq@^5.77.0`, `ioredis@5.10.1`, `pino@^9.0.0`, `zod@^4.4.0`) and devDeps (`vitest@4.1.8`, `@vitest/coverage-v8@4.1.8`)
- Added `test` and `test:coverage` scripts
- Created `apps/worker/vitest.config.ts` mirroring apps/api config: 80% line coverage gate, `src/index.ts` excluded, `passWithNoTests: true`
- Created `apps/worker/vitest.setup.ts` pre-populating all required env vars (DATABASE_URL, DIRECT_URL, REDIS_URL, WEBHOOK_SECRET_*, WORKER_CONCURRENCY) using `??` for CI override support

### Task 2: CI service containers (Open Question #3)
- Added `services:` block to the `verify` job with `postgres:16` and `redis:7`, both with health checks
- Added job-level `env:` block exporting `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` pointing at CI service containers (port 5432/6379)
- Added `prisma migrate deploy` step after generate and before test, ensuring the Phase 3 schema is applied before integration tests run

## Verification

- `pnpm --filter @omnisync/worker test` exits 0 (passWithNoTests, no test files yet at Wave 0)
- CI workflow string check: all four required strings present (`postgres:16`, `redis:7`, `migrate deploy`, `DATABASE_URL`)
- No source code or shared-package files modified — zero overlap with 03-01/03-02

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this is a scaffold-only plan; no data flows or UI rendering involved.

## Self-Check: PASSED

Files exist:
- FOUND: apps/worker/vitest.config.ts
- FOUND: apps/worker/vitest.setup.ts
- FOUND: .github/workflows/ci.yml (modified)
- FOUND: apps/worker/package.json (modified)

Commits exist:
- FOUND: b55c173 (Task 1 — worker test scaffold)
- FOUND: 51af95a (Task 2 — CI service containers)
