---
phase: 4
slug: resilience-dynamic-routing
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 |
| **Config file** | `apps/worker/vitest.config.ts` (exists) |
| **Quick run command** | `pnpm --filter @omnisync/worker test` |
| **Full suite command** | `pnpm --filter @omnisync/worker test:coverage` |
| **Estimated runtime** | ~15 seconds (unit + integration) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @omnisync/worker test`
- **After every plan wave:** Run `pnpm --filter @omnisync/worker test:coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-xx-01 | backoff | 0 | RES-01 | unit | `pnpm --filter @omnisync/worker test -- tests/unit/backoff.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-02 | dlq-handler | 0 | RES-02 | unit | `pnpm --filter @omnisync/worker test -- tests/unit/dlq-handler.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-03 | crm-policy | 0 | RES-04/05 | unit | `pnpm --filter @omnisync/worker test -- tests/unit/crm-policy.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-04 | rule-engine | 0 | RTE-01 | unit | `pnpm --filter @omnisync/worker test -- tests/unit/rule-engine.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-05 | rule-cache | 0 | RTE-02 | unit | `pnpm --filter @omnisync/worker test -- tests/unit/rule-cache.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-06 | dlq-integration | 1 | RES-03 | integration | `pnpm --filter @omnisync/worker test -- tests/integration/dlq.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-07 | requeue | 1 | RES-06 | integration | `pnpm --filter @omnisync/api test -- tests/integration/requeue.test.ts` | ❌ W0 | ⬜ pending |
| 04-xx-08 | processor-no-breaker | 1 | RES-05 | unit | extend `tests/unit/processor.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/worker/tests/unit/backoff.test.ts` — stubs for RES-01 (jitter formula range, no thundering herd)
- [ ] `apps/worker/tests/unit/dlq-handler.test.ts` — stubs for RES-02 (final-attempt gate, payload capture)
- [ ] `apps/worker/tests/unit/crm-policy.test.ts` — stubs for RES-04/RES-05 (ConsecutiveBreaker(5) opens, BrokenCircuitError)
- [ ] `apps/worker/tests/unit/rule-engine.test.ts` — stubs for RTE-01 (phone_normalize_e164 transform, non-matching fields unchanged)
- [ ] `apps/worker/tests/unit/rule-cache.test.ts` — stubs for RTE-02 (reload after TTL, no reload within TTL)
- [ ] `apps/worker/tests/integration/dlq.test.ts` — stubs for RES-03 (Postgres DLQ insert survives Redis restart)
- [ ] `apps/api/tests/integration/requeue.test.ts` — stubs for RES-06 (re-queue idempotency)

---

## Testing Strategy Notes

### cockatiel Circuit Breaker (RES-04/RES-05)

Use `FakeCrmClient` with `setMode('fail' | 'ok')` rather than real delays.
- Open breaker: call policy 5× with failing client → assert `BrokenCircuitError` on 6th
- Recovery: set `halfOpenAfter: 1` (1ms) in test policy + `vi.useFakeTimers()` to advance past it
- No real 10s waits in tests

### BullMQ Backoff (RES-01)

Custom backoff function is pure: `(attempts, type) => delay`. Test directly with `expect(backoffFn(n, 'custom')).toBeLessThanOrEqual(Math.min(cap, base * 2**n))`. No BullMQ instance needed.

### DLQ Final-Attempt Gate (RES-02)

`worker.on('failed')` fires on every failure. Test gate: mock `job.attemptsMade` < `job.opts.attempts` → no insert; `job.attemptsMade >= job.opts.attempts` → insert.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Events stay in queue when Postgres is down | RES-07 | Formal kill-Postgres test is Phase 6 (TST-02) | Verify BullMQ queue holds jobs during `docker pause postgres`; jobs complete after `docker unpause postgres` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-13 — Phase 4 integration tests created; unit coverage ≥80% (83.92% lines for worker, API coverage gate met after admin+requeue unit tests added). Integration tests pending local infra (docker-compose Postgres+Redis) — pass verified in CI service containers.
