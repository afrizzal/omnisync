---
phase: 02-high-speed-ingestion-api
verified: 2026-06-09T13:20:00Z
status: passed
score: 6/6 must-haves verified
gaps: []
human_verification:
  - test: "POST /ingest/:source latency under local load"
    expected: "HTTP 202 in low single-digit milliseconds (SC-1 ING-01)"
    why_human: "Cannot measure real end-to-end HTTP latency in inject() tests; requires curl against a live process"
---

# Phase 2: High-Speed Ingestion API Verification Report

**Phase Goal:** Webhooks can enter OmniSync — a Fastify endpoint validates signatures, rejects malformed payloads, generates a deterministic fingerprint, gates duplicates via Redis SET NX, enqueues the job, and returns HTTP 202 before any DB write occurs.
**Verified:** 2026-06-09T13:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /ingest/:source with valid HMAC + well-formed payload returns HTTP 202 | VERIFIED | `ingest.test.ts` SC-1: response.statusCode 202, status "queued" — 22/22 tests pass |
| 2 | Tampered/missing X-Webhook-Signature returns HTTP 401 and no job enqueued | VERIFIED | `ingest.test.ts` SC-2: mockQueue.add not called on 401 responses |
| 3 | Schema-invalid payload returns HTTP 422 with structured error body (issues[]) | VERIFIED | `ingest.test.ts` SC-3: 422 with error "VALIDATION_ERROR" and non-empty issues array |
| 4 | Second identical webhook returns 202 with status "duplicate" and does NOT enqueue | VERIFIED | `ingest.test.ts` SC-4: mockRedis.set returns null → 202 duplicate, queue.add called only once |
| 5 | SHA-256 fingerprint of source+eventType+externalId+occurredAt is present on every enqueued job and stable | VERIFIED | `fingerprint.test.ts`: determinism, field-sensitivity, collision-resistance, known-value anchor all pass; `ingest.ts` line 50: jobId set to fingerprint |
| 6 | GET /healthz returns 200 with { status:"ok", uptime } and is exempt from HMAC | VERIFIED | `health.test.ts`: response.statusCode 200, body.status "ok" |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/app.ts` | buildApp factory + AppDeps interface | VERIFIED | Exports `buildApp(deps: AppDeps)` and `AppDeps` interface; registers helmet→sensible→raw-body→errorHandler→routes in correct order; no `app.listen()` call |
| `apps/api/src/routes/ingest.ts` | POST /ingest/:source five-step hot path | VERIFIED | 53 lines; all 5 steps present: HMAC verify, Zod validate, buildFingerprint, redis.set NX, queue.add with jobId |
| `apps/api/src/routes/health.ts` | GET /healthz liveness | VERIFIED | Returns `{ status: "ok", uptime: process.uptime() }` |
| `apps/api/src/lib/fingerprint.ts` | buildFingerprint pure function (SHA-256 hex) | VERIFIED | createHash("sha256"), null-byte join, exports buildFingerprint |
| `apps/api/src/lib/hmac.ts` | verifySignature pure function (constant-time) | VERIFIED | timingSafeEqual, length guard, startsWith("sha256="), never throws |
| `apps/api/src/lib/secrets.ts` | getSecretForSource(source) mapping | VERIFIED | Maps all 4 sources; returns null for unknown (`?? null`) |
| `apps/api/src/plugins/errorHandler.ts` | Centralized setErrorHandler | VERIFIED | 5xx → INTERNAL_ERROR envelope; 4xx → code passthrough |
| `apps/api/src/index.ts` | Live entrypoint wiring buildApp + listen | VERIFIED | buildApp({ queue: eventsQueue, redis: connection }), app.listen(), SIGINT/SIGTERM shutdown |
| `apps/api/src/types/fastify.d.ts` | FastifyRequest.rawBody Buffer augmentation | VERIFIED | `rawBody?: Buffer` declared in `declare module "fastify"` |
| `apps/api/vitest.config.ts` | Vitest config with setupFiles + include glob | VERIFIED | setupFiles: ["./vitest.setup.ts"], include: ["tests/**/*.test.ts"] |
| `apps/api/vitest.setup.ts` | Env stubs for all required vars | VERIFIED | All 4 WEBHOOK_SECRET_* + DATABASE_URL + DIRECT_URL + REDIS_URL stubbed |
| `packages/config/src/env.ts` | Env schema with 4 WEBHOOK_SECRET_* fields | VERIFIED | All 4 keys present as z.string().min(1); IIFE + z.treeifyError preserved |
| `apps/api/tests/lib/fingerprint.test.ts` | ING-04 stability + determinism tests | VERIFIED | 8 tests: format, determinism, field-sensitivity (×4), collision-resistance, known-value anchor |
| `apps/api/tests/lib/hmac.test.ts` | ING-02 verify/tamper/malformed tests | VERIFIED | 7 tests: valid, tampered, wrong-secret, no-prefix, undefined, malformed-length, empty-after-prefix |
| `apps/api/tests/routes/ingest.test.ts` | SC-1/2/3/4 + ING-05 route tests via app.inject() | VERIFIED | 6 tests: SC-1 202 queued, SC-2 401 (tampered + missing), SC-3 422 issues[], SC-4 202 duplicate, unknown source 401 |
| `apps/api/tests/routes/health.test.ts` | GET /healthz smoke test | VERIFIED | 1 test: 200 with status "ok" and numeric uptime |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ingest.ts` | `hmac.ts` | verifySignature(rawBody, secret, signature) | WIRED | Line 17+22: `const rawBody = request.rawBody`; `instanceof Buffer` guard; verifySignature called |
| `ingest.ts` | `fingerprint.ts` | buildFingerprint(source, eventType, externalId, occurredAt) | WIRED | Line 40: call present over validated fields |
| `ingest.ts` | redis (injected) | redis.set(key, "1", "EX", 86400, "NX") | WIRED | Line 44: SET NX gate; null return → 202 duplicate |
| `ingest.ts` | queue (injected) | queue.add("process-event", data, { jobId: fingerprint }) | WIRED | Line 50: jobId = fingerprint; called only when gate passes |
| `index.ts` | `app.ts` | buildApp({ queue: eventsQueue, redis: connection }) | WIRED | Line 9: live wiring in entrypoint |
| `ingest.test.ts` | `app.ts` | app.inject() with mocked queue/redis | WIRED | buildApp({ queue: mockQueue, redis: mockRedis }) in beforeEach |
| `vitest.config.ts` | `vitest.setup.ts` | setupFiles array reference | WIRED | setupFiles: ["./vitest.setup.ts"] |

---

### Data-Flow Trace (Level 4)

This phase has no persistent data rendering — the hot path is a write path (enqueue only) with no DB reads on the request path. Level 4 data-flow trace is not applicable: the route intentionally produces no database reads (ING-05 requirement). The queue.add call is the terminal data sink.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ingest.ts` | `parsed.data` (validated event) | Zod InboundEvent.safeParse(request.body) | Yes — real request body | FLOWING |
| `ingest.ts` | `fingerprint` | buildFingerprint over parsed.data fields | Yes — deterministic SHA-256 | FLOWING |
| `ingest.ts` | `gate` (Redis NX result) | mockRedis.set in tests; real redis.set in prod | Yes (mocked in tests, real in prod) | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 22 tests pass (SC-1..SC-4 + ING-05 + fingerprint + HMAC) | `pnpm --filter @omnisync/api exec vitest run` | 22 passed, 4 files | PASS |
| TypeScript compiles clean (after `pnpm -r build`) | `pnpm --filter @omnisync/api typecheck` | 0 errors | PASS |
| buildFingerprint returns 64-char lowercase hex | fingerprint.test.ts | Passes /^[0-9a-f]{64}$/ | PASS |
| verifySignature never throws on malformed input | hmac.test.ts | All 7 cases pass including malformed-length and undefined | PASS |

**Note on build dependency:** `packages/config/dist/` is gitignored (standard monorepo practice). A fresh clone must run `pnpm -r build` or use turbo (`turbo typecheck`) before per-package typechecks resolve cross-package types. `turbo.json` correctly declares `"typecheck": { "dependsOn": ["^build"] }`. This is not a gap.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ING-01 | 02-03 | HTTP POST returns 202 in low single-digit ms, before any processing | SATISFIED | SC-1 test: 202 response, no synchronous DB write on path |
| ING-02 | 02-02, 02-03 | HMAC/signature validation — rejects invalid signatures | SATISFIED | verifySignature unit tests (7 cases); SC-2 route tests (2 cases); 401 on tampered/missing sig |
| ING-03 | 02-03 | Zod payload shape validation — rejects malformed events with 4xx | SATISFIED | SC-3: 422 VALIDATION_ERROR with non-empty issues[] |
| ING-04 | 02-02 | Deterministic SHA-256 fingerprint (source+event_type+external_id+occurred_at) | SATISFIED | buildFingerprint unit tests (8 cases) including known-value anchor and collision-resistance |
| ING-05 | 02-03 | Enqueue validated payload, never persist/process synchronously on request path | SATISFIED | ingest.ts contains no @omnisync/db import; queue.add is the only write; SC-1 confirms no Prisma |
| IDM-01 | 02-01, 02-03 | Redis SET NX in-flight gate prevents duplicate concurrent enqueues | SATISFIED | SC-4: second identical webhook → 202 duplicate, queue.add not called a second time |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps ING-01 through ING-05 and IDM-01 to Phase 2. No additional Phase 2 requirements found in REQUIREMENTS.md. All 6 requirements accounted for.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned all phase 2 source files. No TODOs, FIXMEs, placeholder returns, or hardcoded empty data flows detected in production paths. The `vitest.setup.ts` stubs are test-only values (not production stubs).

**Minor observations (non-blocking):**
- `fingerprint.test.ts` line 54-56: The known-value anchor test has a comment "Placeholder: will be replaced with the actual hash during GREEN" alongside the actual hardcoded value `7ed400d9...`. The comment is stale (the value IS hardcoded), but the assertion is correct — the anchor test passes and serves its collision-detection purpose.
- `ingest.ts` line 44: Redis SET NX argument order is `"EX", 86400, "NX"` (not `"NX", "EX", 86400` as in the plan). This was an intentional auto-fix documented in the SUMMARY — ioredis TypeScript overloads require EX before NX. Semantically equivalent. Not a defect.

---

### Human Verification Required

#### 1. HTTP 202 Latency Under Local Load (ING-01 / SC-1)

**Test:** Start the API with `pnpm --filter @omnisync/api dev`, then run:
```bash
curl -w "%{time_total}\n" -X POST http://localhost:3001/ingest/SHOPEE \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$(echo -n '...' | openssl dgst -sha256 -hmac 'test-secret-shopee' | cut -d' ' -f2)" \
  -d '{"eventType":"order.created","externalId":"ext-1","occurredAt":"2026-06-09T10:00:00.000Z","payload":{}}'
```
**Expected:** HTTP 202 response time < 5ms under low load; < 20ms p99 under moderate load.
**Why human:** app.inject() bypasses real network stack; latency can only be measured against a listening socket with real TCP overhead.

---

### Gaps Summary

No gaps found. All 6 phase success criteria are verified through passing tests, substantive implementations, and correct wiring. The phase goal is achieved.

---

_Verified: 2026-06-09T13:20:00Z_
_Verifier: Claude (gsd-verifier)_
