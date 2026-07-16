---
phase: 03-worker-core-idempotent-persistence
plan: 05
subsystem: testing
tags: [vitest, integration-tests, bullmq, postgres, prisma, idempotency, concurrency]

requires:
  - phase: 03-worker-core-idempotent-persistence (03-04)
    provides: buildProcessor, buildWorker, persistEvent — the functions under integration test
  - phase: 03-worker-core-idempotent-persistence (03-01)
    provides: createPrismaClient factory, ON CONFLICT DO NOTHING idempotent insert
  - phase: 03-worker-core-idempotent-persistence (03-02)
    provides: createRedisConnection, createEventsQueue factories
  - phase: 03-worker-core-idempotent-persistence (03-03)
    provides: vitest.setup.ts env vars, CI service containers (postgres:16 + redis:7)

provides:
  - SC-2 proof: 50 concurrent identical processEvent calls -> exactly 1 events row (IDM-02)
  - SC-3 proof: re-processing persisted event completes without duplicate (IDM-03)
  - QUE-02 proof: real BullMQ worker consumes job from queue and persists row
  - SC-4/QUE-03 proof: concurrency 10 + pool max 12 surfaces no pool exhaustion
  - 100% line coverage on apps/worker, repo-wide CI gate green
  - 03-VALIDATION.md signed off: nyquist_compliant: true, wave_0_complete: true

affects:
  - phase 04 (resilience/circuit-breaker) — integration test patterns established here
  - CI pipeline — repo-wide gate now validated with worker integration tests

tech-stack:
  added: []
  patterns:
    - "Direct processor invocation (bypass BullMQ jobId dedup) to test DB constraint idempotency"
    - "Bounded DB poll (max N * delayMs) for worker end-to-end tests instead of event listeners"
    - "Unique fingerprint per test run via Date.now() to avoid BullMQ completed-job dedup"
    - "worker.close() in afterEach BEFORE connection.quit() in afterAll (Pitfall 4)"
    - "Promise.all with distinct fingerprints for pool-exhaustion guard"

key-files:
  created:
    - apps/worker/tests/integration/idempotency.test.ts
    - apps/worker/tests/integration/worker.test.ts
    - apps/worker/tests/integration/concurrency.test.ts
  modified:
    - packages/queue/tests/factory.test.ts
    - .planning/phases/03-worker-core-idempotent-persistence/03-VALIDATION.md

key-decisions:
  - "Invoke buildProcessor directly in idempotency tests to bypass BullMQ jobId dedup — tests the DB constraint, not BullMQ"
  - "Use Date.now()-based unique fingerprint per worker.test.ts run to prevent BullMQ completed-job deduplication across runs"
  - "Bounded poll (max 10 x 500ms = 5s) for QUE-02 end-to-end test — prevents CI hang, clean failure on timeout"
  - "Add factory invocation tests to @omnisync/queue to meet 80% threshold (pre-existing gap, fixed in Task 3)"

requirements-completed: [QUE-02, QUE-03, IDM-02, IDM-03]

duration: 25min
completed: 2026-06-11
---

# Phase 3 Plan 05: Integration Tests Summary

**Three Vitest integration suites prove SC-2/SC-3/SC-4/QUE-02 against real Postgres + Redis: 50 identical concurrent events -> 1 row, re-queue absorbed, end-to-end worker->row, concurrency 10 with no pool exhaustion — all at 100% worker coverage.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-11T01:09:00Z
- **Completed:** 2026-06-11T01:35:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- SC-2/IDM-02: 50 concurrent processEvent calls with identical fingerprint produce exactly 1 row — PostgreSQL `ON CONFLICT DO NOTHING` absorbs all duplicates silently
- SC-3/IDM-03: re-processing an already-persisted event twice resolves without error and count stays 1 (re-queue idempotent)
- QUE-02: buildWorker consumes a real BullMQ job and persists exactly 1 row, verified by a bounded `prisma.event.count` poll (max 10 × 500ms)
- SC-4/QUE-03: 20 distinct jobs at logical concurrency 10 against pool max 12 all persist with no pool-exhaustion error matching `/too many clients|timeout|pool/`
- Full repo-wide CI gate green: 25 API tests, queue (100%), db (98%), worker (100%)
- 03-VALIDATION.md signed off: `nyquist_compliant: true`, `wave_0_complete: true`

## Task Commits

Each task was committed atomically:

1. **Task 1: SC-2 + SC-3 idempotency tests** — `cbcc627` (test)
2. **Task 2: worker.test.ts + concurrency.test.ts** — `f09eb68` (test)
3. **Fix: unique fingerprint per run to prevent BullMQ dedup** — `237342e` (fix)
4. **Task 3: full suite green + queue coverage + validation sign-off** — `2329843` (feat)

## Files Created/Modified

- `apps/worker/tests/integration/idempotency.test.ts` — SC-2 (50 concurrent identical) + SC-3 (re-queue) proofs
- `apps/worker/tests/integration/worker.test.ts` — QUE-02 end-to-end queue->worker->row with bounded DB poll
- `apps/worker/tests/integration/concurrency.test.ts` — SC-4 pool-exhaustion guard (20 distinct jobs, concurrency 10)
- `packages/queue/tests/factory.test.ts` — added factory invocation tests (createRedisConnection + createEventsQueue) to reach 80% threshold
- `.planning/phases/03-worker-core-idempotent-persistence/03-VALIDATION.md` — signed off complete

## Decisions Made

- Invoke `buildProcessor` directly in idempotency tests (NOT through BullMQ) to test the PostgreSQL constraint directly — BullMQ's own `jobId` dedup would mask the test's purpose
- Use `Date.now().toString(16).padStart(64, "0").slice(-64)` as unique fingerprint per test run — BullMQ `removeOnComplete: { age: 3600 }` keeps completed jobs for 1 hour, causing deduplication on re-runs with a static jobId
- Bounded poll (`for` loop, max 10 × 500ms) instead of BullMQ `completed` event listener — avoids listener setup/teardown overhead, matches the `prisma.event.count` pattern from idempotency tests, and guarantees no CI hang
- Cleanup ordering: `worker.close()` in `afterEach` runs BEFORE `connection.quit()` in `afterAll` — matches research Pitfall 4 to prevent listener/socket leaks

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BullMQ jobId deduplication causing worker.test.ts to fail on re-run**
- **Found during:** Task 2 verification (full coverage run)
- **Issue:** Static fingerprint `"d".repeat(64)` used as BullMQ `jobId`. After the first test run, the completed job remains in Redis for up to 1 hour (`removeOnComplete: { age: 3600 }`). Subsequent runs with the same `jobId` are silently deduplicated — the job is never re-enqueued, so the worker never processes it and `prisma.event.count` stays at 0.
- **Fix:** Generate fingerprint as `Date.now().toString(16).padStart(64, "0").slice(-64)` — unique per test process invocation, always a valid 64-hex string
- **Files modified:** `apps/worker/tests/integration/worker.test.ts`
- **Verification:** Test passes on first and second run consecutively
- **Committed in:** `237342e`

**2. [Rule 2 - Missing Coverage] Added factory invocation tests to @omnisync/queue**
- **Found during:** Task 3 (repo-wide coverage run)
- **Issue:** `packages/queue` had 33.33% line coverage — `createRedisConnection` and `createEventsQueue` bodies uncovered — causing the 80% threshold to fail. This pre-existed Plans 03-01 through 03-04 but was not surfaced until the repo-wide `pnpm test -- --coverage` was run in this plan.
- **Fix:** Added `describe("factory invocation")` block calling both factories and closing connections in `afterAll`
- **Files modified:** `packages/queue/tests/factory.test.ts`
- **Verification:** Queue package coverage 33.33% → 100%; repo-wide gate green
- **Committed in:** `2329843`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing coverage)
**Impact on plan:** Both fixes necessary for test correctness and CI gate compliance. No scope creep.

## Issues Encountered

- Initial pnpm install in the worktree was required to resolve dependencies (node_modules not pre-populated). Packages needed to be built before vitest could resolve workspace imports.
- `@omnisync/queue` 80% coverage threshold was a pre-existing gap not caught by earlier plans' isolated test runs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 complete: all 5 plans executed, all SC automated, 100% worker coverage, repo-wide gate green
- Phase 4 (resilience — circuit breaker, retry, DLQ routing) ready to proceed
- Integration test patterns established: bounded poll, direct processor invocation, unique fingerprint per run
- No blockers

---
*Phase: 03-worker-core-idempotent-persistence*
*Completed: 2026-06-11*

## Self-Check: PASSED

- FOUND: apps/worker/tests/integration/idempotency.test.ts
- FOUND: apps/worker/tests/integration/worker.test.ts
- FOUND: apps/worker/tests/integration/concurrency.test.ts
- FOUND: .planning/phases/03-worker-core-idempotent-persistence/03-VALIDATION.md
- FOUND: .planning/phases/03-worker-core-idempotent-persistence/03-05-SUMMARY.md
- FOUND: cbcc627 (test(03-05): SC-2 + SC-3 idempotency integration tests)
- FOUND: f09eb68 (test(03-05): QUE-02 end-to-end worker test + SC-4)
- FOUND: 237342e (fix(03-05): unique fingerprint per worker.test.ts run)
- FOUND: 2329843 (feat(03-05): full suite green — queue coverage fix + validation sign-off)
