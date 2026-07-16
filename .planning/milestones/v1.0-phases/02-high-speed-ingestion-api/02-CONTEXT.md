# Phase 2: High-Speed Ingestion API - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the HTTP entry point for OmniSync: a Fastify 5 endpoint that validates HMAC signatures, validates payload shape with Zod, generates a deterministic SHA-256 fingerprint, gates concurrent duplicates via Redis SET NX, enqueues the raw payload via BullMQ, and returns HTTP 202 before any DB write occurs.

This phase builds NO worker processing logic (Phase 3), NO resilience patterns (Phase 4), NO dashboard UI (Phase 5). The bar is: webhooks can enter the system with all five success criteria from the roadmap passing live.

Requirements covered: **ING-01, ING-02, ING-03, ING-04, ING-05, IDM-01**

</domain>

<decisions>
## Implementation Decisions

### Webhook Secret Management
- **D-01:** Per-source HMAC secrets — four separate env vars: `WEBHOOK_SECRET_SHOPEE`, `WEBHOOK_SECRET_TOKOPEDIA`, `WEBHOOK_SECRET_META_ADS`, `WEBHOOK_SECRET_CRM`. Validated fail-fast at startup via Zod env schema (all four required, not lazily per-request).
- **D-02:** The HMAC verify function looks up the secret by the `:source` route param. Unknown source or missing secret → respond `401`. Never leak whether the source is valid; never `500`.
- **D-03:** Signature header format: `X-Webhook-Signature: sha256=<hex>` (GitHub-style). HMAC-SHA256 computed over the **raw request body bytes** (capture `rawBody` in Fastify — not parsed/re-serialized JSON, or signatures won't match). Compare using `crypto.timingSafeEqual` (constant-time, no plain `===`). Malformed/missing header or missing `sha256=` prefix → `401`.

### Error Response Shape
- **D-04:** Consistent error envelope across the entire API. Base shape: `{ error: 'ERROR_CODE', message: string }`.
  - `401` → `{ error: 'INVALID_SIGNATURE', message: '...' }`
  - `422` → `{ error: 'VALIDATION_ERROR', message: '...', issues: [{ field, message }] }` — map Zod issues via `z.flattenError()` (Zod v4 API). Never leak raw Zod internals or stack traces.
- **D-05:** Implement the error envelope **once** via a centralized `fastify.setErrorHandler()` (DRY, covers 401/404/422/500). Error codes are stable/machine-readable; `message` is human-readable.

### Fastify App Factory
- **D-06:** Export a `buildApp({ queue, redis })` factory function (injectable dependencies) so the app runs in tests without real Redis/Postgres. The real entrypoint (`src/index.ts`) calls `buildApp` with live instances. Enables Fastify `app.inject()` route tests with mocked queue/redis.

### `/healthz` Endpoint
- **D-07:** Include `GET /healthz` in Phase 2. Returns `{ status: 'ok', uptime: process.uptime() }` with HTTP 200. Unauthenticated, exempt from HMAC checking. Static liveness only — no Redis/DB probe (liveness ≠ readiness; probing on the keep-alive endpoint causes flapping on free-tier hiccups).
- **D-08:** A separate `GET /readyz` readiness endpoint (with Redis/DB probe) is deferred to Phase 6 alongside deployment.

### Tests in Phase 2
- **D-09:** Include Vitest unit tests for pure functions: HMAC signature verify and SHA-256 fingerprint (assert fingerprint stability across identical re-deliveries — SC-5).
- **D-10:** Include Fastify route integration tests via `app.inject()` (zero real infra — BullMQ `queue.add` and Redis SET NX gate are mocked/stubbed):
  - `202` on valid payload (SC-1)
  - `401` on tampered/missing `X-Webhook-Signature` (SC-2)
  - `422` with `issues[]` on schema-invalid payload (SC-3)
  - `202` with `status: 'duplicate'` on second identical webhook (SC-4)
- **D-11:** Deferred to Phase 6: ≥80% coverage gate, real concurrent-dedup integration test (TST-03), kill-Postgres test (TST-02).

### Stack / Packages (carrying from Phase 1)
- **D-12:** Fastify 5 (already decided Phase 1). Add `@fastify/sensible` (HTTP error helpers) and `@fastify/helmet` (security headers). Wired via Fastify plugin system.
- **D-13:** Use `@omnisync/types` `InboundEvent` Zod schema for payload validation (already defined — `source`, `eventType`, `externalId`, `occurredAt`, `payload`).
- **D-14:** Use `@omnisync/queue` `eventsQueue` for `Queue.add()` with `jobId` set to the fingerprint (BullMQ deduplicates by jobId). Use `@omnisync/config` env loader as the base; add the four new `WEBHOOK_SECRET_*` vars to its schema.
- **D-15:** Fingerprint = SHA-256 of `source + event_type + external_id + occurred_at` (from roadmap SC-5). Implemented as a pure function in `apps/api/src/lib/fingerprint.ts`.
- **D-16:** Redis SET NX gate (IDM-01): `SET fingerprint 1 NX EX 86400` (24-hour TTL so the gate self-cleans). If SET NX returns null (key exists) → return `202` with `{ status: 'duplicate' }` immediately, no enqueue.

### Claude's Discretion
- Exact Fastify plugin file layout (`plugins/`, `routes/`, `lib/` directory structure).
- TSX devDependency version, vitest config file location.
- How rawBody capture is implemented in Fastify (addContentTypeParser or preParsing hook).
- Exact env var names for PORT / HOST (standard Node.js conventions).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Foundation (Phase 1 decisions — locked)
- `.planning/phases/01-foundation-local-infra/01-CONTEXT.md` — All Phase 1 locked decisions (monorepo layout, ESM, Zod v4, BullMQ config constants, env loader pattern)
- `.planning/research/STACK.md` — Current package versions (Fastify 5.8, BullMQ 5.77, ioredis 5.10.1, Zod 4, Prisma 7, Node 22)
- `.planning/research/ARCHITECTURE.md` — Fingerprint strategy, idempotency pattern, Fastify deliberate choice rationale
- `.planning/research/PITFALLS.md` — ESM trap, rawBody capture gotcha, Redis noeviction

### Requirements
- `.planning/REQUIREMENTS.md` — ING-01 through ING-05 (ingestion), IDM-01 (Redis SET NX gate)
- `.planning/ROADMAP.md` — Phase 2 success criteria (exact SC-1 through SC-5)

### Existing Shared Packages (read before implementing)
- `packages/types/src/event.ts` — `InboundEvent` Zod schema (already defined — reuse, don't redefine)
- `packages/queue/src/index.ts` — `eventsQueue`, `connection`, `QUEUE_NAME`, `queueOptions` (already wired)
- `packages/config/src/env.ts` — Existing Zod env schema (extend with `WEBHOOK_SECRET_*` vars, don't replace)
- `apps/api/src/index.ts` — Current stub (replace body, keep SIGINT/SIGTERM shutdown)
- `apps/api/package.json` — Current deps (add fastify, @fastify/sensible, @fastify/helmet, vitest)

No external ADRs — requirements and phase context fully capture all decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/types` → `InboundEvent` Zod schema: already defines `source` (enum), `eventType`, `externalId`, `occurredAt` (datetime), `payload` (record). Use directly for SC-3 validation.
- `packages/queue` → `eventsQueue`: `Queue` instance ready for `eventsQueue.add(jobName, data, { jobId: fingerprint })`. Connection and tuned intervals already configured.
- `packages/config` → `env` loader: Zod-validated env with `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `NODE_ENV`. Extend to add `WEBHOOK_SECRET_*` vars.

### Established Patterns
- **Zod v4 import:** `import { z } from 'zod/v4'` (not plain `'zod'`) — enforced across the repo.
- **ESM-native:** All files use `import`/`export` (no `require`). `"type": "module"` in all package.json files.
- **Fail-fast env validation:** `process.exit(1)` on bad config at startup — established by `packages/config`. Extend this pattern for `WEBHOOK_SECRET_*`.
- **BullMQ jobId dedup:** `eventsQueue.add(name, data, { jobId: fingerprint })` — BullMQ silently ignores duplicate jobIds. Combined with Redis SET NX gate for concurrent in-flight dedup (D-16).

### Integration Points
- `apps/api/src/index.ts` is the Fastify entrypoint — replace the stub body with `buildApp()` call and `app.listen()`.
- The `eventsQueue.add()` call in the route handler connects directly to the BullMQ queue that Phase 3's worker will consume.
- `packages/config/src/env.ts` must be extended (not replaced) to add `WEBHOOK_SECRET_*` vars.

</code_context>

<specifics>
## Specific Ideas

- **rawBody capture:** Must capture raw request bytes before Fastify parses JSON — use `addContentTypeParser` or a `preParsing` hook. This is a known Fastify gotcha: re-serializing a parsed JSON object before HMAC compare will fail on non-canonical JSON inputs.
- **timingSafeEqual:** Node.js built-in `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` — requires equal-length buffers; normalize hex to same length before compare.
- **z.flattenError():** Zod v4 API for flattening errors to `{ fieldErrors: { [field]: string[] }, formErrors: string[] }` — use `fieldErrors` entries to build `issues: [{ field, message }]`.
- **buildApp factory pattern:** Enables `vitest` tests to call `buildApp({ queue: mockQueue, redis: mockRedis })` and use `app.inject({ method: 'POST', url: '/ingest/SHOPEE', ... })` — no real Redis/Postgres needed for SC-1 through SC-4 route tests.
</specifics>

<deferred>
## Deferred Ideas

- `GET /readyz` readiness endpoint (Redis + DB probe) — **Phase 6** with deployment/UptimeRobot wiring.
- Strict ≥80% coverage gate — **Phase 6**.
- Real concurrent-dedup integration test (TST-03) — **Phase 6** (needs real Redis).
- Kill-Postgres integration test (TST-02) — **Phase 6** (needs Testcontainers).
- Mock webhook senders (one per source channel) — **Phase 6** demo script (OPS-04).
- `bull-board` queue browser — may add in Phase 3 or Phase 6 alongside worker.

None — discussion stayed within Phase 2 ingestion boundary.

</deferred>

---

*Phase: 02-high-speed-ingestion-api*
*Context gathered: 2026-06-09*
