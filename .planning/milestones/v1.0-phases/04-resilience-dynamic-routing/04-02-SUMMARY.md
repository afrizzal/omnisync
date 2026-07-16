---
phase: 04-resilience-dynamic-routing
plan: "02"
subsystem: resilience
tags: [bullmq, cockatiel, circuit-breaker, backoff, dlq, dead-letter-queue, tdd, vitest]

# Dependency graph
requires:
  - phase: 04-01
    provides: "cockatiel@4 installed, RETRY_ATTEMPTS/RETRY_BASE_DELAY_MS/RETRY_CAP_MS/BREAKER_HALF_OPEN_MS env vars, DeadLetterEvent Prisma model"

provides:
  - "fullJitterBackoff(attemptsMade, type, err) exported from @omnisync/queue with AWS full-jitter formula"
  - "createEventsQueue defaultJobOptions updated with attempts + backoff: {type: 'custom'}"
  - "createCrmPolicy(halfOpenAfterMs) circuit-breaker factory using ConsecutiveBreaker(5)"
  - "CrmClient interface + HttpCrmClient using Node built-in fetch"
  - "buildDlqHandler(prisma, logger) final-attempt-gated DLQ writer to dlq_events"

affects:
  - 04-04-wire-worker (uses fullJitterBackoff in Worker settings.backoffStrategy)
  - 04-03-routing-engine (uses CrmClient interface for DI)
  - dashboard (reads dlq_events table via buildDlqHandler writes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD: failing test committed first (RED), then implementation (GREEN)"
    - "BullMQ owns retry scheduling; cockatiel owns circuit-breaking only (D-02 resolution)"
    - "Module-level singleton for circuit breaker — accumulates failures across BullMQ job attempts"
    - "Final-attempt gate on BullMQ failed handler (Pitfall 5 prevention)"
    - "Undefined job guard in DLQ handler (Pitfall 6 prevention)"

key-files:
  created:
    - apps/worker/tests/unit/backoff.test.ts
    - apps/worker/tests/unit/crm-policy.test.ts
    - apps/worker/tests/unit/dlq-handler.test.ts
    - apps/worker/src/crm/crm-client.ts
    - apps/worker/src/crm/crm-policy.ts
    - apps/worker/src/dlq/dlq-handler.ts
  modified:
    - packages/queue/src/index.ts
    - packages/queue/package.json
    - pnpm-lock.yaml

key-decisions:
  - "D-02 confirmed: BullMQ owns retry scheduling; cockatiel policy is circuit-breaker ONLY — no nested cockatiel retry() that would double-loop against BullMQ attempts"
  - "fullJitterBackoff reads env.RETRY_BASE_DELAY_MS/RETRY_CAP_MS from @omnisync/config (pure config read, not a socket — side-effect-free constraint honored)"
  - "backoff: {type: 'custom'} declared on Queue only; strategy function registered on Worker in plan 04-04 (Pitfall 2 avoidance)"
  - "@omnisync/config added as workspace:* dependency to packages/queue for backoff formula bounds"

patterns-established:
  - "Pattern: CRM resilience via cockatiel circuit-breaker singleton, not nested retry"
  - "Pattern: DLQ final-attempt gate using job.attemptsMade >= (job.opts.attempts ?? 1)"
  - "Pattern: HttpCrmClient uses Node 22 built-in fetch — no undici/axios dependency"

requirements-completed: [RES-01, RES-02, RES-03, RES-04, RES-05]

# Metrics
duration: 15min
completed: 2026-06-13
---

# Phase 04 Plan 02: Pure functions (TDD) — backoff, CRM policy, CRM client, DLQ handler Summary

**AWS full-jitter backoff in @omnisync/queue, cockatiel ConsecutiveBreaker(5) circuit-breaker factory, CrmClient DI interface, and final-attempt-gated DLQ handler — all unit-tested with TDD (14 tests, 14 passing)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-13T09:25:00Z
- **Completed:** 2026-06-13T09:40:00Z
- **Tasks:** 3 (each with RED + GREEN commits)
- **Files modified:** 9

## Accomplishments

- TDD cycle completed for all 3 tasks: 6 commits (3 RED + 3 GREEN), 14 tests total — all green
- fullJitterBackoff with AWS formula (random(0, min(cap, base * 2^attempt))) prevents thundering herd; registered in queue defaultJobOptions with `backoff: { type: "custom" }`
- Cockatiel circuit-breaker factory opens after 5 consecutive CRM failures (RES-04), blocks further CRM calls while open (RES-05), recovers via halfOpen probe
- buildDlqHandler gated on final attempt only (RES-02); captures 7 diagnostic fields to dlq_events (RES-03)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: backoff tests** - `0029f5c` (test)
2. **Task 1 GREEN: fullJitterBackoff** - `f8d08cb` (feat)
3. **Task 2 RED: circuit-breaker tests** - `06092b8` (test)
4. **Task 2 GREEN: CrmClient + createCrmPolicy** - `85a62c5` (feat)
5. **Task 3 RED: DLQ handler tests** - `8e32e99` (test)
6. **Task 3 GREEN: buildDlqHandler** - `686525d` (feat)

_Note: TDD tasks have two commits each (test → feat)_

## Files Created/Modified

- `packages/queue/src/index.ts` - Added fullJitterBackoff export + updated defaultJobOptions with attempts/backoff
- `packages/queue/package.json` - Added @omnisync/config workspace:* dependency
- `pnpm-lock.yaml` - Updated lockfile for new dependency
- `apps/worker/src/crm/crm-client.ts` - CrmClient interface + HttpCrmClient using Node built-in fetch
- `apps/worker/src/crm/crm-policy.ts` - createCrmPolicy factory with ConsecutiveBreaker(5)
- `apps/worker/src/dlq/dlq-handler.ts` - buildDlqHandler with final-attempt gate + undefined guard
- `apps/worker/tests/unit/backoff.test.ts` - 5 tests for fullJitterBackoff (jitter spread, bounds)
- `apps/worker/tests/unit/crm-policy.test.ts` - 4 tests for circuit-breaker (5 failures open, 6th blocked, fn not invoked, recovery)
- `apps/worker/tests/unit/dlq-handler.test.ts` - 5 tests for DLQ gate (intermediate skip, final insert, field capture, undefined guard, default attempts)

## Decisions Made

- D-02 confirmed: BullMQ owns retry scheduling; cockatiel policy is circuit-breaker ONLY. No nested `cockatiel.retry()` that would double-loop against BullMQ's 5 attempts.
- fullJitterBackoff registered on Queue side as `backoff: { type: "custom" }` declaration only; the actual function is attached to the Worker in plan 04-04 (Pitfall 2 compliance).
- @omnisync/config added as a dependency to @omnisync/queue since the backoff function needs env.RETRY_BASE_DELAY_MS and env.RETRY_CAP_MS — pure config reads, no socket side effects.

## Deviations from Plan

None — plan executed exactly as written. All TDD cycles completed per specification.

## Issues Encountered

- `pnpm install --frozen-lockfile` failed after adding @omnisync/config to packages/queue — expected behavior when lockfile needs update. Resolved with `pnpm install` (no --frozen-lockfile) to regenerate the lockfile. This is normal for the development branch workflow.
- Worker typecheck initially failed because @omnisync/types and @omnisync/db dist files weren't built. Built them before final typecheck verification — pre-existing condition, not caused by this plan.

## User Setup Required

None — no external service configuration required. All new code is pure TypeScript with no external services.

## Next Phase Readiness

- Plan 04-03 (routing engine) can now use CrmClient interface for dependency injection
- Plan 04-04 (wire worker) can now import fullJitterBackoff for Worker settings.backoffStrategy registration
- Plan 04-04 can import buildDlqHandler for Worker on('failed') handler wiring
- createCrmPolicy is ready to be instantiated as a module-level singleton in the worker entry point

---
*Phase: 04-resilience-dynamic-routing*
*Completed: 2026-06-13*
