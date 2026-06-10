---
phase: quick-260610-s0n
plan: 01
type: quick
tags: [p0-correctness, idempotency, fingerprint, redis-persistence, durability]
dependency_graph:
  requires: [02-03-PLAN.md (ingest route + fingerprint + dedup gate)]
  provides: [gate-rollback on queue.add failure, canonical ISO fingerprinting, Redis AOF persistence]
  affects: [apps/api/src/routes/ingest.ts, apps/api/src/lib/fingerprint.ts, docker-compose.yml]
tech_stack:
  patterns: [gate-then-enqueue-with-rollback, try/catch-rethrow, best-effort-del, Date.toISOString normalization, Redis AOF + named volume]
key_files:
  modified:
    - apps/api/src/app.ts
    - apps/api/src/routes/ingest.ts
    - apps/api/tests/routes/ingest.test.ts
    - apps/api/src/lib/fingerprint.ts
    - apps/api/tests/lib/fingerprint.test.ts
    - docker-compose.yml
decisions:
  - Gate-then-enqueue rollback swallows redis.del failure to avoid masking the original queue.add error
  - occurredAt normalization uses Date.toISOString() — no guard needed because callers always pass Zod-validated datetime strings
  - Null-byte collision test updated to use valid ISO timestamps (original used synthetic "a"/"b"/"c"/"d" strings incompatible with normalization)
  - Redis AOF uses redis:7 default /data dir (no explicit --dir); named volume redisdata persists it
metrics:
  duration: ~12 min
  completed: 2026-06-10
  tasks_completed: 3
  files_modified: 6
---

# Quick Task 260610-s0n: P0 Correctness — Ingest Gate Rollback, Fingerprint Normalization, Redis Persistence

**One-liner:** Three P0 correctness fixes closing silent-loss and dedup-miss windows in the Phase 02 ingestion path before Phase 3 (worker/DB persistence) builds on top.

## What Was Done

### Task 1: Gate-then-enqueue rollback (IDM-01 / ING-05)

**Problem:** `queue.add` had no error handling. If it threw after the Redis `SET NX` idem gate was set, the key stayed locked for 24 h — sender's retry was rejected as `"duplicate"` while no job was ever enqueued. Silent data loss.

**Fix:**
- Widened `AppDeps.redis` from `Pick<Redis, "set">` to `Pick<Redis, "set" | "del">` in `app.ts`
- Wrapped `queue.add` in try/catch in `ingest.ts`; on catch: call `redis.del(\`idem:${fingerprint}\`)` (swallowed with `.catch(() => undefined)`) then rethrow so the centralized error handler returns 500
- Added `del: vi.fn()` to the mock, fixed missing `afterEach` import, added gate-rollback test verifying 500 + del called + retry returns 202 queued

**Commits:** `8da595f`

### Task 2: Fingerprint timestamp normalization (D-15 dedup hardening)

**Problem:** ISO-8601 forms `"T10:00:00Z"`, `"T10:00:00.000Z"`, and `"T10:00:00+00:00"` all represent the same instant but produced different SHA-256 hashes — meaning the same event sent twice with different timestamp representations would be enqueued twice instead of being deduplicated.

**Fix:**
- `buildFingerprint` now calls `new Date(occurredAt).toISOString()` before the hash, canonicalizing all equivalent ISO forms to `"T10:00:00.000Z"`
- Known-value anchor `7ed400d9932c822806865fbc3658051dcffc88718ad40ea0039690d284d0ea74` unchanged — the anchor input was already canonical
- Stale `// Placeholder: will be replaced with the actual hash during GREEN` comment removed
- Updated null-byte collision test to use valid ISO timestamps (the original used `"d"` as occurredAt, which is invalid after normalization is applied — this was a Rule 1 auto-fix)
- Added two new tests: ISO equivalence (Z / .000Z / +00:00 identical) and genuine-instant-difference (10→11h differs)

**Commits:** `eb6a4d9`

### Task 3: Redis AOF + named volume (OPS-02)

**Problem:** Without persistence, `docker compose restart redis` wiped all BullMQ queued jobs — directly contradicting the core "no accepted event is ever silently lost" guarantee.

**Fix:**
- Appended `--appendonly yes` to the redis command (keeping `--maxmemory-policy noeviction` intact)
- Added `volumes: - redisdata:/data` to redis service
- Registered `redisdata:` under top-level `volumes:` block

**Commits:** `3a8cb7d`

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` — all API tests | 25/25 passed (22 existing + 3 new) |
| `pnpm --filter @omnisync/api typecheck` | Exit 0, no errors |
| `docker compose config` | Parses cleanly; appendonly + redisdata confirmed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Null-byte collision test used non-ISO `occurredAt` values**

- **Found during:** Task 2 GREEN phase
- **Issue:** The existing `prevents field-boundary collisions via null-byte separator` test called `buildFingerprint("a", "b", "c", "d")` where `"d"` is not a valid ISO-8601 datetime. After adding `new Date(occurredAt).toISOString()`, this threw `RangeError: Invalid time value`.
- **Fix:** Updated the test to use `buildFingerprint("a", "bc", "d", "2026-06-09T10:00:00.000Z")` vs `buildFingerprint("ab", "c", "d", "2026-06-09T10:00:00.000Z")` — the null-byte collision property is still tested (different `source`+`eventType` boundary), just with a valid ISO `occurredAt` argument. The plan's rationale is correct: callers always pass Zod-validated `datetime()` strings in production.
- **Files modified:** `apps/api/tests/lib/fingerprint.test.ts`
- **Commit:** `eb6a4d9` (bundled with Task 2)

## Self-Check: PASSED

- `apps/api/src/app.ts` — modified, committed in `8da595f`
- `apps/api/src/routes/ingest.ts` — modified, committed in `8da595f`
- `apps/api/tests/routes/ingest.test.ts` — modified, committed in `8da595f`
- `apps/api/src/lib/fingerprint.ts` — modified, committed in `eb6a4d9`
- `apps/api/tests/lib/fingerprint.test.ts` — modified, committed in `eb6a4d9`
- `docker-compose.yml` — modified, committed in `3a8cb7d`
