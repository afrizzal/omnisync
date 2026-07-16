---
phase: 04-resilience-dynamic-routing
plan: 03
subsystem: worker-normalizer
tags: [routing-rules, zod, dispatch-table, tdd, ttl-cache, rte-01, rte-02]
dependency_graph:
  requires: [04-01]
  provides: [routing-rule-types, rule-engine, rule-cache]
  affects: [04-04]
tech_stack:
  added: []
  patterns: [zod-discriminated-union, dispatch-table, lazy-ttl-cache, vi-fake-timers]
key_files:
  created:
    - packages/types/src/routing.ts
    - apps/worker/src/normalizer/rule-engine.ts
    - apps/worker/src/normalizer/rule-cache.ts
    - apps/worker/tests/unit/rule-engine.test.ts
    - apps/worker/tests/unit/rule-cache.test.ts
  modified:
    - packages/types/src/index.ts
decisions:
  - "RoutingRule uses Zod discriminated union keyed on `type` — adding a new rule type requires one union variant + one dispatch-table entry + one test, no if/else refactoring (D-18/D-19)"
  - "Lazy TTL cache uses module-level singleton with Date.now() comparison — no setInterval (D-22), zero idle DB/Redis pressure"
  - "Indonesian phone normalization uses hand-rolled regex (no libphonenumber-js) — avoids a 40KB dependency; interface is stable for future swap"
  - "resetRulesCache() exported as explicit test-isolation helper (Pitfall 7) — prevents module-level state leaks between unit tests"
metrics:
  duration_minutes: 16
  completed_date: "2026-06-13"
  tasks_completed: 2
  files_created: 5
  files_modified: 1
---

# Phase 04 Plan 03: Routing Rules (TDD) — Zod Union, Dispatch Engine, Lazy TTL Cache Summary

## One-liner

Zod discriminated union + dispatch-table rule engine with Indonesian E.164 phone normalization and lazy TTL cache (no setInterval), built TDD with 13 green unit tests.

## What Was Built

### Task 04-03-01: RTE-01 — RoutingRule Zod union + dispatch-table rule engine

- `packages/types/src/routing.ts` — Zod `discriminatedUnion("type", [...])` with a single `phone_normalize_e164` variant `{ type, field }`. Extensible: adding a new rule type = one new object in the array, no if/else refactoring.
- `packages/types/src/index.ts` — barrel re-export of `./routing.js` added.
- `apps/worker/src/normalizer/rule-engine.ts` — `applyRules(rules, payload)` backed by `ruleHandlers: Record<string, RuleHandler>` dispatch table. Unknown rule types and missing fields are no-ops (resilient). Returns a new payload object; never mutates input.
- `apps/worker/tests/unit/rule-engine.test.ts` — 8 tests covering: Indonesian leading-0 normalization, missing-field no-op, non-string passthrough, unparseable passthrough, unknown-type no-op, multi-rule order + immutability, Zod parse success/failure.

### Task 04-03-02: RTE-02 — lazy TTL rule cache

- `apps/worker/src/normalizer/rule-cache.ts` — `getActiveRules(prisma, ttlMs)` with module-level `RulesCacheState | null` singleton. Queries `prisma.routingRule.findMany({ where: { enabled: true }, orderBy: { priority: "desc" } })` only when cache is null OR `Date.now() - loadedAt >= ttlMs`. `resetRulesCache()` clears the singleton for test isolation.
- `apps/worker/tests/unit/rule-cache.test.ts` — 5 tests covering: cold-start findMany, cache-hit within TTL, reload after TTL using `vi.useFakeTimers()` + `vi.advanceTimersByTime()`, resetRulesCache clears state, correct findMany arguments.

## Verification Results

```
pnpm --filter @omnisync/worker test -- tests/unit/rule-engine.test.ts  → 8 passed
pnpm --filter @omnisync/worker test -- tests/unit/rule-cache.test.ts   → 5 passed
pnpm --filter @omnisync/types typecheck                                 → exit 0
pnpm --filter @omnisync/worker typecheck                               → exit 0
```

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Zod discriminated union over manual schema | Type-safe, parse-only validation; runtime safe for DB rows cast as `unknown as RoutingRule[]` (trust DB for v1) |
| Dispatch table `Record<string, RuleHandler>` | D-19 compliance: zero if/else; new rule = one key, one test |
| Hand-rolled Indonesian regex, no libphonenumber-js | Avoids 40KB dep for v1 demo; interface is unchanged when production swaps to full library |
| `vi.useFakeTimers()` + `vi.advanceTimersByTime()` | Controls `Date.now()` in the cache module without injecting a clock parameter; cleaner API |
| Module-level singleton + `resetRulesCache()` | D-22 lazy TTL (no setInterval); Pitfall 7 test-isolation via explicit reset in `beforeEach` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test data typo in rule-engine test (Test 6)**
- **Found during:** Task 04-03-01 GREEN phase
- **Issue:** Test expected `"+6211111111"` for input `"0811111111"` — this is incorrect. `0811111111` (leading 0 + 9 digits) correctly normalizes to `+62811111111`. The plan's sample test values used a different phone number.
- **Fix:** Updated expected value to `"+62811111111"` to match correct E.164 transformation.
- **Files modified:** `apps/worker/tests/unit/rule-engine.test.ts`
- **Commit:** 5a7eced (updated in same GREEN commit)

**2. [Rule 3 - Blocking] Missing dist files for dependent packages in worktree**
- **Found during:** Task 04-03-02 acceptance check (typecheck)
- **Issue:** Fresh worktree had no dist/ outputs for `@omnisync/db`, `@omnisync/queue`, `@omnisync/config` — worker typecheck failed with `Cannot find module` errors.
- **Fix:** Built all three packages (`pnpm --filter @omnisync/db build`, `queue build`, `config build`) before final typecheck. Dist files are gitignored so this is expected for fresh worktrees.
- **Files modified:** None (build artifacts, gitignored)
- **Commit:** N/A (build-time fix, not committed)

## Known Stubs

None. Both rule-engine and rule-cache are fully functional. The rule-cache returns `rows as unknown as RoutingRule[]` — this is an explicit design decision (trust DB for v1; Zod parse on the cast is a future hardening item noted in the plan as out-of-scope for this plan).

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 04-03-01 RED | (test commit) | test(04): add failing routing-rule engine tests — E.164 + dispatch table (RTE-01) |
| 04-03-01 GREEN | 5a7eced | feat(04): RoutingRule Zod union + dispatch-table rule engine (RTE-01) |
| 04-03-02 RED | (test commit) | test(04): add failing lazy-TTL rule-cache tests (RTE-02) |
| 04-03-02 GREEN | e68cd1b | feat(04): lazy TTL routing-rule cache + resetRulesCache (RTE-02) |

## Self-Check: PASSED
