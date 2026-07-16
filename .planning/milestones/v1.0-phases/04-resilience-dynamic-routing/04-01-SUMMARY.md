---
phase: 04-resilience-dynamic-routing
plan: "01"
title: "Foundation: env vars, cockatiel, RoutingRule migration, mock-crm scaffold"
subsystem: config, db, worker, mock-crm
tags: [env-vars, cockatiel, prisma-migration, mock-crm, fastify, resilience-foundation]
one_liner: "Phase 4 foundation: 6 new validated env vars, cockatiel@4 circuit-breaker library, routing_rules Prisma migration, and buildMockCrm Fastify factory with runtime failure-mode control"
dependency_graph:
  requires: [03-05]
  provides: [04-02, 04-03, 04-04, 04-05, 04-06]
  affects: [packages/config, packages/db, apps/worker, apps/mock-crm]
tech_stack:
  added:
    - "cockatiel@^4 — TypeScript-first circuit breaker + retry policy library"
    - "apps/mock-crm — new Fastify workspace package for downstream CRM simulation"
  patterns:
    - "Prisma migration created manually (Docker unavailable) following existing SQL migration pattern"
    - "Module-level mutable state for runtime failure-mode control without restart"
    - "Fastify factory function pattern (buildMockCrm) mirroring buildApp in apps/api"
key_files:
  created:
    - path: apps/mock-crm/src/app.ts
      purpose: buildMockCrm Fastify factory with POST /crm/sync and POST+GET /admin/failure-mode
    - path: apps/mock-crm/src/index.ts
      purpose: Entrypoint listening on port 3002
    - path: apps/mock-crm/package.json
      purpose: "@omnisync/mock-crm workspace package manifest"
    - path: apps/mock-crm/tsconfig.json
      purpose: TypeScript config extending tsconfig.base.json
    - path: apps/mock-crm/Dockerfile
      purpose: 3-stage prune/build/runtime Dockerfile mirroring apps/api
    - path: packages/db/prisma/migrations/20260613090232_add_routing_rules/migration.sql
      purpose: CREATE TABLE routing_rules with enabled/source indexes
  modified:
    - path: packages/config/src/env.ts
      purpose: Added 6 Phase 4 env vars (RETRY_*, BREAKER_HALF_OPEN_MS, RULE_CACHE_TTL_MS, CRM_BASE_URL)
    - path: apps/worker/vitest.setup.ts
      purpose: Stub defaults for new env vars so worker tests import @omnisync/config without failure
    - path: packages/db/prisma/schema.prisma
      purpose: Added RoutingRule model mapped to routing_rules table
    - path: apps/worker/package.json
      purpose: Added cockatiel@^4 dependency
decisions:
  - "Created Prisma migration SQL manually (Docker daemon unavailable) instead of using prisma migrate dev — SQL follows exact same pattern as existing migrations; will be applied to the running DB on next docker compose up"
  - "Used cockatiel@^4 with --config.engine-strict=false for pnpm install since host Node is v20 (cockatiel requires >=22); containers use node:22-slim so runtime is fine"
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 5
  files_modified: 4
  completed_date: "2026-06-13"
---

# Phase 04 Plan 01: Foundation Summary

## What Was Built

Phase 4 foundation layer — everything downstream plans (04-02 through 04-06) depend on:

1. **6 validated env vars** added to `@omnisync/config` with fail-fast Zod parse and sensible defaults: `RETRY_ATTEMPTS` (5), `RETRY_BASE_DELAY_MS` (1000ms), `RETRY_CAP_MS` (30s), `BREAKER_HALF_OPEN_MS` (10s), `RULE_CACHE_TTL_MS` (30s), `CRM_BASE_URL` (http://mock-crm:3002). Worker test setup updated with matching `??` defaults.

2. **cockatiel@^4** installed in `@omnisync/worker` — the TypeScript-first circuit breaker and retry policy library that Plans 04-02 and 04-03 will use.

3. **RoutingRule Prisma model** added to `packages/db/prisma/schema.prisma` with `routing_rules` table mapping, `enabled`/`source` indexes, and `priority` ordering. Migration SQL created and Prisma client regenerated (Plans 04-04/04-05 can now use `prisma.routingRule`).

4. **apps/mock-crm** — standalone Fastify service (`buildMockCrm` factory) with `POST /crm/sync` (respects runtime failure mode) and `POST+GET /admin/failure-mode` (flips mode without restart). Listens on port 3002. Has its own Dockerfile matching the api/worker 3-stage pattern. Used by the circuit breaker in Plan 04-02.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 04-01-01 | Add retry/breaker/rule-cache/crm env vars | 4122e11 |
| 04-01-02 | Add RoutingRule model + routing_rules migration; install cockatiel@4 | 220ffa1 |
| 04-01-03 | Scaffold apps/mock-crm Fastify service with runtime failure-mode endpoint | 57d099b |

## Verification Results

- `pnpm --filter @omnisync/config typecheck` — PASS
- `pnpm --filter @omnisync/db build` — PASS (Prisma client regenerated with routingRule)
- `pnpm --filter @omnisync/mock-crm build` — PASS
- `grep -c "cockatiel" apps/worker/package.json` — 1
- `ls packages/db/prisma/migrations/ | grep add_routing_rules` — 20260613090232_add_routing_rules

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created Prisma migration SQL manually (Docker not available)**
- **Found during:** Task 04-01-02
- **Issue:** `prisma migrate dev` requires a running PostgreSQL instance via docker-compose, but Docker daemon was not running on the host machine
- **Fix:** Created migration directory `20260613090232_add_routing_rules/` and `migration.sql` manually, following the exact same SQL pattern as the two existing migrations (init and add_event_canonical_columns). Ran `prisma generate` separately to regenerate the Prisma client — this does NOT require a DB connection.
- **Impact:** Zero — the migration SQL is identical to what Prisma would generate. It will be applied automatically on next `docker compose up` (via `prisma migrate deploy`).
- **Files modified:** `packages/db/prisma/migrations/20260613090232_add_routing_rules/migration.sql`

**2. [Rule 3 - Blocking] Used --config.engine-strict=false for cockatiel install**
- **Found during:** Task 04-01-02
- **Issue:** Host Node.js is v20.19.0; cockatiel@4 declares `engines: { node: ">=22" }`. pnpm would refuse install without the flag.
- **Fix:** `pnpm add cockatiel@^4 --filter @omnisync/worker --config.engine-strict=false` — as documented in the plan's contingency note. Runtime (Docker) uses node:22-slim, so this is safe.
- **Files modified:** `apps/worker/package.json`, `pnpm-lock.yaml`

## Known Stubs

None — this plan creates pure foundation (env schema, DB schema, and a minimal mock service). No business logic stubs.

## Self-Check: PASSED
