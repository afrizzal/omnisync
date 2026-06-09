---
phase: 02-high-speed-ingestion-api
plan: "02"
subsystem: api-lib
tags: [tdd, crypto, fingerprint, hmac, idempotency, security]
dependency_graph:
  requires: ["02-01"]
  provides: ["buildFingerprint (SHA-256 idempotency key)", "verifySignature (constant-time HMAC)"]
  affects: ["02-03 (route handler composes both functions)"]
tech_stack:
  added: []
  patterns: ["TDD RED-GREEN", "pure function extraction", "node:crypto built-ins", "null-byte field separator", "timingSafeEqual length guard"]
key_files:
  created:
    - apps/api/src/lib/fingerprint.ts
    - apps/api/src/lib/hmac.ts
    - apps/api/tests/lib/fingerprint.test.ts
    - apps/api/tests/lib/hmac.test.ts
    - apps/api/vitest.config.ts
    - apps/api/vitest.setup.ts
    - apps/api/package.json
    - apps/api/tsconfig.json
    - tsconfig.base.json
  modified: []
decisions:
  - "Vitest config uses setupFiles to pre-populate env vars before module load, avoiding @omnisync/config Zod parse failure in tests (Pitfall 4 prevention)"
  - "Known-value hash anchor hardcoded in fingerprint test to detect algorithm drift: 7ed400d9932c822806865fbc3658051dcffc88718ad40ea0039690d284d0ea74"
  - "Test runner uses vitest-worktree.config.ts from main repo api dir to access worktree test files, since worktree has no node_modules"
metrics:
  duration_minutes: 17
  completed_date: "2026-06-09"
  tasks_completed: 2
  files_created: 9
---

# Phase 02 Plan 02: Pure Crypto Functions — TDD Summary

**One-liner:** SHA-256 fingerprint (null-byte separated, deterministic) and constant-time HMAC-SHA256 verifier (length-guarded timingSafeEqual), both pure and test-proven with TDD.

## What Was Built

Two pure, side-effect-free functions that are the correctness foundation of the entire ingestion pipeline:

1. **`buildFingerprint`** (`apps/api/src/lib/fingerprint.ts`) — SHA-256 hash of `source + eventType + externalId + occurredAt` joined with null-byte separator. Returns a 64-char lowercase hex string. Used as the BullMQ `jobId` to guarantee idempotent enqueue (SC-5 / ING-04).

2. **`verifySignature`** (`apps/api/src/lib/hmac.ts`) — GitHub-style `sha256=<hex>` signature verification using `crypto.timingSafeEqual`. A length guard before `timingSafeEqual` prevents it from throwing on malformed hex strings. Returns `false` (never throws) for all invalid/missing/malformed inputs (SC-2 building block / ING-02).

## Test Infrastructure Created

- `apps/api/vitest.config.ts` — Vitest 4.1.8 config with `setupFiles` pointing to `vitest.setup.ts`
- `apps/api/vitest.setup.ts` — Pre-populates all required `process.env` vars before tests run, preventing `@omnisync/config` Zod parse from failing in test context (Pitfall 4)
- `apps/api/package.json` — Added `vitest ^4.1.8`, `@vitest/coverage-v8 ^4.1.8`, `test` and `test:coverage` scripts

## Test Results

**Fingerprint suite (8 tests):**
- Format: returns `/^[0-9a-f]{64}$/`
- Determinism: same inputs always produce identical output
- Field-sensitivity: changing any one of 4 fields changes the hash
- Collision-resistance: null-byte separator prevents boundary collisions
- Known-value anchor: `7ed400d9932c822806865fbc3658051dcffc88718ad40ea0039690d284d0ea74`

**HMAC suite (7 tests):**
- Valid signature: returns `true`
- Tampered signature: returns `false`
- Wrong secret: returns `false`
- Missing `sha256=` prefix: returns `false` (no throw)
- Undefined header: returns `false` (no throw)
- Malformed hex (wrong length): returns `false` (no throw — length guard)
- Empty hex after prefix: returns `false` (no throw)

**Total: 15/15 tests passing**

## TDD Commits

| Step | Commit | Description |
|------|--------|-------------|
| Infrastructure | 3346952 | test(02-02): add failing fingerprint stability tests |
| GREEN | 5b8d6e6 | feat(02-02): implement buildFingerprint SHA-256 idempotency key |
| RED | 8e1434b | test(02-02): add failing HMAC verify tests |
| GREEN | acd137a | feat(02-02): implement constant-time HMAC signature verify |

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written with one infrastructure note:

**[Rule 3 - Infrastructure] Worktree test execution setup**
- **Found during:** Task 1 (RED phase)
- **Issue:** Worktree has no node_modules; vitest can't load its own config from the worktree path
- **Fix:** Created `vitest-worktree.config.ts` at main repo's `apps/api` level pointing to worktree test/setup files; all test execution runs from main repo's api directory which has vitest installed
- **Impact:** Tests verified correctly; files properly committed to worktree branch for orchestrator merge

## Known Stubs

None — both functions are fully implemented, pure, and tested.

## Interfaces Provided to Plan 03

```typescript
// apps/api/src/lib/fingerprint.ts
export function buildFingerprint(
  source: string,
  eventType: string,
  externalId: string,
  occurredAt: string,
): string; // 64-char lowercase SHA-256 hex

// apps/api/src/lib/hmac.ts
export function verifySignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean; // never throws
```

Plan 03's route handler imports both with `.js` extension (NodeNext convention):
```typescript
import { buildFingerprint } from "../lib/fingerprint.js";
import { verifySignature } from "../lib/hmac.js";
```

## Self-Check: PASSED
