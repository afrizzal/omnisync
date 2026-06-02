# Architecture Research

**Domain:** Distributed event-driven webhook ingestion / Customer Data Platform (CDP)
**Researched:** 2026-06-01
**Confidence:** HIGH (BullMQ official docs + multiple verified sources for all major claims)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INGESTION LAYER (scale-to-zero capable)             │
│                                                                             │
│  External Sources        Fastify API (port 3001)                            │
│  ┌────────────┐          ┌────────────────────────────────────────────┐     │
│  │ Mock Sender│ ──POST──>│  1. Raw body capture (pre-parse hook)      │     │
│  │ (channels) │          │  2. HMAC signature verify                  │     │
│  └────────────┘          │  3. Zod schema validation                  │     │
│                          │  4. Idempotency fingerprint (SHA-256)      │     │
│                          │  5. Redis SET NX fingerprint (atomic lock) │     │
│                          │  6. BullMQ queue.add(job)                  │     │
│                          │  7. HTTP 202 Accepted                      │     │
│                          └────────────────────┬───────────────────────┘     │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │    Redis (BullMQ)      │
                                    │  ┌──────────────────┐  │
                                    │  │  events queue    │  │
                                    │  │  (wait / active  │  │
                                    │  │   / delayed /    │  │
                                    │  │   failed)        │  │
                                    │  └──────────────────┘  │
                                    │  ┌──────────────────┐  │
                                    │  │  dlq queue       │  │
                                    │  │  (exhausted jobs)│  │
                                    │  └──────────────────┘  │
                                    │  ┌──────────────────┐  │
                                    │  │  fingerprint     │  │
                                    │  │  keys (TTL 24h)  │  │
                                    │  └──────────────────┘  │
                                    └───────────┬────────────┘
                                                │
┌───────────────────────────────────────────────┼─────────────────────────────┐
│                  WORKER LAYER (always-on, separate process)                 │
│                                               │                             │
│                          ┌────────────────────▼────────────────────────┐   │
│                          │  BullMQ Worker Pool (concurrency configurable)│  │
│                          │                                               │  │
│                          │  Per-job pipeline:                            │  │
│                          │  1. Dedup check (DB unique constraint)        │  │
│                          │  2. Normalize payload (source-specific rules) │  │
│                          │  3. Persist to PostgreSQL (events table)      │  │
│                          │  4. Downstream sync (via circuit breaker)     │  │
│                          │  5. Mark job completed                        │  │
│                          │                                               │  │
│                          │  On failure:                                  │  │
│                          │  Exponential backoff + jitter (up to N tries) │  │
│                          │  → Job moves to failed set                    │  │
│                          │  → worker.on('failed') moves to DLQ queue     │  │
│                          └────────────────────┬────────────────────────-┘  │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │
              ┌─────────────────────────────────┼──────────────────────────┐
              │               DATA LAYER        │                          │
              │                                 │                          │
              │  ┌──────────────────┐  ┌────────▼─────────┐               │
              │  │   PostgreSQL     │  │  Mock CRM Sync   │               │
              │  │  events table    │◄─┤  (circuit-broken │               │
              │  │  dlq_events      │  │   HTTP call)     │               │
              │  │  routing_rules   │  └──────────────────┘               │
              │  └──────────────────┘                                      │
              └────────────────────────────────────────────────────────────┘
                                                │
┌───────────────────────────────────────────────┼─────────────────────────────┐
│                    DASHBOARD LAYER (Next.js App Router)                     │
│                                               │                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  /dashboard    — live queue metrics, throughput charts               │   │
│  │  /dlq          — failed jobs list, error detail, one-click re-queue  │   │
│  │  /routing-rules — dynamic event routing/transformation config UI     │   │
│  │  /demo         — load-test visualization (events vs failed, live)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  Next.js API Routes → shared @omnisync/db package (Prisma) + BullMQ        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Key Constraint |
|-----------|---------------|----------------|
| Fastify API | Accept webhooks, validate, fingerprint, enqueue, ACK 202 | Must return in low single-digit ms; never blocks on DB |
| Redis (BullMQ) | Durable job store, queue state machine, pub/sub for QueueEvents | `maxmemory-policy noeviction`; AOF persistence on |
| BullMQ Worker Pool | Consume jobs, normalize, dedup, persist, sync | Always-on process; separate deploy from API |
| PostgreSQL (Prisma) | Authoritative event store, dedup unique constraint, routing rules | Unique constraint on fingerprint enforces final idempotency |
| Mock CRM Sync | Simulates flaky downstream; target for circuit breaker demo | Intentionally injectable failures for demo |
| Circuit Breaker (opossum) | Guards the downstream sync hop; OPEN/HALF-OPEN/CLOSED states | Lives inside worker, wraps only the sync call |
| Next.js Dashboard | UI for queue metrics, DLQ management, routing rules, live demo | Reads from PostgreSQL + BullMQ queue stats via API routes |
| Observability | Structured logs + metrics for ingestion rate, queue depth, retries | Pino (Fastify native) + custom metric counters |

---

## Recommended Monorepo Topology

**Tool:** Turborepo + pnpm workspaces
**Rationale:** Lets the API process and worker process share `@omnisync/db` (Prisma schema + generated client + Zod types) without publishing packages. Each `apps/` entry is a separately deployable process.

```
omnisync/
├── apps/
│   ├── api/                    # Fastify ingestion API (scale-to-zero capable)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   └── ingest.ts   # POST /ingest/:source — the hot path
│   │   │   ├── plugins/
│   │   │   │   ├── hmac.ts     # Raw body capture + HMAC verify (pre-parse hook)
│   │   │   │   └── redis.ts    # BullMQ Queue instance
│   │   │   ├── lib/
│   │   │   │   └── fingerprint.ts  # SHA-256 fingerprint generation
│   │   │   └── server.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── worker/                 # BullMQ worker pool (always-on process)
│   │   ├── src/
│   │   │   ├── processors/
│   │   │   │   └── event.processor.ts  # Main job pipeline
│   │   │   ├── normalizers/
│   │   │   │   ├── shopee.ts
│   │   │   │   ├── tokopedia.ts
│   │   │   │   └── meta-ads.ts
│   │   │   ├── lib/
│   │   │   │   ├── circuit-breaker.ts  # opossum wrapping mock CRM call
│   │   │   │   └── dlq.ts              # worker.on('failed') → DLQ mover
│   │   │   └── worker.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── dashboard/              # Next.js App Router (scale-to-zero capable)
│       ├── app/
│       │   ├── dashboard/      # Live metrics page
│       │   ├── dlq/            # DLQ list + re-queue actions
│       │   ├── routing-rules/  # Dynamic routing config UI
│       │   └── api/            # Next.js API routes → shared DB/queue
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── db/                     # @omnisync/db — Prisma schema + client + migrations
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Single source of truth for all DB entities
│   │   ├── src/
│   │   │   └── index.ts        # Re-exports PrismaClient singleton
│   │   └── package.json
│   │
│   ├── types/                  # @omnisync/types — shared Zod schemas + TS types
│   │   ├── src/
│   │   │   ├── events.ts       # IngestPayload, NormalizedEvent, DLQEntry
│   │   │   └── routing.ts      # RoutingRule type
│   │   └── package.json
│   │
│   └── config/                 # @omnisync/config — shared env schema (Zod)
│       └── src/
│           └── env.ts          # parseEnv() used by all apps
│
├── docker-compose.yml          # Local: postgres + redis + all apps
├── turbo.json
└── pnpm-workspace.yaml
```

### Structure Rationale

- **`apps/api` vs `apps/worker` split:** The API can scale to zero (serverless/Cloud Run); the worker must be always-on because BullMQ polling requires a persistent connection. They deploy separately but share `@omnisync/db` and `@omnisync/types` — no schema drift possible.
- **`packages/db`:** Prisma client is generated once, used by API (enqueue only, no direct DB writes on hot path), worker (dedup check + persist), and dashboard (query). Single migration source prevents schema divergence.
- **`packages/types`:** Zod schemas defined once, imported by API for request validation and by worker for normalization output shape. Ensures the enqueued job payload type is the same type the worker deserializes.
- **`apps/dashboard` as Next.js:** Shares `@omnisync/db` directly from API routes — no separate backend needed for the dashboard tier.

---

## Data Flow (End-to-End, Explicit)

### Happy Path

```
1. External sender POST /ingest/:source
   Headers: X-Webhook-Signature, X-Idempotency-Key (optional), Content-Type: application/json

2. Fastify pre-parse hook → capture raw body Buffer (BEFORE JSON parse)
   → HMAC-SHA256(raw body, WEBHOOK_SECRET) === X-Webhook-Signature
   → If mismatch: 401 Unauthorized (no fingerprint generated, no queue write)

3. Zod schema validation on parsed body
   → If invalid: 422 Unprocessable Entity

4. Fingerprint generation
   Strategy: SHA-256( source + payload.event_type + payload.external_id + payload.occurred_at )
   → Stable across identical retries from same sender
   → Does NOT use X-Idempotency-Key alone (that is sender-controlled; fingerprint is server-computed)
   Note: X-Idempotency-Key is logged/stored as metadata but the dedup anchor is the computed fingerprint

5. Redis SET NX "idem:{fingerprint}" EX 86400
   → Returns OK  → first seen, proceed
   → Returns nil → duplicate in-flight; return 202 immediately (idempotent ACK, no re-enqueue)
   Purpose of Redis lock: fast pre-check at ingestion speed, prevents enqueueing same event twice
   during the window before it persists to DB

6. BullMQ queue.add("process-event", { source, rawPayload, fingerprint })
   → Job durably stored in Redis with unique job ID
   → Returns immediately

7. HTTP 202 Accepted { jobId, fingerprint }
   — API responsibility ends here —
```

```
8. BullMQ Worker picks up job from "events" queue

9. DB dedup check: SELECT 1 FROM events WHERE fingerprint = $1
   → If found: mark job completed (idempotent no-op) — second line of defense against
     race conditions where two workers pick up near-simultaneous duplicates
   → If not found: proceed

10. Source-specific normalizer(source, rawPayload)
    → Transforms to NormalizedEvent shape (E.164 phone, ISO dates, unified schema)
    → Applies any matching routing_rules from DB (loaded at worker start, refreshed on TTL)

11. PostgreSQL INSERT INTO events (fingerprint, source, event_type, normalized_payload, ...)
    → Unique constraint on (fingerprint) — DB-level final guard against duplicates
    → If unique violation: treat as duplicate, mark job completed

12. Downstream sync (optional, async within job)
    → opossum circuit breaker wraps HTTP POST to mock CRM endpoint
    → CLOSED: request passes through normally
    → If mock CRM returns 5xx / times out: opossum increments failure count
    → OPEN (above threshold): call short-circuits, fallback runs (log + no-op)
    → HALF-OPEN: one probe request after resetTimeout; success → CLOSED, failure → OPEN

13. Job marked COMPLETED in BullMQ
```

### Failure / Retry Path

```
Worker job throws (DB timeout, normalizer error, etc.)
    ↓
BullMQ marks job FAILED
    ↓
Retry policy: { attempts: 5, backoff: { type: 'exponential', delay: 3000, jitter: 0.5 } }
    → Attempt 1 retry after ~3s
    → Attempt 2 retry after ~6s (±jitter)
    → Attempt 3 retry after ~12s (±jitter)
    → ...up to attempt 5
    ↓
After attempt 5: job moves to BullMQ "failed" set (permanent failure)
    ↓
worker.on('failed', (job, err) => { if job.attemptsMade >= maxAttempts })
    → queue.add("dlq", { originalJob: job.data, error: err.message, trace: err.stack })
    → Inserts record into dlq_events PostgreSQL table (for dashboard query)
    ↓
Dashboard DLQ view: lists failed events with error detail
One-click re-queue: removes from dlq_events, re-adds to events queue with fresh attempt count
```

### DLQ Re-queue Path

```
Dashboard user clicks "Re-queue"
    ↓
Next.js API route POST /api/dlq/:id/requeue
    ↓
DELETE FROM dlq_events WHERE id = $1
    ↓
queue.add("process-event", { ...originalJobData }, { attempts: 5, ... })
    ↓
Normal happy path resumes from step 8
```

---

## Idempotency Design

### Fingerprint Strategy

**Anchor fields:** `source` + `event_type` + `external_id` + `occurred_at`

These four fields uniquely identify a business event regardless of delivery timing. The fingerprint is SHA-256 of their concatenation, hex-encoded (64 chars, fits a VARCHAR(64) indexed column efficiently).

Do NOT fingerprint on: raw payload hash (normalizer fields differ between sender retries), wall-clock receipt time (each delivery is a new timestamp), or X-Idempotency-Key alone (sender-controlled, can be wrong).

### Two-Layer Dedup (Defense in Depth)

| Layer | Mechanism | Protects Against |
|-------|-----------|------------------|
| Layer 1: Redis SET NX | `SET idem:{fingerprint} 1 NX EX 86400` at ingestion time | Duplicate enqueue before DB write; race between two concurrent identical requests hitting the API simultaneously |
| Layer 2: DB unique constraint | `UNIQUE(fingerprint)` on `events` table | Duplicates that slip through Redis (Redis key expired, Redis restart, cross-worker race after dequeue) |

### Race Condition Prevention

**Scenario:** Same event arrives via two different network paths within milliseconds.

- Both requests pass HMAC check simultaneously.
- Both compute identical fingerprint.
- Request A wins the Redis `SET NX` → proceeds to enqueue.
- Request B gets nil from Redis `SET NX` → returns 202 without enqueue. Race closed at Redis.

**Scenario:** Redis key expired between enqueue and worker processing (edge case).

- Worker A and Worker B both pick up what appear to be two jobs (shouldn't happen with BullMQ's atomic LMOVE, but at-least-once semantics mean it's possible after stall recovery).
- Both attempt `INSERT INTO events WHERE fingerprint = ...`.
- First insert succeeds.
- Second insert throws unique constraint violation → worker catches it, marks job completed (not failed). No retry triggered. No duplicate in DB.

The combination of Redis NX + DB unique constraint means idempotency holds even across Redis restarts, worker crashes, and concurrent requests.

---

## PostgreSQL Schema Design

### events Table

```sql
CREATE TABLE events (
  id            BIGSERIAL PRIMARY KEY,
  fingerprint   VARCHAR(64)  NOT NULL,
  source        VARCHAR(64)  NOT NULL,      -- 'shopee', 'meta-ads', etc.
  event_type    VARCHAR(128) NOT NULL,       -- 'order.created', 'ad.click', etc.
  raw_payload   JSONB        NOT NULL,
  normalized    JSONB        NOT NULL,
  occurred_at   TIMESTAMPTZ  NOT NULL,       -- from payload (business time)
  received_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  status        VARCHAR(32)  NOT NULL DEFAULT 'processed',

  CONSTRAINT events_fingerprint_unique UNIQUE (fingerprint)
) PARTITION BY RANGE (received_at);         -- Monthly partitions

-- Indexes (add carefully — each index slows inserts)
CREATE INDEX idx_events_source_occurred   ON events (source, occurred_at DESC);
CREATE INDEX idx_events_event_type        ON events (event_type);
CREATE INDEX idx_events_fingerprint       ON events (fingerprint);   -- enforces dedup
CREATE INDEX idx_events_received_at       ON events (received_at DESC);
```

**Partitioning rationale:** Monthly range partitions on `received_at` let older data be archived without impacting inserts. Partition pruning is automatic when WHERE clauses include `received_at`. For portfolio scale, a single unpartitioned table is also acceptable — the partition structure is there to demonstrate the design pattern, not because it's immediately necessary.

### dlq_events Table

```sql
CREATE TABLE dlq_events (
  id            BIGSERIAL PRIMARY KEY,
  fingerprint   VARCHAR(64),
  source        VARCHAR(64),
  original_data JSONB        NOT NULL,
  error_message TEXT         NOT NULL,
  error_stack   TEXT,
  attempts_made INT          NOT NULL DEFAULT 0,
  failed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  requeued_at   TIMESTAMPTZ
);

CREATE INDEX idx_dlq_failed_at ON dlq_events (failed_at DESC);
```

### routing_rules Table

```sql
CREATE TABLE routing_rules (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128)  NOT NULL,
  source      VARCHAR(64),              -- NULL = applies to all sources
  event_type  VARCHAR(128),             -- NULL = applies to all event types
  transform   JSONB         NOT NULL,   -- e.g. { "normalize_phone": "E.164" }
  priority    INT           NOT NULL DEFAULT 0,
  active      BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

---

## Architectural Patterns

### Pattern 1: Pre-parse Raw Body Capture (Fastify)

**What:** Capture the raw request body as a Buffer in a `preParsing` hook before Fastify's JSON parser runs. Required because HMAC is computed over the exact bytes received, not over re-serialized JSON.

**When to use:** Every webhook ingestion endpoint that validates sender signatures.

**Trade-offs:** Slightly increases memory per request (raw Buffer + parsed JSON both in memory briefly). Negligible at webhook payload sizes.

```typescript
// apps/api/src/plugins/hmac.ts
fastify.addHook('preParsing', async (request, reply, payload) => {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  request.rawBody = raw;
  // Return an async iterable re-stream so Fastify can still parse JSON
  return Readable.from(raw);
});

fastify.addHook('preHandler', async (request, reply) => {
  const sig = request.headers['x-webhook-signature'];
  const expected = createHmac('sha256', env.WEBHOOK_SECRET)
    .update(request.rawBody!)
    .digest('hex');
  if (!timingSafeEqual(Buffer.from(sig as string), Buffer.from(expected))) {
    reply.code(401).send({ error: 'Invalid signature' });
  }
});
```

### Pattern 2: Redis SET NX for Ingestion-Speed Dedup

**What:** Atomic `SET key value NX EX ttl` returns nil if key exists. Used as a fast in-memory dedup gate at API ingestion time, before any DB write.

**When to use:** High-throughput ingestion where you want to avoid even enqueueing duplicates, not just deduplicate at the DB level.

**Trade-offs:** Redis keys have a TTL (24h recommended). Events older than TTL that are redelivered will not be caught by Redis — the DB unique constraint is the permanent backstop. That's the correct tradeoff: Redis is a performance gate, not the authoritative dedup store.

```typescript
// apps/api/src/routes/ingest.ts
const key = `idem:${fingerprint}`;
const result = await redis.set(key, '1', 'NX', 'EX', 86400);
if (result === null) {
  // Already seen within TTL window — idempotent ACK
  return reply.code(202).send({ status: 'duplicate', fingerprint });
}
await queue.add('process-event', { source, rawPayload, fingerprint });
return reply.code(202).send({ status: 'queued', fingerprint });
```

### Pattern 3: BullMQ Worker with Fail-to-DLQ Handler

**What:** BullMQ does not have a built-in DLQ. The pattern is: set `attempts` on job options, listen to `worker.on('failed')`, and when `job.attemptsMade >= job.opts.attempts` move the job data to a separate DLQ queue and persist to `dlq_events` table.

**When to use:** Any BullMQ deployment where jobs must not be silently lost.

**Trade-offs:** The DLQ queue in Redis is also subject to memory pressure. Persisting DLQ entries to PostgreSQL provides a durable, queryable audit trail that the dashboard depends on.

```typescript
// apps/worker/src/lib/dlq.ts
worker.on('failed', async (job, err) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return; // still retrying
  await dlqQueue.add('dlq-entry', {
    originalData: job.data,
    errorMessage: err.message,
    errorStack: err.stack,
    attemptsMade: job.attemptsMade,
  });
  await prisma.dlqEvent.create({
    data: {
      fingerprint: job.data.fingerprint,
      source: job.data.source,
      originalData: job.data,
      errorMessage: err.message,
      errorStack: err.stack ?? null,
      attemptsMade: job.attemptsMade,
    },
  });
});
```

### Pattern 4: Circuit Breaker Wrapping Downstream Sync

**What:** `opossum` wraps the HTTP call to the mock CRM. The breaker is instantiated once per worker process and shared across all job executions. It tracks failure rate; above `errorThresholdPercentage`, the breaker opens and the fallback runs instead.

**When to use:** Any call from the worker to an external dependency that could fail independently of the main pipeline.

**Trade-offs:** Circuit breaker state is in-process memory — multiple worker instances have independent breakers. For a portfolio monorepo with a single worker instance, this is fine and actually more demonstrable (you can see the state change in logs).

```typescript
// apps/worker/src/lib/circuit-breaker.ts
import CircuitBreaker from 'opossum';

const syncToCRM = async (event: NormalizedEvent) => {
  const res = await fetch(env.MOCK_CRM_URL + '/ingest', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`CRM returned ${res.status}`);
};

export const crmBreaker = new CircuitBreaker(syncToCRM, {
  timeout: 3000,
  errorThresholdPercentage: 50,  // open after 50% failures in rolling window
  resetTimeout: 30000,           // try half-open after 30s
  volumeThreshold: 5,            // minimum calls before evaluating threshold
});

crmBreaker.fallback((event: NormalizedEvent) => {
  logger.warn({ fingerprint: event.fingerprint }, 'CRM circuit open — skipping sync');
});
```

---

## Hosting Split Implication

This is a known architectural tension described in PROJECT.md. The resolution is:

| Process | Hosting Model | Rationale |
|---------|---------------|-----------|
| `apps/api` (Fastify) | Scale-to-zero (Cloud Run, Render, Railway with sleep) | Request-driven; no need to run when idle |
| `apps/worker` (BullMQ) | Always-on (Railway dedicated service, Render background worker, Fly.io) | BullMQ uses Redis polling; requires persistent connection. A scale-to-zero worker causes stalled jobs and missed events. |
| `apps/dashboard` (Next.js) | Scale-to-zero acceptable | User-driven page loads |
| Redis | Managed (Upstash with `maxmemory-policy noeviction`) | Upstash's serverless model charges per command — validate BullMQ polling frequency against free tier limits |
| PostgreSQL | Managed (Neon / Supabase free tier) | Connection pooling via PgBouncer/Neon's built-in pooler required for worker concurrency |

**Critical:** The `apps/api` process must NOT run BullMQ workers. The `apps/worker` process must NOT expose HTTP routes (except an optional `/healthz` for hosting health checks). This clean separation allows independent scaling and eliminates the scale-to-zero conflict.

---

## Suggested Build Order

Dependencies flow upward — each phase unlocks the next:

```
Phase 1: Foundation
  ├── Monorepo scaffold (Turborepo + pnpm workspaces)
  ├── @omnisync/db — Prisma schema (events, dlq_events, routing_rules)
  ├── @omnisync/types — Zod schemas (IngestPayload, NormalizedEvent)
  ├── Docker Compose (postgres + redis)
  └── CI skeleton (GitHub Actions: type-check, lint)
  [Unlocks: everything downstream has its shared foundation]

Phase 2: Ingestion API
  ├── apps/api: Fastify server skeleton
  ├── HMAC validation plugin (raw body capture)
  ├── Zod payload validation
  ├── Fingerprint generation
  ├── Redis SET NX dedup gate
  └── BullMQ queue.add() + 202 response
  [Unlocks: events can enter the system; worker can be built against real jobs]

Phase 3: Worker + Core Processing
  ├── apps/worker: BullMQ worker bootstrap
  ├── DB dedup check (unique constraint defense layer 2)
  ├── Source normalizers (shopee, tokopedia, meta-ads shapes)
  ├── Persist to events table
  ├── Retry/backoff config
  └── DLQ mover (worker.on('failed') handler + dlq_events insert)
  [Unlocks: full happy path + failure path operational; integration tests possible]

Phase 4: Resilience
  ├── Circuit breaker (opossum) around mock CRM sync
  ├── Mock CRM service (Express or Fastify, injectable failures)
  └── One-click DLQ re-queue endpoint
  [Unlocks: resilience demo story; circuit breaker is testable only once CRM mock exists]

Phase 5: Dashboard
  ├── apps/dashboard: Next.js App Router scaffold
  ├── Live queue metrics page (BullMQ queue stats API)
  ├── DLQ list + error detail + re-queue button
  ├── Routing rules config UI
  └── Load-test visualization (Server-Sent Events or polling)
  [Unlocks: visual demo for recruiters; depends on Phase 3 + 4 data]

Phase 6: Dynamic Routing
  ├── routing_rules DB table + CRUD API
  ├── Rule evaluation in worker normalizer step
  └── Dashboard routing rules UI (connects to Phase 5 scaffold)
  [Can overlap with Phase 5; depends on Phase 3 worker architecture]

Phase 7: Observability + Polish
  ├── Structured logging (Pino, already Fastify native)
  ├── Custom metric counters (throughput, retry rate, DLQ depth)
  ├── Dashboards wired to live metrics
  ├── Integration test: kill Postgres mid-flight, assert no queue data lost
  └── Playwright E2E: full webhook → dashboard flow
  [Last because it layers on top of everything; test coverage gates CI]
```

**Key dependency constraints:**
- Phase 1 must complete before any other phase (shared packages)
- Phase 2 must complete before Phase 3 (worker needs real jobs to consume)
- Phase 3 must complete before Phase 4 (circuit breaker needs the downstream sync step to wrap)
- Phase 4 must complete before Phase 5 DLQ UI (re-queue action depends on DLQ logic)
- Phases 5 and 6 can partially overlap
- Phase 7 can partially overlap with Phases 5-6 for unit tests; E2E waits for full stack

---

## Anti-Patterns

### Anti-Pattern 1: Synchronous DB Write on the Ingestion Hot Path

**What people do:** INSERT the event into PostgreSQL inside the Fastify route handler before returning 202.

**Why it's wrong:** A single slow DB write (lock contention, cold connection pool) blocks the Fastify event loop for that request, destroying the sub-5ms ACK guarantee. Under flash-sale webhook spikes, this collapses ingestion throughput.

**Do this instead:** The API writes only to Redis (SET NX + queue.add). PostgreSQL writes happen in the worker, off the critical path.

### Anti-Pattern 2: Using Only Redis for Idempotency (No DB Constraint)

**What people do:** Rely solely on Redis TTL-keyed dedup, assuming Redis never loses keys.

**Why it's wrong:** Redis key TTL expires; Redis can restart. A webhook redelivered 25 hours after first delivery (past a 24h TTL) would re-insert a duplicate event into the DB.

**Do this instead:** The DB `UNIQUE(fingerprint)` constraint is the permanent, durable dedup anchor. Redis is a fast pre-check that prevents unnecessary DB round-trips, not the authoritative store.

### Anti-Pattern 3: Running Worker Inside the API Process

**What people do:** Start a BullMQ worker in the same Node.js process as the Fastify server (common in tutorials).

**Why it's wrong:** The API process may scale to zero on serverless platforms, killing the worker. Worker CPU-intensive jobs compete with Fastify's event loop. A worker crash takes down the API.

**Do this instead:** `apps/api` and `apps/worker` are separate processes, separate Docker images, separately deployed. They share code only through `packages/` — never process-to-process.

### Anti-Pattern 4: Fingerprinting on Payload Hash or Receipt Timestamp

**What people do:** Use `SHA-256(JSON.stringify(payload))` or include `received_at` in the fingerprint.

**Why it's wrong:** Payload hash changes if the sender adds a field, reorders keys, or changes a floating-point precision. Receipt timestamp is always unique, making every delivery unique and defeating dedup entirely.

**Do this instead:** Fingerprint on stable business-identity fields: `source + event_type + external_id + occurred_at`. These are controlled by the business event, not by transmission metadata.

### Anti-Pattern 5: Circuit Breaker Around PostgreSQL Writes

**What people do:** Wrap the main `INSERT INTO events` with a circuit breaker.

**Why it's wrong:** If the DB goes down, you want the job to FAIL (so BullMQ retries it with backoff). Opening a circuit breaker around the DB write would silently succeed jobs that didn't actually persist — data loss.

**Do this instead:** Circuit breaker guards only the optional downstream sync (mock CRM). The DB write must remain a hard failure that triggers the retry/DLQ path if it fails.

---

## Integration Points

### External Boundaries

| Boundary | Protocol | Notes |
|----------|----------|-------|
| Webhook senders → API | HTTP POST with HMAC-SHA256 header | Raw body must be preserved for signature check |
| API → Redis (BullMQ) | ioredis (BullMQ's dependency) | Single Queue instance per API process |
| Worker → Redis (BullMQ) | ioredis | Worker should set `maxRetriesPerRequest: null` to avoid breaking on Redis reconnect |
| Worker → PostgreSQL | Prisma + connection pool | Worker concurrency × connections must not exceed DB pool limit |
| Worker → Mock CRM | HTTP POST (fetch) | Wrapped in opossum; intentionally injectable failures |
| Dashboard → PostgreSQL | Prisma (same `@omnisync/db`) | Read-heavy; consider connection pool limits on free-tier Neon/Supabase |
| Dashboard → Redis (BullMQ) | Queue stats API (queue.getJobCounts()) | Read-only; does not add jobs except for re-queue action |

### Internal Package Boundaries

| Boundary | Communication | Constraint |
|----------|---------------|------------|
| `apps/api` ↔ `packages/db` | Import only for Prisma types (if needed); NO direct DB writes on hot path | API must not hold a Prisma connection during ingestion |
| `apps/worker` ↔ `packages/db` | Full Prisma client usage | Worker owns all DB writes |
| `apps/dashboard` ↔ `packages/db` | Full Prisma client for reads + re-queue writes | Dashboard API routes are the only other writer |
| `apps/*` ↔ `packages/types` | Import Zod schemas + inferred TS types | Never duplicate schema definitions |

---

## Scaling Considerations

| Scale | Approach |
|-------|----------|
| Portfolio / demo (< 1K events/day) | Single worker instance, single Postgres instance, Upstash free Redis — no changes needed |
| Moderate load (10K–100K events/day) | Increase worker `concurrency` setting (BullMQ handles fan-out automatically); add read replica for dashboard queries; monitor Upstash command count vs free tier |
| High load (1M+ events/day) | Horizontal worker replicas (BullMQ distributes round-robin automatically); Postgres connection pooler (PgBouncer); Redis cluster or move to dedicated Redis; consider Postgres partitioning more aggressively |

**First bottleneck:** Redis command quota (Upstash free tier). BullMQ is chatty — each job involves multiple Redis commands. Tune `removeOnComplete` and `removeOnFail` counts aggressively to reduce stored job volume.

**Second bottleneck:** PostgreSQL connection pool exhaustion from concurrent worker jobs. Use Prisma's connection pool limits (`connection_limit` in DATABASE_URL) to cap at free-tier maximums.

---

## Sources

- [BullMQ Architecture — docs.bullmq.io](https://docs.bullmq.io/guide/architecture)
- [BullMQ Going to Production — docs.bullmq.io](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ Retrying Failing Jobs — docs.bullmq.io](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [How to Implement Dead Letter Queues in BullMQ — oneuptime.com](https://oneuptime.com/blog/post/2026-01-21-bullmq-dead-letter-queue/view)
- [How to Scale BullMQ Workers Horizontally — oneuptime.com](https://oneuptime.com/blog/post/2026-01-21-bullmq-horizontal-scaling/view)
- [opossum Node.js Circuit Breaker — github.com/nodeshift/opossum](https://github.com/nodeshift/opossum)
- [Node.js Circuit Breaker in Production: Opossum — dev.to](https://dev.to/axiom_agent/nodejs-circuit-breaker-pattern-in-production-opossum-fallbacks-and-resilience-engineering-1mj4)
- [Implementing Webhook Idempotency — hookdeck.com](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Data Deduplication with Redis SET NX — redis.io](https://redis.io/tutorials/data-deduplication-with-redis/)
- [Idempotency in Distributed Systems — aloknecessary.github.io](https://aloknecessary.github.io/blogs/idempotency-distributed-systems/)
- [Webhook Reliability 2026: Idempotency & Retry Reference — digitalapplied.com](https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026)
- [Building Production-Grade Idempotency with Fastify and Redis — javascript.plainenglish.io](https://javascript.plainenglish.io/building-production-grade-idempotency-with-node-js-fastify-and-redis-4876de266222)
- [Lessons from Scaling PostgreSQL Queues to 100K Events — rudderstack.com](https://www.rudderstack.com/blog/scaling-postgres-queue/)
- [PostgreSQL Partitioning for Event Tables — appmaster.io](https://appmaster.io/blog/postgresql-partitioning-event-audit-tables)
- [Building a Production-Ready Event Store in PostgreSQL — dev.to](https://dev.to/tim_derzhavets/building-a-production-ready-event-store-in-postgresql-schema-design-projections-and-replay-25o8)
- [BullMQ Does BullMQ Affect Serverless — Railway Help Station](https://station.railway.com/questions/does-bull-mq-effect-my-server-less-opti-68a00b4e)
- [Customer Data Platform Architecture — cdpinstitute.org](https://www.cdpinstitute.org/cdp-institute/customer-data-platform-architecture/)
- [Monorepo That Actually Scales: Turborepo + PNPM — medium.com](https://medium.com/@TheblogStacker/2025-monorepo-that-actually-scales-turborepo-pnpm-for-next-js-ab4492fbde2a)
- [TypeScript Monorepo Setup: Sharing Types Between Workers and Next.js — outstand.so](https://www.outstand.so/blog/typescript-monorepo-setup)

---
*Architecture research for: Distributed event-driven webhook ingestion / CDP*
*Researched: 2026-06-01*
