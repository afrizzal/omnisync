# Phase 2: High-Speed Ingestion API - Research

**Researched:** 2026-06-09
**Domain:** Fastify 5 webhook ingestion — HMAC validation, Zod payload schema, SHA-256 fingerprint, Redis SET NX dedup gate, BullMQ enqueue, Vitest route testing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Webhook Secret Management**
- D-01: Per-source HMAC secrets — four env vars: `WEBHOOK_SECRET_SHOPEE`, `WEBHOOK_SECRET_TOKOPEDIA`, `WEBHOOK_SECRET_META_ADS`, `WEBHOOK_SECRET_CRM`. All four required, validated fail-fast at startup via Zod env schema.
- D-02: HMAC verify looks up secret by `:source` route param. Unknown source or missing secret → 401. Never leak whether source is valid; never 500.
- D-03: Signature header format: `X-Webhook-Signature: sha256=<hex>` (GitHub-style). HMAC-SHA256 over raw request body bytes. Compare with `crypto.timingSafeEqual`. Malformed/missing header or missing `sha256=` prefix → 401.

**Error Response Shape**
- D-04: `{ error: 'ERROR_CODE', message: string }`. 401 → `INVALID_SIGNATURE`, 422 → `VALIDATION_ERROR` with `issues: [{ field, message }]` via `z.flattenError()`. Never leak Zod internals.
- D-05: Implement error envelope once via `fastify.setErrorHandler()`.

**Fastify App Factory**
- D-06: Export `buildApp({ queue, redis })` factory function for test injection. Real entrypoint calls `buildApp` with live instances. Enables `app.inject()` route tests with mocked queue/redis.

**Healthz Endpoint**
- D-07: `GET /healthz` returns `{ status: 'ok', uptime: process.uptime() }` with HTTP 200. Unauthenticated, exempt from HMAC checking. Static liveness only.
- D-08: `GET /readyz` (Redis/DB probe) deferred to Phase 6.

**Tests in Phase 2**
- D-09: Vitest unit tests for pure functions: HMAC signature verify and SHA-256 fingerprint (assert stability across identical re-deliveries).
- D-10: Fastify route integration tests via `app.inject()` (zero real infra — queue.add and Redis SET NX gate are mocked/stubbed):
  - 202 on valid payload (SC-1)
  - 401 on tampered/missing X-Webhook-Signature (SC-2)
  - 422 with issues[] on schema-invalid payload (SC-3)
  - 202 with status: 'duplicate' on second identical webhook (SC-4)
- D-11: Deferred to Phase 6: ≥80% coverage gate, real concurrent-dedup integration test (TST-03), kill-Postgres test (TST-02).

**Stack / Packages**
- D-12: Fastify 5 + `@fastify/sensible` + `@fastify/helmet`. Wired via Fastify plugin system.
- D-13: Use `@omnisync/types` `InboundEvent` Zod schema for payload validation (already defined).
- D-14: Use `@omnisync/queue` `eventsQueue` for `Queue.add()` with `jobId` = fingerprint. Extend `@omnisync/config` env schema (don't replace).
- D-15: Fingerprint = SHA-256 of `source + event_type + external_id + occurred_at`. Pure function in `apps/api/src/lib/fingerprint.ts`.
- D-16: Redis SET NX gate: `SET fingerprint 1 NX EX 86400`. SET NX returns null → return 202 `{ status: 'duplicate' }`, no enqueue.

### Claude's Discretion
- Exact Fastify plugin file layout (`plugins/`, `routes/`, `lib/` directory structure).
- TSX devDependency version, vitest config file location.
- How rawBody capture is implemented in Fastify (addContentTypeParser or preParsing hook).
- Exact env var names for PORT / HOST (standard Node.js conventions).

### Deferred Ideas (OUT OF SCOPE)
- `GET /readyz` readiness endpoint (Redis + DB probe) — Phase 6 with deployment/UptimeRobot wiring.
- Strict ≥80% coverage gate — Phase 6.
- Real concurrent-dedup integration test (TST-03) — Phase 6 (needs real Redis).
- Kill-Postgres integration test (TST-02) — Phase 6 (needs Testcontainers).
- Mock webhook senders (one per source channel) — Phase 6 demo script (OPS-04).
- `bull-board` queue browser — may add in Phase 3 or Phase 6 alongside worker.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ING-01 | System accepts webhook events via HTTP POST and returns 202 in low single-digit ms, before any processing | `buildApp` factory + `fastify.inject()` test confirms sub-ms in-process ACK; no DB write on hot path |
| ING-02 | System validates webhook HMAC/signature and rejects events with an invalid signature | `crypto.timingSafeEqual` + `sha256=` prefix parsing pattern documented in Code Examples |
| ING-03 | System validates payload shape with Zod and rejects malformed events with a structured 4xx error | `InboundEvent` schema reuse + `z.flattenError()` for `issues[]` array — full pattern in Code Examples |
| ING-04 | System computes a deterministic idempotency fingerprint (SHA-256 of source + event_type + external_id + occurred_at) for every accepted event | Pure function, stable across re-deliveries — exact input fields locked by D-15 |
| ING-05 | System enqueues the validated payload and never persists/processes it synchronously on the request path | `eventsQueue.add()` returns before any DB write; API holds no Prisma connection |
| IDM-01 | A fast Redis SET NX in-flight gate prevents duplicate enqueue of concurrent identical events | `SET fingerprint 1 NX EX 86400` pattern — returns null for duplicate; immediate 202 response |
</phase_requirements>

---

## Summary

Phase 2 builds the HTTP entry point for OmniSync: a Fastify 5 route that validates HMAC signatures, validates payloads against the existing `InboundEvent` Zod schema, generates a deterministic SHA-256 fingerprint, gates concurrent duplicates via Redis SET NX, enqueues via `eventsQueue.add()`, and returns HTTP 202 — all without touching PostgreSQL on the hot path.

All technical decisions are locked in CONTEXT.md (D-01 through D-16). The core research confirms that the architecture choices are correct, identifies the rawBody capture pattern as the single highest-risk implementation detail, documents the `buildApp` factory testing pattern, and maps Zod v4's `z.flattenError()` to the required `issues[]` response shape. The `fastify-raw-body` plugin (v5.0.0) is the preferred rawBody approach over a manual `preParsing` hook because it handles stream re-piping and `receivedEncodedLength` tracking automatically.

Phase 1 delivered all shared packages in working state: `@omnisync/types` exports `InboundEvent` and `EventSource` (4-value enum: `SHOPEE`, `TOKOPEDIA`, `META_ADS`, `CRM`), `@omnisync/queue` exports `eventsQueue` and `connection`, `@omnisync/config` exports `env` with `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `NODE_ENV`. Phase 2 only needs to extend the config env schema and add Fastify-layer packages.

**Primary recommendation:** Use `fastify-raw-body` v5.0.0 plugin for rawBody capture (Fastify 5 compatible, handles stream re-piping automatically). Structure the app with `buildApp({ queue, redis })` factory pattern from the start — it is the only way to write the required Vitest route tests without real Redis.

---

## Standard Stack

### Core (all already decided in CONTEXT.md — confirmed against npm registry 2026-06-09)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | 5.8.5 | HTTP server | Already locked Phase 1. v5 = full TS types, Node.js 20+, 5–10% faster than v4 |
| @fastify/sensible | 6.0.4 | HTTP error helpers | `reply.badRequest()`, `reply.notFound()` etc. Standard plugin for clean error replies |
| @fastify/helmet | 13.0.2 | Security headers | One-line hardening. Correct answer to "how do you secure your API?" in interviews |
| fastify-raw-body | 5.0.0 | rawBody capture | Adds `request.rawBody` via preParsing hook. Fastify 5 compatible. Required for HMAC-over-raw-bytes |
| zod (v4 subpath) | 4.4.3 | Payload validation | Already in repo. `import { z } from 'zod/v4'`. `z.flattenError()` maps to `issues[]` shape |
| ioredis | 5.11.1 | Redis SET NX gate | Already in `@omnisync/queue`. Use the same `connection` instance — do not create a second connection |
| bullmq | 5.77.x | Job enqueue | `eventsQueue` already wired in `@omnisync/queue`. Use `eventsQueue.add(name, data, { jobId: fingerprint })` |
| vitest | 4.1.8 | Unit + route tests | No vitest.config.ts exists yet — Wave 0 creates it. Must add to `apps/api/package.json` devDeps |
| @vitest/coverage-v8 | 4.1.8 | Coverage | Same version as vitest |

**Installation (packages to add to `apps/api/package.json`):**
```bash
pnpm --filter @omnisync/api add fastify @fastify/sensible @fastify/helmet fastify-raw-body
pnpm --filter @omnisync/api add -D vitest @vitest/coverage-v8
```

**Version verification:** Confirmed against npm registry on 2026-06-09. ioredis is now at 5.11.1 (up from 5.8.x in STACK.md) but `@omnisync/queue` pins to 5.10.1 for BullMQ type compatibility — do NOT change that pin. Phase 2 does not add ioredis directly; it uses the `connection` object exported from `@omnisync/queue`.

---

## Architecture Patterns

### Recommended Project Structure

```
apps/api/src/
├── index.ts              # Entrypoint: buildApp() + app.listen(). Keep existing SIGINT/SIGTERM
├── app.ts                # buildApp({ queue, redis }) factory — exports FastifyInstance
├── plugins/
│   ├── helmet.ts         # await app.register(helmet)
│   ├── sensible.ts       # await app.register(sensible)
│   ├── rawBody.ts        # await app.register(rawBody, { global: true, encoding: false })
│   └── errorHandler.ts   # app.setErrorHandler() — centralized D-04/D-05 error envelope
├── routes/
│   ├── health.ts         # GET /healthz — D-07
│   └── ingest.ts         # POST /ingest/:source — the hot path
└── lib/
    ├── fingerprint.ts    # Pure function: buildFingerprint(source, eventType, externalId, occurredAt)
    └── hmac.ts           # Pure function: verifySignature(rawBody, secret, header): boolean
```

```
apps/api/src/
  vitest.config.ts        # At apps/api/ level (not repo root)
  tests/
    lib/
      fingerprint.test.ts # D-09: unit test fingerprint stability
      hmac.test.ts        # D-09: unit test signature verify
    routes/
      ingest.test.ts      # D-10: route integration tests via app.inject()
      health.test.ts      # Smoke: /healthz returns 200
```

### Pattern 1: buildApp Factory

**What:** Export a `buildApp({ queue, redis })` function instead of a module-level `fastify()` call. The entrypoint (`index.ts`) calls it with live instances. Tests call it with mocks.

**When to use:** Any time you need route testing without real infrastructure. Required by D-06 and all four D-10 route test scenarios.

```typescript
// apps/api/src/app.ts
import Fastify from 'fastify';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface AppDeps {
  queue: Pick<Queue, 'add'>;
  redis: Pick<Redis, 'set'>;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: true });
  await app.register(import('@fastify/helmet'));
  await app.register(import('@fastify/sensible'));
  await app.register(import('fastify-raw-body'), {
    global: true,
    encoding: false,   // Buffer, not string — required for timingSafeEqual
  });
  // Register error handler
  // Register routes, passing deps
  return app;
}
```

**TypeScript Note:** `fastify-raw-body` v5.0.0 adds `request.rawBody` as `Buffer | string | undefined`. With `encoding: false` it is `Buffer`. You need a type declaration to satisfy TS:

```typescript
// apps/api/src/types/fastify.d.ts
import 'fastify';
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
```

### Pattern 2: HMAC Signature Verification (Pure Function)

**What:** Extract HMAC verify into a pure function in `lib/hmac.ts` so it can be unit-tested without Fastify context.

```typescript
// apps/api/src/lib/hmac.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a GitHub-style "sha256=<hex>" webhook signature.
 * Returns false (never throws) for any malformed input.
 */
export function verifySignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice(7); // strip "sha256="
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

**Timing safety note:** `Buffer.from(hex, 'hex')` produces a 32-byte buffer for valid SHA-256 hex. If `provided` is malformed (wrong length), the `a.length !== b.length` guard prevents `timingSafeEqual` from throwing. Never compare using `===` on hex strings — timing attack vector.

### Pattern 3: SHA-256 Fingerprint (Pure Function)

**What:** Pure function hashing `source + eventType + externalId + occurredAt` with no separators ambiguity risk — use a canonical separator (e.g., `\0`).

```typescript
// apps/api/src/lib/fingerprint.ts
import { createHash } from 'node:crypto';

/**
 * Computes a stable, deterministic fingerprint for an inbound event.
 * Input fields are null-byte separated to prevent field-boundary collisions.
 */
export function buildFingerprint(
  source: string,
  eventType: string,
  externalId: string,
  occurredAt: string,
): string {
  return createHash('sha256')
    .update([source, eventType, externalId, occurredAt].join('\0'))
    .digest('hex');
}
```

**Stability test anchor (D-09 / SC-5):** Same four inputs across multiple calls must always produce the same 64-char hex string. The unit test should assert `buildFingerprint(a,b,c,d) === buildFingerprint(a,b,c,d)` and that it equals a hardcoded known value.

### Pattern 4: Ingest Route with Redis SET NX Gate

**What:** The hot path in `routes/ingest.ts`. The route handler does exactly five things in order: verify HMAC, validate schema, build fingerprint, check Redis NX, enqueue.

```typescript
// apps/api/src/routes/ingest.ts (conceptual — adapt to actual Fastify plugin API)
import { InboundEvent } from '@omnisync/types';
import { z } from 'zod/v4';
import { buildFingerprint } from '../lib/fingerprint.js';
import { verifySignature } from '../lib/hmac.js';
import type { AppDeps } from '../app.js';

export async function ingestRoutes(app: FastifyInstance, { queue, redis }: AppDeps) {
  app.post('/ingest/:source', async (request, reply) => {
    // Step 1: HMAC verify
    const source = (request.params as { source: string }).source;
    const secret = getSecretForSource(source);  // from env; returns null for unknown source
    if (!secret || !verifySignature(request.rawBody!, secret, request.headers['x-webhook-signature'] as string)) {
      return reply.code(401).send({ error: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
    }

    // Step 2: Zod schema validation
    const parsed = InboundEvent.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      const issues = Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
        (msgs ?? []).map((message) => ({ field, message })),
      );
      return reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Invalid payload', issues });
    }

    // Step 3: Fingerprint
    const { eventType, externalId, occurredAt } = parsed.data;
    const fingerprint = buildFingerprint(source, eventType, externalId, occurredAt);

    // Step 4: Redis SET NX dedup gate
    const result = await redis.set(`idem:${fingerprint}`, '1', 'NX', 'EX', 86400);
    if (result === null) {
      return reply.code(202).send({ status: 'duplicate', fingerprint });
    }

    // Step 5: Enqueue
    await queue.add('process-event', { source, payload: parsed.data, fingerprint }, { jobId: fingerprint });
    return reply.code(202).send({ status: 'queued', fingerprint });
  });
}
```

### Pattern 5: Centralized Error Handler (D-04 / D-05)

**What:** A single `setErrorHandler` that catches any error thrown by route handlers and normalizes it to the `{ error, message }` envelope. `@fastify/sensible` errors (like `app.httpErrors.unauthorized()`) are caught here too.

```typescript
// apps/api/src/plugins/errorHandler.ts
app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    request.log.error({ err: error }, 'Unhandled server error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
  // 4xx — pass through structured error from route handlers
  return reply.code(status).send({
    error: (error as any).code ?? 'REQUEST_ERROR',
    message: error.message,
  });
});
```

### Pattern 6: Env Extension for WEBHOOK_SECRET_*

**What:** Extend (not replace) `packages/config/src/env.ts` by adding the four new webhook secret vars to the `Env` Zod object. All four are required strings — fail-fast at startup if any are missing (D-01).

```typescript
// packages/config/src/env.ts — add to existing Env object:
  WEBHOOK_SECRET_SHOPEE: z.string().min(1),
  WEBHOOK_SECRET_TOKOPEDIA: z.string().min(1),
  WEBHOOK_SECRET_META_ADS: z.string().min(1),
  WEBHOOK_SECRET_CRM: z.string().min(1),
```

The `getSecretForSource(source)` helper in the ingest route maps the `:source` param (which matches `EventSource` enum values: `SHOPEE`, `TOKOPEDIA`, `META_ADS`, `CRM`) to the corresponding env var.

### Pattern 7: app.inject() Route Tests with Mocks

**What:** Build the app with mock `queue` and `redis` to test all five SC scenarios without real infrastructure.

```typescript
// apps/api/tests/routes/ingest.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildFingerprint } from '../../src/lib/fingerprint.js';
import { createHmac } from 'node:crypto';

const mockQueue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
const mockRedis = { set: vi.fn().mockResolvedValue('OK') };

const SECRET = 'test-secret';
process.env.WEBHOOK_SECRET_SHOPEE = SECRET;
// ... set all four

const app = await buildApp({ queue: mockQueue as any, redis: mockRedis as any });

function signPayload(body: string): string {
  const hex = createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');
  return `sha256=${hex}`;
}

// SC-4 duplicate: set mockRedis.set to return null for second call
mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
```

**Key inject call shape:**
```typescript
const response = await app.inject({
  method: 'POST',
  url: '/ingest/SHOPEE',
  headers: {
    'content-type': 'application/json',
    'x-webhook-signature': signPayload(JSON.stringify(body)),
  },
  payload: body,
});
expect(response.statusCode).toBe(202);
```

### Anti-Patterns to Avoid

- **Re-serializing body for HMAC:** Never compute HMAC over `JSON.stringify(request.body)`. The parsed object's key order may differ from the raw bytes received. Always compute over `request.rawBody` (the Buffer captured before parsing).
- **String equality on signatures:** Never `sig === expected`. Use `timingSafeEqual`. Timing attacks are trivially exploited on constant-time mismatches.
- **Creating a new Redis connection in the route:** The `connection` from `@omnisync/queue` is already live. Pass it into `buildApp` — do not `new Redis(...)` inside the Fastify app.
- **Using `z.treeifyError()` for the 422 response:** `z.treeifyError()` is for human-readable debug printing (confirmed usage in `@omnisync/config`). For the `issues[]` array in the 422 response, use `z.flattenError()` which returns `{ fieldErrors, formErrors }`.
- **Calling `app.listen()` inside `buildApp()`:** The factory must return the app without starting it — so tests can call `app.inject()` without binding a port.
- **Registering plugins after routes:** `fastify-raw-body` must be registered before any route that needs `request.rawBody`. Register all plugins in `buildApp` before registering routes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Raw body capture in Fastify 5 | Custom preParsing hook that buffers chunks + re-streams | `fastify-raw-body` v5.0.0 | The stream must be re-piped with correct `receivedEncodedLength` tracking to pass Fastify's body-limit checks — non-trivial to get right |
| HTTP security headers | Manual `reply.header('X-Frame-Options', ...)` calls | `@fastify/helmet` | 14+ headers, auto-updated when new attacks emerge, one line |
| HTTP error helpers | Custom `reply.code(400).send(...)` in every route | `@fastify/sensible` | Standard HTTP error semantics (`reply.badRequest()`, `reply.notFound()`) with correct status codes |
| Constant-time comparison | `===` on hex strings | `crypto.timingSafeEqual` | Timing side-channel: attacker can guess signature byte-by-byte with enough requests |
| SHA-256 hashing | Any npm crypto library | Node.js built-in `node:crypto` | `createHash`, `createHmac` are built-in since Node.js 0.1.x — zero dependency, no install needed |

**Key insight:** The rawBody capture is the only genuinely tricky part. Everything else (HMAC, SHA-256, Zod validation, BullMQ enqueue) is straightforward use of established APIs. Spending time on a hand-rolled preParsing hook is wasteful when `fastify-raw-body` exists specifically for this pattern.

---

## Common Pitfalls

### Pitfall 1: rawBody Is Undefined When Body Is Not `application/json`

**What goes wrong:** `fastify-raw-body` captures the body for `application/json` content-type requests by default. If a webhook sender posts `text/plain` or omits `Content-Type`, `request.rawBody` is undefined and the HMAC check fails with a cryptic error.

**Why it happens:** The plugin's `jsonContentTypes` option controls which content types trigger rawBody capture. The default includes only `application/json`.

**How to avoid:** Register the plugin with explicit content-type handling. For webhook ingestion, webhooks always send `application/json`. Add a guard in the route: if `request.rawBody === undefined`, return 400 rather than crashing. Log the content-type for debugging.

**Warning signs:** HMAC fails only for certain senders; `request.rawBody` is `undefined` in route handler.

### Pitfall 2: `z.flattenError()` vs `z.treeifyError()` — Wrong API for 422 Response

**What goes wrong:** `z.treeifyError()` is already used in `@omnisync/config` for startup error printing. A developer uses it for the 422 response body — but `treeifyError` returns a nested object for human display, not a flat `issues[]` array.

**Why it happens:** Both APIs exist in Zod v4 and serve different purposes. The project uses `treeifyError` for console output, which creates a false assumption that it's the correct API for structured errors.

**How to avoid:** Use `z.flattenError(parsed.error)` for the 422 response. It returns `{ fieldErrors: Record<string, string[]>, formErrors: string[] }`. Map `fieldErrors` to `issues: [{ field, message }]`.

**Correct pattern:**
```typescript
const flat = z.flattenError(parsed.error);
const issues = Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
  (msgs ?? []).map((message) => ({ field, message }))
);
```

### Pitfall 3: `timingSafeEqual` Throws on Unequal Buffer Lengths

**What goes wrong:** `crypto.timingSafeEqual(a, b)` throws `TypeError: Input buffers must have the same byte length` if the provided signature hex decodes to a different byte count than the expected HMAC (32 bytes for SHA-256).

**Why it happens:** An attacker (or a misconfigured sender) sends a truncated or padded signature. `Buffer.from(hex, 'hex')` produces a buffer proportional to hex length. A 10-char hex = 5-byte buffer ≠ 32 bytes.

**How to avoid:** Always check `a.length !== b.length` before calling `timingSafeEqual`. Return `false` immediately if lengths differ. This guard is part of the `verifySignature` pure function (see Code Examples).

### Pitfall 4: Env Vars Not Loaded When `@omnisync/config` Parses Them

**What goes wrong:** Phase 2 adds `WEBHOOK_SECRET_*` to `@omnisync/config/src/env.ts`. But in tests, `process.env` doesn't have these values, so the Zod env parse fails with `process.exit(1)` — the test suite crashes.

**Why it happens:** The `env` object in `@omnisync/config` is evaluated at module load time (IIFE). Any test that imports from `@omnisync/config` triggers the parse before `vi.stubEnv()` can run.

**How to avoid:** In the Vitest config for `apps/api`, use `setupFiles` to set all required env vars before tests run:
```typescript
// apps/api/vitest.setup.ts
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DIRECT_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.WEBHOOK_SECRET_SHOPEE = 'test-secret-shopee';
process.env.WEBHOOK_SECRET_TOKOPEDIA = 'test-secret-tokopedia';
process.env.WEBHOOK_SECRET_META_ADS = 'test-secret-meta';
process.env.WEBHOOK_SECRET_CRM = 'test-secret-crm';
```

### Pitfall 5: `fastify-raw-body` Must Be Registered Before Routes

**What goes wrong:** Plugins registered after a route definition don't apply to that route in Fastify's encapsulation model. If `fastify-raw-body` is registered after `ingestRoutes`, `request.rawBody` is undefined for the ingest route.

**Why it happens:** Fastify's plugin lifecycle: plugins registered in a parent scope are available to child scopes. But if routes and plugins are both registered at the same level, registration order matters.

**How to avoid:** In `buildApp()`, always `await app.register(rawBody, ...)` before `await app.register(ingestRoutes, ...)`. Follow the order: security plugins → content plugins → error handler → routes.

### Pitfall 6: `source` Param Casing Does Not Match `EventSource` Enum

**What goes wrong:** The URL is `/ingest/shopee` (lowercase), but `EventSource` enum has `SHOPEE` (uppercase). Zod validation fails with `VALIDATION_ERROR` even on a valid payload because `source` is extracted from the route param.

**Why it happens:** The `InboundEvent` schema has `source: EventSource` (enum `SHOPEE | TOKOPEDIA | META_ADS | CRM`). The `:source` route param is raw string. If the route param is used directly as the `source` field, casing must match.

**How to avoid:** Either (a) normalize `request.params.source` to uppercase before Zod validation, or (b) document that the API accepts only uppercase source names in route params and add a 400 guard for lowercase. Approach (a) is user-friendlier. The secret lookup should also handle the normalized value.

---

## Code Examples

### SHA-256 Fingerprint — Verified Pattern

```typescript
// Source: Node.js built-in crypto, project decision D-15
// apps/api/src/lib/fingerprint.ts
import { createHash } from 'node:crypto';

export function buildFingerprint(
  source: string,
  eventType: string,
  externalId: string,
  occurredAt: string,
): string {
  return createHash('sha256')
    .update([source, eventType, externalId, occurredAt].join('\0'))
    .digest('hex');
}
```

### HMAC Signature Verify — Verified Pattern

```typescript
// Source: Node.js built-in crypto, project decision D-03
// apps/api/src/lib/hmac.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(
  rawBody: Buffer,
  secret: string,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const provided = header.slice(7);
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

### Redis SET NX Gate — Verified Pattern

```typescript
// Source: Architecture research ARCHITECTURE.md Pattern 2, project decision D-16
// Inside route handler:
const key = `idem:${fingerprint}`;
const result = await redis.set(key, '1', 'NX', 'EX', 86400);
if (result === null) {
  return reply.code(202).send({ status: 'duplicate', fingerprint });
}
```

### Zod v4 flattenError for 422 Issues Array

```typescript
// Source: project decision D-04, Zod v4 API (z.flattenError confirmed in zod.dev/v4)
// import { z } from 'zod/v4'  ← required repo convention
const flat = z.flattenError(parsed.error);
const issues = Object.entries(flat.fieldErrors).flatMap(
  ([field, msgs]) => (msgs ?? []).map((message) => ({ field, message }))
);
reply.code(422).send({ error: 'VALIDATION_ERROR', message: 'Invalid payload', issues });
```

### fastify-raw-body Plugin Registration

```typescript
// Source: fastify-raw-body v5.0.0 README (https://github.com/Eomm/fastify-raw-body)
await app.register(import('fastify-raw-body'), {
  global: true,         // capture rawBody on all routes
  encoding: false,      // return Buffer, not string (required for timingSafeEqual)
  runFirst: true,       // process before other preParsing hooks
});
```

### Vitest Config for apps/api (Wave 0 creation)

```typescript
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual preParsing chunk buffering | `fastify-raw-body` plugin | Fastify 4→5 era | Handles receivedEncodedLength automatically; correct body-limit enforcement |
| `zod.flatten()` (Zod v3) | `z.flattenError()` (Zod v4) | Zod v4 release 2025 | API name changed; v3's `.flatten()` no longer exists on ZodError in v4 |
| `zod.formattedError()` | `z.flattenError()` | Zod v4 release | Use `flattenError` for field-level issues array |
| `Buffer.from(sig).equals(Buffer.from(exp))` | `crypto.timingSafeEqual(a, b)` | Node.js security best practice | `.equals()` short-circuits on first mismatch — timing attack vector |

**Deprecated/outdated patterns to avoid:**
- `req.body` for HMAC computation — body has been JSON-parsed; raw bytes are different
- `zod.ZodError.flatten()` (v3 API) — use `z.flattenError(error)` static method in v4
- `require('crypto')` — use `import { createHash, createHmac, timingSafeEqual } from 'node:crypto'` (ESM + explicit node: protocol, project convention)

---

## Open Questions

1. **`source` param casing convention**
   - What we know: `EventSource` enum is uppercase (`SHOPEE`, `TOKOPEDIA`, `META_ADS`, `CRM`); URLs conventionally use lowercase.
   - What's unclear: Should the route accept both `/ingest/shopee` and `/ingest/SHOPEE`, or uppercase only?
   - Recommendation: Normalize to uppercase in the route handler before Zod validation. Document in API comments that both casings work. Planner should add a test case for lowercase source param.

2. **PORT / HOST env var names**
   - What we know: CONTEXT.md says these are Claude's discretion. Standard Node.js uses `PORT` and `HOST` (or `BIND_ADDR`).
   - What's unclear: Should these be added to `@omnisync/config` Zod schema or handled inline in `index.ts`?
   - Recommendation: Keep them out of the shared config schema (they're deploy-time concerns, not app logic). Parse with `parseInt(process.env.PORT ?? '3001', 10)` directly in `index.ts`.

---

## Environment Availability

Phase 2 adds no external services beyond what Phase 1 already verified. All infra (Redis, PostgreSQL, Docker) is already running from Phase 1.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v20.19.0 | — |
| Redis (local Docker) | SET NX gate in tests | ✓ (Phase 1) | 7-alpine | Route tests use mock redis — no real Redis needed for D-10 tests |
| PostgreSQL (local Docker) | DB (not used Phase 2 hot path) | ✓ (Phase 1) | 15-alpine | Not needed in Phase 2 API tests |
| pnpm | Package install | ✓ (Phase 1) | — | — |

**Note:** Phase 2 route tests (D-10) use mocked `queue` and `redis` — no real infrastructure needed for the full test suite. Real Redis is only needed for Phase 6's concurrent-dedup integration test (TST-03, deferred).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.8 |
| Config file | `apps/api/vitest.config.ts` — does NOT exist yet (Wave 0 creates it) |
| Quick run command | `pnpm --filter @omnisync/api exec vitest run` |
| Full suite command | `pnpm --filter @omnisync/api exec vitest run --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ING-01 | POST /ingest/:source returns 202 in sub-ms (in-process) | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ Wave 0 |
| ING-02 | Tampered/missing X-Webhook-Signature returns 401, no enqueue | integration (inject) | same | ❌ Wave 0 |
| ING-03 | Schema-invalid payload returns 422 with issues[] | integration (inject) | same | ❌ Wave 0 |
| ING-04 | SHA-256 fingerprint is stable across identical re-deliveries | unit | `pnpm --filter @omnisync/api exec vitest run tests/lib/fingerprint.test.ts` | ❌ Wave 0 |
| ING-05 | queue.add called exactly once with correct jobId; no DB write | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ Wave 0 |
| IDM-01 | Second identical webhook returns 202 status:'duplicate', queue.add NOT called | integration (inject) | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @omnisync/api exec vitest run`
- **Per wave merge:** `pnpm --filter @omnisync/api exec vitest run --coverage`
- **Phase gate:** All 6 tests green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/api/vitest.config.ts` — vitest config with setupFiles
- [ ] `apps/api/vitest.setup.ts` — env var stubs for all required process.env keys
- [ ] `apps/api/tests/lib/fingerprint.test.ts` — covers ING-04
- [ ] `apps/api/tests/lib/hmac.test.ts` — covers ING-02 pure function
- [ ] `apps/api/tests/routes/ingest.test.ts` — covers ING-01, ING-02, ING-03, ING-05, IDM-01
- [ ] `apps/api/tests/routes/health.test.ts` — covers D-07 /healthz
- [ ] Add vitest + @vitest/coverage-v8 to `apps/api/package.json` devDependencies
- [ ] Add `test` script to `apps/api/package.json`: `"test": "vitest run"`
- [ ] Add `src/types/fastify.d.ts` for `request.rawBody?: Buffer` augmentation

---

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Node.js v20+/TypeScript v5, Fastify (ingestion API), Redis v7 + BullMQ, PostgreSQL v15+ + Prisma, Zod, Vitest + Playwright, Next.js, Docker.
- **Zod import:** `import { z } from 'zod/v4'` — enforced across the repo.
- **ESM-native:** All files use `import`/`export`. `"type": "module"` in all package.json files.
- **Fail-fast env validation:** `process.exit(1)` on bad config at startup — established by `packages/config`.
- **BullMQ jobId dedup:** `eventsQueue.add(name, data, { jobId: fingerprint })` — established pattern.
- **No `ts-node` in production or Docker** — use `tsc` output or `tsx` for dev.
- **Quality bar:** ≥80% test coverage and green CI (enforced Phase 6, but tests must exist from Phase 2).
- **GSD workflow enforcement:** All file changes go through GSD commands.
- **RTK prefix:** All bash commands prefixed with `rtk` per global CLAUDE.md.

---

## Sources

### Primary (HIGH confidence)
- `packages/types/src/event.ts` — `InboundEvent` Zod schema confirmed: source (enum 4 values uppercase), eventType, externalId, occurredAt (datetime string), payload (record)
- `packages/queue/src/index.ts` — `eventsQueue`, `connection` (ioredis), `QUEUE_NAME='events'`, `queueOptions` confirmed
- `packages/config/src/env.ts` — existing env schema; `z.treeifyError` used for error display (NOT `z.flattenError`)
- `apps/api/src/index.ts` — current stub; SIGINT/SIGTERM handlers present, no Fastify yet
- Node.js built-in `crypto` module — `createHash`, `createHmac`, `timingSafeEqual` (no version dependency)
- npm registry (2026-06-09): fastify@5.8.5, @fastify/sensible@6.0.4, @fastify/helmet@13.0.2, vitest@4.1.8, fastify-raw-body@5.0.0

### Secondary (MEDIUM confidence)
- [fastify-raw-body README](https://github.com/Eomm/fastify-raw-body/blob/main/README.md) — v5.0.0, Fastify 5 compatible, encoding:false for Buffer, runFirst option verified via WebFetch
- [Fastify Hooks docs](https://fastify.dev/docs/latest/Reference/Hooks/) — preParsing hook must return stream with receivedEncodedLength — verified via WebFetch
- [Zod v4 flattenError](https://zod.dev/v4) — `z.flattenError()` is the correct v4 API for structured field errors (inferred from project codebase using `z.treeifyError` for a different purpose)
- [Fastify Testing guide](https://fastify.dev/docs/latest/Guides/Testing/) — `app.inject()` pattern, factory function required for testability

### Tertiary (LOW confidence — from web search, not directly verified against official docs)
- GitHub-style `sha256=<hex>` header format — widely documented pattern; same as GitHub Webhooks, Shopify, Stripe
- `Buffer.from(hex, 'hex').length !== 32` guard for timingSafeEqual — defensive programming pattern; not from official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions confirmed against npm registry 2026-06-09
- Architecture: HIGH — locked decisions from CONTEXT.md + existing Phase 1 code confirmed
- Pitfalls: HIGH — rawBody capture (Pitfall 1/5) confirmed from official Fastify docs; others from project-established patterns
- Test infrastructure: HIGH — vitest 4.1.8 confirmed; Wave 0 gaps clearly identified

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (30 days — stable libraries)
