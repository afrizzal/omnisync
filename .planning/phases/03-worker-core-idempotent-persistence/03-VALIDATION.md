---
phase: 3
slug: worker-core-idempotent-persistence
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x (`@vitest/coverage-v8`) |
| **Config file** | `apps/worker/vitest.config.ts` |
| **Quick run command** | `pnpm --filter @omnisync/worker test` |
| **Full suite command** | `pnpm --filter @omnisync/worker test:coverage` |
| **Estimated runtime** | ~6–10 seconds (integration tests hit local Postgres + Redis) |

**Integration infrastructure:** docker-compose services (Postgres `localhost:5433`, Redis `localhost:6379`) — already running locally. Testcontainers deferred to Phase 6 (TST-02). CI has `services:` block in `.github/workflows/ci.yml` (added Plan 03-03).

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @omnisync/worker run typecheck` (fast; catches type drift)
- **After every plan wave:** Run `pnpm --filter @omnisync/worker test:coverage` (full suite + coverage)
- **Before `/gsd:verify-work`:** Full suite green + coverage ≥ 80% lines (repo-wide CI gate, wired 2026-06-10)
- **Max feedback latency:** ~10 seconds (actual: 6s)

---

## Per-Task Verification Map

> Requirement-level map below; per-task `{N}-PP-TT` rows are filled by the planner/executor as plans are created. No 3 consecutive tasks may lack an automated verify.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| QUE-02 | Worker process consumes job and persists event row | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/worker.test.ts` | ✅ |
| QUE-03 | Configurable concurrency — N jobs processed in parallel | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/concurrency.test.ts` | ✅ |
| QUE-04 | Normalize produces canonical envelope (externalId + occurredAt columns) | Unit | `pnpm --filter @omnisync/worker test -- tests/unit/normalize.test.ts` | ✅ |
| IDM-02 | 50 identical jobs → exactly 1 events row (DB constraint absorbs duplicates) | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/idempotency.test.ts` | ✅ |
| IDM-03 | Re-queuing an already-persisted event completes without duplicate | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/idempotency.test.ts` | ✅ |
| D-10 (poison guard) | Invalid `job.data` fails immediately with structured error | Unit | `pnpm --filter @omnisync/worker test -- tests/unit/processor.test.ts` | ✅ |
| D-09 (no guardInterval) | `packages/queue` exports contain no `guardInterval` key | Unit | `pnpm --filter @omnisync/queue test` | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Success Criteria Coverage

| SC | Criterion | Test | Type |
|----|-----------|------|------|
| SC-1 | Valid job enqueued → persisted within seconds (separate Docker service) | `docker-compose up worker` + POST /ingest + DB query (manual demo); persistence path covered by integration | Manual (Docker aspect) + Integration |
| SC-2 | 50 identical webhooks → exactly 1 row | `tests/integration/idempotency.test.ts` — 50 concurrent `processEvent()` calls → `prisma.event.count()` === 1 | ✅ Integration |
| SC-3 | Re-queue after persistence → completes, no duplicate | Same file — `processEvent` twice with same fingerprint → count still 1 | ✅ Integration |
| SC-4 | `WORKER_CONCURRENCY` configurable, no pool exhaustion | `tests/integration/concurrency.test.ts` — concurrency=10, assert no "Max clients"/pool-timeout error | ✅ Integration |

---

## Wave 0 Requirements

- [x] `apps/worker/vitest.config.ts` — mirrors `apps/api/vitest.config.ts`
- [x] `apps/worker/vitest.setup.ts` — pre-populates env vars (add `WORKER_CONCURRENCY=5`)
- [x] `apps/worker/tests/unit/normalize.test.ts` — normalize function unit tests
- [x] `apps/worker/tests/unit/processor.test.ts` — processor with mocked prisma (incl. D-10 poison guard)
- [x] `apps/worker/tests/integration/idempotency.test.ts` — SC-2/SC-3 concurrent identical jobs
- [x] `apps/worker/tests/integration/concurrency.test.ts` — SC-4 pool-exhaustion guard
- [x] `apps/worker/package.json` — add `vitest`, `@vitest/coverage-v8`, `bullmq`, `ioredis`, `zod` deps + `test`/`test:coverage` scripts
- [x] `packages/queue` unit test asserting no `guardInterval` export (D-09)
- [x] `.github/workflows/ci.yml` — add `postgres` + `redis` `services:` block for integration tests
- [x] Wave 0 smoke: verify Prisma `$executeRaw` enum cast (`'COMPLETED'::"EventStatus"`) compiles + runs before full processor build (Open Question #1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Worker runs as a **separate Docker service** | SC-1 (QUE-02) | Docker service topology can't be asserted from a Vitest process | `docker-compose up -d` → confirm `worker` container is `Up`; POST a webhook to the API; query `events` table → row present within seconds |

*Persistence/idempotency/concurrency behaviors all have automated integration coverage; only the Docker-service-topology aspect of SC-1 is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 40s
- [x] `nyquist_compliant: true` set in frontmatter (after planner wires per-task map)

**Approval:** All SC automated except SC-1 Docker-service topology (manual demo). 100% worker coverage; repo-wide gate green (25 API tests + queue + db + worker all passing).
