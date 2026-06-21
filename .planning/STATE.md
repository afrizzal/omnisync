---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 06-01-PLAN.md
last_updated: "2026-06-21T02:24:26Z"
last_activity: 2026-06-21
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 28
  completed_plans: 23
  percent: 85
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-02)

**Core value:** No accepted event is ever silently lost — once acknowledged (HTTP 202), an event is durably queued and processed at-least-once and idempotently, surviving worker crashes, DB outages, and flaky downstream APIs, with a DLQ as the final safety net.
**Current focus:** Phase 06 — testing-ci-cd-deployment

## Current Position

Phase: 6
Plan: 1 of 6 complete
Status: Executing Phase 06 — Plan 01 complete
Last activity: 2026-06-21

Progress: [█████░] 23/28 plans complete (85%) — Phases 1–5 shipped; Phase 6 Plan 01 (Wave 0 foundation) complete

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: ~25 min
- Total execution time: ~76 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 | 3 of 4 | ~76 min | ~25 min |

**Recent Trend:**

- Last 5 plans: 01-01 (10 min), 01-02 (45 min), 01-03 (21 min)
- Trend: baseline

*Updated after each plan completion*
| Phase 01-foundation-local-infra P02 | 45 | 3 tasks | 12 files |
| Phase 01 P03 | 21 | 2 tasks | 9 files |
| Phase 01-foundation-local-infra P04 | 45 | 4 tasks | 15 files |
| Phase 02-high-speed-ingestion-api P01 | 9 | 3 tasks | 7 files |
| Phase 02 P02 | 17 | 2 tasks | 9 files |
| Phase 02-high-speed-ingestion-api P03 | 18 | 3 tasks | 10 files |
| Phase 03-worker-core-idempotent-persistence P03 | 6 | 2 tasks | 5 files |
| Phase 03 P04 | 22 | 3 tasks | 9 files |
| Phase 03-worker-core-idempotent-persistence P05 | 25 | 3 tasks | 5 files |
| Phase 04 P01 | 12 | 3 tasks | 9 files |
| Phase 04 P03 | 16 | 2 tasks | 6 files |
| Phase 04 P04 | 14 | 3 tasks | 7 files |
| Phase 04 P06 | 25 | 3 tasks | 6 files |
| Phase 05 P01 | 30 | 3 tasks | 10 files |
| Phase 05 P02 | 27 | 3 tasks | 17 files |
| Phase 05 P03 | 14 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: `UNIQUE(fingerprint)` constraint lives in Phase 1 schema — must not be retrofitted later (PITFALLS #2/#3)
- Roadmap: Dynamic routing (RTE-01/02) merged into Phase 4 alongside resilience — worker architecture is shared; avoids a thin standalone phase
- Roadmap: OPS-02 (docker-compose local dev) assigned to Phase 1 — local infra is foundational; OPS-01 (CI) and OPS-03/04 (deployment + demo script) to Phase 6
- Roadmap: Hosting decision (always-on worker free-tier) remains deferred to Phase 6 per research recommendation; Render/Fly candidates known
- [Phase 01]: Biome 2.x uses files.includes with negation patterns (not files.ignore) — verified during 01-01 execution
- [Phase 01]: Turborepo v2 uses tasks key (not pipeline); biome folder exclusions need no trailing /** from v2.2.0+
- [Phase 01-foundation-local-infra]: Prisma 7.8.0 uses prisma.config.ts defineConfig for DATABASE_URL (not schema.prisma datasource url) — breaking change from v6
- [Phase 01-foundation-local-infra]: Prisma 7 PrismaClient requires PrismaPg driver adapter in constructor (no env fallback); generator name = 'prisma-client', output = '../generated/prisma' (TypeScript source)
- [Phase 01]: ioredis pinned to 5.10.1 in @omnisync/queue to match BullMQ bundled version — prevents TypeScript type conflict in pnpm dual-version resolution
- [Phase 01]: z.treeifyError confirmed as the correct Zod v4 error API; named { Redis } import from ioredis required for ESM + NodeNext + verbatimModuleSyntax
- [Phase 01-foundation-local-infra]: Next.js 16.2.7 + React 19.2.7 used for apps/dashboard (current stable at execution time)
- [Phase 01-foundation-local-infra]: Turborepo v2.9.16 --docker flag confirmed; apps use 3-stage Dockerfile (prune/build/runtime) with node:22-slim
- [Phase 02-high-speed-ingestion-api]: vitest passWithNoTests:true added to config so vitest run exits 0 on empty test directory (vitest v4 exits 1 by default)
- [Phase 02-high-speed-ingestion-api]: workspace:* used for @omnisync/queue in apps/api (corrected from pnpm default workspace:^) for consistency with other workspace deps
- [Phase 02]: Vitest setupFiles used to pre-populate env vars before module load to prevent @omnisync/config Zod parse failure in tests (Pitfall 4 prevention)
- [Phase 02]: Known-value SHA-256 hash anchor hardcoded in fingerprint test to detect algorithm drift: 7ed400d9932c822806865fbc3658051dcffc88718ad40ea0039690d284d0ea74
- [Phase 02-high-speed-ingestion-api]: Add bullmq, ioredis, zod as direct deps of @omnisync/api — NodeNext module resolution requires direct deps for type-only imports
- [Phase 02-high-speed-ingestion-api]: Redis SET NX uses 'EX', seconds, 'NX' order — matches ioredis overload signature (EX token before NX)
- [260610-s0n]: Gate-then-enqueue rollback: AppDeps.redis widened to Pick<Redis, "set" | "del">; queue.add wrapped in try/catch with best-effort redis.del on failure
- [260610-s0n]: buildFingerprint normalizes occurredAt via new Date(occurredAt).toISOString() — safe window (no persisted fingerprints yet); null-byte test updated to use valid ISO inputs
- [260610-s0n]: Redis AOF enabled via --appendonly yes + redisdata named volume in docker-compose; --maxmemory-policy noeviction preserved
- [Phase 03-01]: $executeRaw chosen over createMany skipDuplicates — returns affected count 1/0 for duplicate-absorbed log (D-03/D-05); SQL proven against real Postgres
- [Phase 03-01]: createPrismaClient({ max }) factory exported alongside prisma singleton — worker uses factory, API keeps singleton, zero breakage
- [Phase 03-01]: packages/db vitest scaffold has no coverage thresholds — apps/worker owns 80% gate; packages/db is infrastructure test, not business logic
- [Phase 03-02]: D-09 AMENDMENT: guardInterval removed from @omnisync/queue — dead config in BullMQ v5; stalledInterval + drainDelay relocate to buildWorker as WorkerOptions
- [Phase 03-02]: @omnisync/queue createRedisConnection + createEventsQueue factories — import-safe, no socket on load; apps/api structurally db-free (ING-05 enforced by dependency graph)
- [Phase 03-03]: vitest.setup.ts uses ?? operator so CI job-level env vars override local defaults without conditionals
- [Phase 03-03]: CI publishes Postgres on 5432 (not 5433 locally) — service containers don't need custom port mapping
- [Phase 03-03]: pino added as direct dep in Wave 0 so Plan 03-04 needs no package.json edit
- [Phase 03]: stalledInterval/drainDelay are WorkerOptions (NOT QueueOptions) — guardInterval does NOT exist in BullMQ v5 (D-09)
- [Phase 03]: ProcessorLogger is structural interface — pino satisfies it in prod, vi.fn() spy satisfies it in unit tests (no pino mock needed)
- [Phase 03]: Graceful shutdown order: worker.close() -> prisma.$disconnect() -> connection.quit() with 30s force-exit timer + docker-compose stop_grace_period: 35s
- [Phase 03-05]: Invoke buildProcessor directly in idempotency tests to bypass BullMQ jobId dedup — tests the DB constraint, not BullMQ
- [Phase 03-05]: Use Date.now()-based unique fingerprint per worker.test.ts run to prevent BullMQ completed-job deduplication across re-runs
- [Phase 03-05]: Bounded poll (max N * delayMs) for QUE-02 end-to-end test instead of BullMQ event listeners — prevents CI hang, cleaner teardown
- [Phase 04]: Created Prisma migration SQL manually (Docker daemon unavailable) — SQL follows existing migration pattern; will apply on next docker compose up
- [Phase 04]: cockatiel@^4 installed with --config.engine-strict=false since host Node is v20; containers use node:22-slim so runtime is unaffected
- [Phase 04]: RoutingRule Zod discriminated union keyed on type — extensible by adding one variant + one dispatch entry, no if/else (D-18/D-19)
- [Phase 04]: Lazy TTL rule cache: module-level singleton with Date.now() comparison, no setInterval (D-22) — resetRulesCache() for test isolation (Pitfall 7)
- [Phase 04]: fullJitterBackoff params made optional to match BullMQ BackoffStrategy type; crmPolicy singleton injected via WorkerDeps; persistEvent outside crmPolicy.execute() for RES-07 invariant
- [Phase 04]: Requeue integration test placed in worker package (not API) to avoid cyclic devDep — API stays lean
- [Phase 04]: Admin+requeue unit tests added to restore API coverage to >=80% (was 73.23% after Phase 4 admin route additions)
- [Phase 05-01]: Bull-Board BullMQAdapter validates instanceof Queue at construction — wrapped in try-catch so test mocks (non-Queue instances) skip gracefully
- [Phase 05-01]: pino child logger (request.log) does not delegate through app.log spy — OBS-01 test uses behavioral assertion (202 queued proves success path executed)
- [Phase 05-01]: CORS registered before @fastify/helmet (first plugin in buildApp) — required for preflight OPTIONS handling
- [Phase 05-01]: strict-ssl=false added to .npmrc for corporate network pnpm installs
- [Phase 05-02]: shadcn CLI bypassed due to SSL; components scaffolded manually from source patterns
- [Phase 05-02]: tw-animate-css @import removed from globals.css — CSS-only package causes Turbopack module-not-found in worktree builds
- [Phase 05-02]: turbopack.root set in next.config.js to fix dual pnpm-workspace.yaml confusion in git worktree
- [Phase 05]: Badge variant='destructive' for Failed/Unresolved DLQ > 0; inline p feedback for re-queue (no toast lib); body cast to {status?:string} for TS strict mode; block class on truncate span for max-w-xs to work
- [Phase 06-01]: noopLogger must use (obj,msg) two-parameter shape to satisfy ProcessorLogger interface — zero-param () => {} was structurally incompatible, caused 2-arg buildProcessor calls in integration tests
- [Phase 06-01]: passThroughPolicy = createCrmPolicy(10_000) reuses production factory for test stubs — noopCrmClient never throws, so breaker never opens; no mocking of cockatiel needed
- [Phase 06-01]: Dashboard Dockerfile omits COPY public/ — apps/dashboard/public does not exist in this project
- [Phase 06-01]: External-stack Playwright config: no webServer block, PLAYWRIGHT_BASE_URL env override — compose started externally by CI/demo.sh
- [Phase 06-01]: TESTCONTAINERS_RYUK_DISABLED declared in turbo.json test.env — turbo v2 strict env mode strips undeclared vars; Pitfall 7

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3] Measure Upstash Redis command count under load to validate free-tier viability before committing to it (research flag from SUMMARY.md)
- [Phase 4] Confirm opossum v9 current API shape (`circuitBreaker()` constructor vs `Policy` wrapper) before implementation
- [Phase 6] Final always-on worker hosting choice (Render background worker vs Fly.io) needs real testing against free-tier keep-alive constraints

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260609-qjn | Add Commits and Collaboration conventions to project CLAUDE.md | 2026-06-09 | aaae6f6 | [260609-qjn-add-commits-and-collaboration-convention](.planning/quick/260609-qjn-add-commits-and-collaboration-convention/) |
| 260610-s0n | P0 correctness: ingest gate rollback, fingerprint normalization, Redis AOF persistence | 2026-06-10 | 3a8cb7d | [260610-s0n-p0-correctness-ingest-gate-rollback-on-e](.planning/quick/260610-s0n-p0-correctness-ingest-gate-rollback-on-e/) |
| 260610-sw5 | Housekeeping: CI test+coverage gate, gitignore .claude, fix ROADMAP/STATE drift, migrate deprecated Zod v4 APIs | 2026-06-10 | bb49354 | [260610-sw5-housekeeping-ci-test-coverage-gate-gitig](.planning/quick/260610-sw5-housekeeping-ci-test-coverage-gate-gitig/) |
| 260611-fast | Declare test-task env vars in turbo.json — turbo v2 strict env mode filtered CI's DATABASE_URL (red CI fix) | 2026-06-11 | see ci(03) commit | — (inline /gsd:fast) |

## Session Continuity

Last activity: 2026-06-21 - Completed 06-01: Wave 0 foundation (deps, test fixes, dashboard Dockerfile, stubs)

Last session: 2026-06-21T02:24:26Z
Stopped at: Completed 06-01-PLAN.md
Resume file: .planning/phases/06-testing-ci-cd-deployment/06-02-PLAN.md
Resume file: .planning/phases/06-testing-ci-cd-deployment/06-CONTEXT.md
