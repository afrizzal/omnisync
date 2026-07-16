---
phase: 04
plan: 04
subsystem: worker
tags: [resilience, circuit-breaker, dlq, backoff, routing-rules, worker-integration]
dependency_graph:
  requires: [04-01, 04-02, 04-03]
  provides: [live-worker-resilience, crm-circuit-breaker, routing-rule-application, dlq-wiring]
  affects: [apps/worker/src/worker.ts, apps/worker/src/processor/event.processor.ts, apps/worker/src/normalizer/normalize.ts, apps/worker/src/index.ts, packages/queue/src/index.ts]
tech_stack:
  added: []
  patterns: [singleton-circuit-breaker, backoff-strategy-on-worker, persist-outside-breaker, lazy-ttl-rule-cache]
key_files:
  created: []
  modified:
    - apps/worker/src/normalizer/normalize.ts
    - apps/worker/tests/unit/normalize.test.ts
    - apps/worker/src/processor/event.processor.ts
    - apps/worker/tests/unit/processor.test.ts
    - apps/worker/src/worker.ts
    - apps/worker/src/index.ts
    - packages/queue/src/index.ts
decisions:
  - "fullJitterBackoff parameters changed to optional (_type?, _err?) to match BullMQ's BackoffStrategy type"
  - "crmPolicy singleton created once in index.ts, injected via WorkerDeps to accumulate consecutive failures across BullMQ attempts (Pitfall 1)"
  - "persistEvent called OUTSIDE crmPolicy.execute() so Postgres failures never consult or trip the CRM breaker (Pitfall 4 / RES-07)"
metrics:
  duration_minutes: 14
  completed_date: "2026-06-13"
  tasks_completed: 3
  files_changed: 7
---

# Phase 4 Plan 04: Wire Resilience into the Worker Summary

## One-liner

Full-jitter backoff + DLQ handler + CRM circuit breaker + lazy routing-rule injection wired into the live BullMQ worker pipeline with RES-07 proven: Postgres failures bypass the CRM breaker entirely.

## What Was Built

This plan integrated all Wave 0 resilience primitives (plans 04-01 through 04-03) into the live worker pipeline:

**Task 1 (04-04-01): Routing rules at normalize() seam**
- `normalize(job, rules?: RoutingRule[])` now accepts an optional rules array (default `[]` = pass-through)
- `applyRules()` is called at the Phase 4 seam (D-20) before canonical envelope fields are extracted
- 2 existing normalize tests stay green; 1 new test proves phone_normalize_e164 rule transforms `payload.phone`

**Task 2 (04-04-02): CRM breaker + rule cache in the processor**
- `buildProcessor()` extended with `crmClient`, `crmPolicy`, and `ttlMs` parameters
- `getActiveRules(prisma, ttlMs)` called for lazy TTL-cached rule loading before normalize (RTE-02)
- `persistEvent()` called OUTSIDE `crmPolicy.execute()` — critical Pitfall 4 compliance (RES-07)
- `crmPolicy.execute(() => crmClient.sync(normalized))` called AFTER successful persist (RES-04/05)
- New RES-07 test: 6 Postgres failures don't open the breaker; 7th call still fails with DB error, NOT BrokenCircuitError

**Task 3 (04-04-03): backoffStrategy + DLQ handler in buildWorker; CRM singletons in index.ts**
- `WorkerDeps` extended with `crmClient: CrmClient`, `crmPolicy: CircuitBreakerPolicy`, `ttlMs: number`
- `settings.backoffStrategy: fullJitterBackoff` registered on the WORKER (not Queue) — Pitfall 2 compliance (RES-01)
- `worker.on("failed")` wired to `buildDlqHandler` for Postgres mirror of exhausted jobs (RES-02/03)
- `stalledInterval: 300_000` and `drainDelay: 30` preserved from Phase 3 D-09
- `index.ts` creates `crmPolicy` and `crmClient` ONCE as singletons (Pitfall 1)

## Verification Results

```
pnpm --filter @omnisync/worker typecheck  → EXIT 0
pnpm --filter @omnisync/worker test (unit) → 36/36 passed
grep backoffStrategy worker.ts            → FOUND
grep worker.on("failed") worker.ts        → FOUND
grep crmPolicy.execute event.processor.ts → FOUND
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed fullJitterBackoff parameter types to match BullMQ BackoffStrategy**
- **Found during:** Task 3 (typecheck after writing worker.ts)
- **Issue:** `fullJitterBackoff` had `_type: string, _err: Error` (required) but BullMQ's `BackoffStrategy` type declares `type?: string, err?: Error` (optional). TypeScript rejected the assignment.
- **Fix:** Changed signature to `_type?: string, _err?: Error` in `packages/queue/src/index.ts`
- **Files modified:** `packages/queue/src/index.ts`
- **Commit:** 4056b3e (bundled with task 3 commit since it was required for the task to typecheck)

## Key Decisions

1. **fullJitterBackoff param types**: Made optional to match `BackoffStrategy` — no behavioral change (extra args were already ignored)
2. **crmPolicy singleton**: Created once in `index.ts` and injected via `WorkerDeps`; ensures consecutive CRM failure counts accumulate across multiple BullMQ retry attempts (Pitfall 1 from RESEARCH.md)
3. **persistEvent outside breaker**: The critical RES-07 invariant — Postgres failures propagate directly to BullMQ without ever consulting the CRM circuit breaker

## Test Coverage

| Test File | Tests | Status |
|-----------|-------|--------|
| normalize.test.ts | 3 (2 existing + 1 new rule test) | PASS |
| processor.test.ts | 4 (3 existing + 1 RES-07 test) | PASS |
| All other unit tests | 29 | PASS |
| **Total** | **36** | **PASS** |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 04-04-01 | f94a425 | feat(04): apply routing rules at normalize() seam (RTE-01/RTE-02) |
| 04-04-02 | 2fbcc44 | feat(04): wire CRM circuit breaker + rule cache into processor; persist outside breaker (RES-04/05/07) |
| 04-04-03 | 4056b3e | feat(04): register full-jitter backoff + DLQ handler in buildWorker; inject CRM singletons (RES-01/RES-02) |

## Self-Check: PASSED

- [x] `apps/worker/src/normalizer/normalize.ts` — exists, contains `applyRules`
- [x] `apps/worker/src/processor/event.processor.ts` — exists, contains `crmPolicy.execute`
- [x] `apps/worker/src/worker.ts` — exists, contains `backoffStrategy: fullJitterBackoff` and `worker.on("failed"`
- [x] `apps/worker/src/index.ts` — exists, contains `createCrmPolicy` and `new HttpCrmClient`
- [x] `packages/queue/src/index.ts` — exists, params now optional
- [x] Commits f94a425, 2fbcc44, 4056b3e all exist in git history
