# Phase 4: Resilience & Dynamic Routing - Research

**Researched:** 2026-06-13
**Domain:** Distributed systems resilience patterns — circuit breaker (cockatiel), BullMQ custom backoff, DLQ wiring, runtime-reloadable routing rules
**Confidence:** HIGH (core library APIs verified; architecture patterns confirmed against official BullMQ docs and cockatiel source)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Circuit Breaker (RES-04, RES-05)**
- D-01: Use cockatiel (not opossum). Overrides ROADMAP.md reference to "opossum".
- D-02: Policy composition: Retry policy wraps CircuitBreaker policy. Layered policies demonstrate cockatiel composability.
- D-03: Breaker type: `ConsecutiveBreaker(5)` — opens after 5 consecutive failures. Not SamplingBreaker.
- D-04: `halfOpenAfter`: 10–15 seconds, configurable via `BREAKER_HALF_OPEN_MS` env var (default 10000).
- D-05: All breaker parameters in `@omnisync/config` Zod env schema.

**Mock CRM Downstream (RES-04 prerequisite)**
- D-06: `apps/mock-crm` — standalone Fastify app in docker-compose, real HTTP.
- D-07: Worker depends on a `CrmClient` interface (DI). Production = HTTP client to mock-crm. Unit tests = in-process fake.
- D-08: Failure mode via `POST /admin/failure-mode { mode: "fail" | "slow" | "ok", rate: number }`.
- D-09: `apps/mock-crm` is docker-compose only — not deployed to Render.

**Retry Profile (RES-01)**
- D-10: Retry config in `packages/queue` `createEventsQueue()` `defaultJobOptions`.
- D-11: `backoff: { type: 'custom' }` in `defaultJobOptions`. Custom strategy defined in `packages/queue`, imported by Worker constructor.
- D-12: Full jitter formula: `delay = Math.random() * Math.min(cap, base * 2 ** attempt)`.
- D-13: Env defaults: `RETRY_ATTEMPTS=5`, `RETRY_BASE_DELAY_MS=1000`, `RETRY_CAP_MS=30000`.

**DLQ (RES-02, RES-03)**
- D-14: `dlq_events` table shape already in Phase 3 schema. No new migration for table shape.
- D-15: DLQ handler writes on job exhaustion. Captures: fingerprint, source, eventType, payload, failureReason, errorStack, attempts count, nullable eventId.

**Re-queue API (RES-06)**
- D-16: Re-queue logic in `apps/api` (service-layer function + API endpoint). Idempotent via fingerprint + DB unique constraint.

**Routing Rules (RTE-01, RTE-02)**
- D-17: E.164 phone normalization only for v1.
- D-18: Zod discriminated union with `type` field: `{ type: "phone_normalize_e164", field: string }`.
- D-19: Dispatch table (`Record<RuleType, RuleHandler>`) — not if/else.
- D-20: Rules applied at `normalize()` seam in `apps/worker/src/normalizer/normalize.ts`.
- D-21: `routing_rules` Postgres table, Prisma model in `packages/db/prisma/schema.prisma`. Phase 4 ships the migration.
- D-22: Lazy TTL cache — not background `setInterval`. Reload from DB when `now - loadedAt > TTL`.

### Claude's Discretion
- Exact `routing_rules` schema columns (enabled flag, source filter, priority ordering)
- `CrmClient` interface method names and HTTP request shape to mock-crm `/crm/sync`
- Whether re-queue goes on a `/admin` router or `/api` router on apps/api
- Test infrastructure for cockatiel policy behavior (mock timers vs real wait)
- `bull-board` — deferred unless trivially cheap

### Deferred Ideas (OUT OF SCOPE)
- Bulk re-queue (Phase 5 dashboard trigger)
- Kill-Postgres integration test (Phase 6, TST-02)
- Playwright E2E for DLQ re-queue flow (Phase 6, TST-04)
- Upstash command count measurement
- `bull-board` queue browser
- Real CRM connector (CONN-01)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RES-01 | Transient failures retried with jittered exponential backoff up to max attempt count | BullMQ `backoff: { type: 'custom' }` + Worker `settings.backoffStrategy` with full-jitter formula |
| RES-02 | Exhausted-retry jobs land in DLQ with full error trace and original payload | BullMQ `worker.on('failed')` with `job.attemptsMade >= job.opts.attempts` guard; writes to `dlq_events` |
| RES-03 | DLQ entries mirrored to Postgres so DLQ history survives Redis loss | Prisma insert into `dlq_events` on job exhaustion; table already exists from Phase 3 |
| RES-04 | Circuit breaker wraps external downstream (mock CRM) sync; opens at failure threshold | cockatiel `circuitBreaker(handleAll, { breaker: new ConsecutiveBreaker(5), halfOpenAfter })` |
| RES-05 | Open breaker routes events to retry/DLQ instead of hammering downstream; recovers via half-open | cockatiel policy composition: Retry wraps CircuitBreaker; `BrokenCircuitError` is caught by outer Retry |
| RES-06 | Operator can re-queue DLQ items; reprocessing is idempotent | `job.retry()` on the failed BullMQ job (preserves jobId/fingerprint); idempotency guaranteed by DB `ON CONFLICT` |
| RES-07 | Killing Postgres mid-processing preserves in-flight queue events | BullMQ jobs stay in Redis when DB write fails; worker retries with backoff; behavior established by Phase 3 architecture |
| RTE-01 | Operators define routing/transformation rules (E.164 normalization) stored in DB | `routing_rules` Prisma model; Zod discriminated union; dispatch table |
| RTE-02 | Rule changes take effect without worker redeploy | Lazy TTL cache in `normalize()` seam; cache invalidated when `now - loadedAt > TTL_MS` |
</phase_requirements>

---

## Summary

Phase 4 is an extension layer, not a new system. Every component in this phase wires into existing Phase 3 entry points — the `normalize()` seam, the `buildProcessor()` factory, the `buildWorker()` factory, and `createEventsQueue()`. No existing behavior is replaced.

The two highest-risk integration points are: (1) the cockatiel policy composition order, where Retry must wrap CircuitBreaker — not the other way around — so that open-breaker errors are retried at the BullMQ level; and (2) the BullMQ custom backoff placement, where the strategy function must live in the Worker's `settings.backoffStrategy`, not the Queue's options, because Queue-level `settings` is not the standard BullMQ pattern for `type: 'custom'` backoff (the Worker is the correct host).

**Primary recommendation:** Wire all Phase 4 components as thin wrappers around the existing DI factories. Keep the cockatiel policy object as a module-level singleton (created once at worker startup, not recreated per job), inject it via `WorkerDeps`, and unit-test it by replacing the HTTP transport with a throwing stub.

---

## Standard Stack

### Core (Phase 4 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cockatiel` | 4.0.0 | Circuit breaker + Retry + Timeout policies | TypeScript-first, composable free functions; ESM-native; requires Node >= 22 (project uses Node 22 in Docker) |
| `bullmq` | 5.78.0 | Queue + `Worker` custom backoff + `worker.on('failed')` DLQ trigger | Already installed; `settings.backoffStrategy` added in v3+ |
| `@prisma/client` (via `@omnisync/db`) | 7.x | Prisma `routing_rules` model + `dlq_events` inserts | Already installed |

### Cockatiel 4.0.0 — Node Version Warning

cockatiel 4.0.0 requires `node >= 22`. The project's Docker images use `node:22-slim` and `.nvmrc` pins to `22`. The local shell may run Node 20 (system install) but that does not affect the container runtime. **Do not downgrade to cockatiel 3.2.1** — v3 uses the old `Policy.method()` builder pattern that the CLAUDE.md stack doc examples were written against v4's free-function API.

The dist-tag `anyengine: 3.0.0-anyengine.0` is a special build for non-22 environments. It is NOT the recommended production version. Use `cockatiel@4.0.0` (latest).

**Installation:**
```bash
pnpm add cockatiel --filter @omnisync/worker
pnpm add --filter apps/mock-crm fastify @fastify/sensible
```

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
apps/
├── mock-crm/
│   ├── src/
│   │   ├── app.ts              # buildMockCrm() Fastify factory
│   │   └── index.ts            # entrypoint
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── worker/src/
│   ├── crm/
│   │   ├── crm-client.ts       # CrmClient interface + HttpCrmClient
│   │   └── crm-policy.ts       # cockatiel policy factory (createCrmPolicy)
│   ├── normalizer/
│   │   ├── normalize.ts        # EXTENDED: routing rule application at seam
│   │   ├── rule-cache.ts       # lazy TTL cache: RulesCache interface
│   │   └── rule-engine.ts      # dispatch table + phone normalize handler
│   └── processor/
│       └── event.processor.ts  # EXTENDED: CRM sync call + cockatiel wrap
packages/
├── queue/src/index.ts          # EXTENDED: attempts + backoff defaultJobOptions + backoffStrategy
├── db/prisma/schema.prisma     # EXTENDED: RoutingRule model
├── config/src/env.ts           # EXTENDED: new env vars
apps/api/src/
│   └── routes/
│       └── admin.ts            # NEW: POST /admin/dlq/:id/requeue
```

---

### Pattern 1: cockatiel Policy Composition

The correct composition order is: **Retry wraps CircuitBreaker wraps CrmClient.sync()**.

When the circuit is open, `circuitBreakerPolicy.execute()` throws `BrokenCircuitError`. The outer `retryPolicy` catches this and schedules a retry. On the next attempt (after BullMQ's backoff delay), if the breaker has half-opened, the probe goes through. This is the correct "retry-with-circuit-breaker" pattern — errors from an open breaker count against the job's retry budget, not the breaker's failure count.

```typescript
// Source: cockatiel 4.0.0 API + APIScout guide verified 2026-06-13
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  handleAll,
  retry,
  wrap,
  BrokenCircuitError,
} from 'cockatiel';

// Create once at worker startup, inject via WorkerDeps
export function createCrmPolicy(halfOpenAfterMs: number) {
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(5),
  });

  // Optional: log state transitions for the portfolio demo
  breakerPolicy.onBreak(() => logger.warn({}, '[crm] circuit opened'));
  breakerPolicy.onReset(() => logger.info({}, '[crm] circuit closed'));
  breakerPolicy.onHalfOpen(() => logger.info({}, '[crm] circuit half-open'));

  // Retry is the outer policy; when breaker is open, BrokenCircuitError is a
  // transient error from retry's perspective — job retries on BullMQ's schedule.
  // NOTE: cockatiel's own retry is NOT used here — BullMQ handles retry scheduling.
  // The policy is executed once per BullMQ attempt; the circuit breaker accumulates
  // consecutive failures across attempts (it is a module-level singleton).
  return breakerPolicy;  // single policy; Retry is BullMQ-level
}

// In event.processor.ts — call CRM through breaker
try {
  await breakerPolicy.execute(() => crmClient.sync(normalized));
} catch (err) {
  if (err instanceof BrokenCircuitError) {
    // Breaker is open — let BullMQ retry with backoff (D-02/RES-05)
    throw err;
  }
  // Other CRM errors — also throw so BullMQ retries
  throw err;
}
```

**Critical design point:** Do not use cockatiel's `retry()` to wrap the circuit breaker. BullMQ IS the retry mechanism. Using both would create nested retry loops with mismatched backoff. The cockatiel policy object is a **per-job-processor circuit accumulator** — it tracks consecutive failures across multiple BullMQ job attempts because it is a module-level singleton.

**Alternative interpretation (D-02 literal):** If D-02 is interpreted as "cockatiel Retry wraps CircuitBreaker in a single cockatiel `wrap()`", the policy executes the CRM call with cockatiel-managed retries AND the breaker. This is only correct if BullMQ `attempts` is set to 1 (no BullMQ retries) and cockatiel handles all retries. However D-13 locks `RETRY_ATTEMPTS=5` as BullMQ retry count, which conflicts. The recommended interpretation: BullMQ manages job retry scheduling; cockatiel's `circuitBreaker(handleAll, ...)` is the single guard. This resolves the conflict and is more defensible architecturally ("retry is a property of the pipeline, D-10").

### Pattern 2: BullMQ Custom Backoff Strategy

The custom backoff strategy function belongs in the **Worker's `settings` object**, not the Queue's options. The Queue's `defaultJobOptions.backoff.type: 'custom'` declares which strategy type to invoke; the Worker's `settings.backoffStrategy` provides the implementation.

```typescript
// Source: https://docs.bullmq.io/guide/retrying-failing-jobs (verified 2026-06-13)

// packages/queue/src/index.ts — Queue-level declaration
export function createEventsQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: env.RETRY_ATTEMPTS,      // e.g., 5
      backoff: { type: 'custom' },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}

// Export the strategy function from packages/queue so Worker can import it
export function fullJitterBackoff(
  attemptsMade: number,
  _type: string,
  _err: Error,
): number {
  // AWS full-jitter: random(0, min(cap, base * 2^attempt))
  // Cite in comment: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
  const base = env.RETRY_BASE_DELAY_MS;
  const cap  = env.RETRY_CAP_MS;
  return Math.random() * Math.min(cap, base * Math.pow(2, attemptsMade));
}

// apps/worker/src/worker.ts — Worker imports and registers the strategy
import { fullJitterBackoff } from '@omnisync/queue';

new Worker(QUEUE_NAME, processor, {
  connection,
  concurrency,
  stalledInterval: 300_000,
  drainDelay: 30,
  settings: {
    backoffStrategy: fullJitterBackoff,
  },
});
```

**Important:** The `settings.backoffStrategy` must be on the Worker constructor, not the Queue constructor. The Queue stores the `type: 'custom'` marker; the Worker provides the implementation function. If the strategy is only on the Queue, the Worker falls back to fixed 0ms delay.

**Second important note:** One blog source incorrectly shows `settings.backoffStrategy` on the Queue constructor. The authoritative BullMQ docs show it on the Worker. Confirmed: Worker `settings` is the correct location.

### Pattern 3: BullMQ `failed` Event Handler for DLQ

```typescript
// Source: BullMQ WorkerListener API docs + oneuptime.com guide (verified 2026-06-13)

// apps/worker/src/worker.ts — add inside buildWorker()
const worker = new Worker(QUEUE_NAME, processor, { ... });

worker.on('failed', async (job: Job | undefined, error: Error) => {
  // job can be undefined when stalled job is deleted by removeOnFail
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  const isExhausted = job.attemptsMade >= maxAttempts;

  if (isExhausted) {
    // Write to dlq_events Postgres mirror (RES-03)
    await prisma.deadLetterEvent.create({
      data: {
        fingerprint: job.data.fingerprint,
        source: job.data.source,
        eventType: job.data.payload?.eventType ?? 'unknown',
        payload: job.data.payload ?? {},
        failureReason: error.message,
        errorStack: error.stack ?? null,
        attempts: job.attemptsMade,
        eventId: null, // set if events row exists (optional lookup)
      },
    });
    logger.error({ jobId: job.id, attempts: job.attemptsMade }, '[worker] job exhausted → DLQ');
  }
});
```

**job.attemptsMade semantics:** Incremented on every error except `RateLimitError`, `DelayedError`, and `WaitingChildrenError`. After the final attempt fails, `job.attemptsMade === job.opts.attempts`. Use `>=` not `===` to be safe.

**job can be undefined:** When a stalled job hits `maxStalledCount` AND `removeOnFail` is set, the worker fires `failed` with `job = undefined`. Always guard with `if (!job) return`.

### Pattern 4: Re-queue via `job.retry()`

```typescript
// Source: https://docs.bullmq.io/guide/jobs/retrying-job (verified 2026-06-13)

// apps/api/src/routes/admin.ts
import { Job } from 'bullmq';

// POST /admin/dlq/:id/requeue
const job = await Job.fromId(queue, dlqEntry.jobId);
if (!job) throw new Error(`Job ${dlqEntry.jobId} not found in BullMQ failed set`);

// job.retry() moves the job from failed → waiting, preserving the original jobId (fingerprint).
// resetAttemptsMade resets the counter so the job gets a fresh retry budget.
await job.retry('failed', { resetAttemptsMade: true });
```

**Why `job.retry()` over `queue.add()`:**
- `job.retry()` preserves the original `jobId` (which equals the fingerprint). BullMQ deduplicates by jobId, so re-queuing the same fingerprint multiple times is safe.
- `queue.add()` with the same `jobId` (fingerprint) would be silently ignored if the completed/failed job still exists in Redis.
- `job.retry()` resets `failedReason`, `finishedOn`, `processedOn` — clean state for reprocessing.
- Idempotency for the DB insert is guaranteed by the existing `ON CONFLICT (fingerprint) DO NOTHING` — even if the event was already processed, the processor completes cleanly with "duplicate absorbed".

**Re-queue endpoint idempotency:** If the re-queue is clicked twice:
1. First call: `job.retry()` succeeds, job moves to waiting.
2. Second call: `Job.fromId()` finds the job in waiting state, not failed. `job.retry('failed')` throws because the job is not in the failed set. Handle with try/catch and return a 409 Conflict or 200 (already queued).

### Pattern 5: Lazy TTL Cache for Routing Rules

```typescript
// apps/worker/src/normalizer/rule-cache.ts
interface RulesCache {
  rules: RoutingRule[];
  loadedAt: number;
}

let cache: RulesCache | null = null;

export async function getActiveRules(
  prisma: PrismaClient,
  ttlMs: number,
): Promise<RoutingRule[]> {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < ttlMs) {
    return cache.rules;
  }
  // TTL expired or cold start — reload synchronously (awaited in the job processor)
  const rules = await prisma.routingRule.findMany({ where: { enabled: true } });
  cache = { rules, loadedAt: now };
  return rules;
}
```

**Why not `setInterval`:** A background timer runs even when there's no work, adding Redis polling and keepalive pressure (relevant to Upstash free tier). Lazy TTL only hits the DB when a job is being processed. A 30-second TTL means the DB is queried at most once per 30 seconds under continuous load, once per first-job if idle.

**Thread safety:** Node.js is single-threaded; no lock needed. Multiple concurrent jobs may trigger simultaneous reloads if TTL expires at exactly the same moment — harmless (two DB reads, second result overwrites first, both have identical data).

### Pattern 6: Routing Rule Dispatch Table

```typescript
// apps/worker/src/normalizer/rule-engine.ts
import { parsePhoneNumber } from 'libphonenumber-js'; // or hand-roll if too heavy

type RuleHandler = (value: unknown) => unknown;

const ruleHandlers: Record<string, RuleHandler> = {
  phone_normalize_e164: (value: unknown) => {
    if (typeof value !== 'string') return value;
    try {
      const parsed = parsePhoneNumber(value, 'ID'); // default country context
      return parsed.format('E.164');
    } catch {
      return value; // non-parseable phone — pass through unchanged
    }
  },
  // Future rule types added here — no refactoring needed
};

export function applyRule(rule: RoutingRule, payload: Record<string, unknown>): Record<string, unknown> {
  const handler = ruleHandlers[rule.type];
  if (!handler || !(rule.field in payload)) return payload;
  return { ...payload, [rule.field]: handler(payload[rule.field]) };
}
```

**Note on phone parsing library:** `libphonenumber-js` is the standard for E.164 normalization — 40KB gzipped. Alternatively, a simple regex for Indonesian numbers (`+62...`) is sufficient for v1 demo purposes and avoids a dependency. Claude's discretion — the interface is what matters.

### Pattern 7: mock-crm Fastify App

```typescript
// apps/mock-crm/src/app.ts
import Fastify from 'fastify';

let failureMode: { mode: 'ok' | 'fail' | 'slow'; rate: number } = { mode: 'ok', rate: 0 };

export function buildMockCrm() {
  const app = Fastify({ logger: true });

  app.post('/crm/sync', async (req, reply) => {
    if (failureMode.mode === 'fail' && Math.random() < failureMode.rate) {
      return reply.code(500).send({ error: 'MOCK_CRM_FAILURE' });
    }
    if (failureMode.mode === 'slow') {
      await new Promise(r => setTimeout(r, failureMode.rate)); // rate = delay ms
    }
    return reply.code(200).send({ status: 'synced' });
  });

  app.post('/admin/failure-mode', async (req, reply) => {
    failureMode = req.body as typeof failureMode;
    return reply.send({ ok: true });
  });

  return app;
}
```

**HTTP client for CrmClient:** Use Node.js built-in `fetch()` (available since Node 18, stable in Node 22) or `undici.fetch`. The Timeout policy from cockatiel wraps the fetch call, so no `AbortSignal.timeout()` is needed on the fetch itself. Alternatively, pass an `AbortSignal` from cockatiel's `TimeoutPolicy` via the execution context.

```typescript
// apps/worker/src/crm/crm-client.ts
export interface CrmClient {
  sync(event: NormalizedEvent): Promise<void>;
}

export class HttpCrmClient implements CrmClient {
  constructor(private readonly baseUrl: string) {}

  async sync(event: NormalizedEvent): Promise<void> {
    const res = await fetch(`${this.baseUrl}/crm/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: event.fingerprint, source: event.source }),
    });
    if (!res.ok) {
      throw new Error(`CRM sync failed: HTTP ${res.status}`);
    }
  }
}
```

### Pattern 8: Prisma `routing_rules` Model

```prisma
// packages/db/prisma/schema.prisma — add alongside existing models
model RoutingRule {
  id        String   @id @default(uuid())
  type      String   // "phone_normalize_e164" — matches Zod discriminated union
  field     String   // payload field to transform
  enabled   Boolean  @default(true)
  source    String?  // null = applies to all sources; set = source-specific filter
  priority  Int      @default(0) // higher = applied first
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("routing_rules")
  @@index([enabled])
  @@index([source])
}
```

**Claude's discretion exercised:** `source` filter (optional, null = all), `priority` ordering, `enabled` flag. These three columns cover the obvious extension cases (CLAUDE.md explicitly names "field rename/drop" as extension point).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Circuit breaker state machine | Custom open/half-open/closed tracker | `cockatiel` `circuitBreaker()` | Flap prevention, half-open probe sampling, state serialization, event listeners all built in |
| Retry scheduling with jitter | Manual `setTimeout` chain | BullMQ `attempts` + `backoff: { type: 'custom' }` + `settings.backoffStrategy` | BullMQ persists retry state in Redis — process crash does not lose retry position |
| E.164 phone number parsing | Custom regex | `libphonenumber-js` or simple regex (discretion) | Edge cases: country codes, local formats, extensions — regex misses 20% of real-world numbers |
| HTTP timeout enforcement | `Promise.race` with `setTimeout` | `fetch` with `AbortSignal.timeout()` or cockatiel `Timeout` policy | Native `AbortSignal.timeout()` (Node 17.3+) is cleaner; cockatiel `Timeout` integrates with policy chain |

**Key insight:** The circuit breaker state machine has more edge cases than it appears — especially the half-open probe logic, flap prevention (rapid open→close cycling), and the distinction between Isolated vs Open states. cockatiel handles all of these.

---

## Common Pitfalls

### Pitfall 1: cockatiel Policy Object Recreated Per Job
**What goes wrong:** A new `circuitBreaker(...)` policy is created inside the job processor function for each job. Each policy starts in Closed state with zero failure history. 5 consecutive failures never accumulate. The breaker never opens.
**Why it happens:** The policy creation call looks like configuration, not state.
**How to avoid:** Create the policy object **once at worker startup** (in `buildWorker` or `createCrmPolicy()`), inject it via `WorkerDeps`. The policy must be a singleton within the worker process lifetime.
**Warning signs:** Breaker never opens during tests even when CRM returns 500 on every call.

### Pitfall 2: Backoff Strategy on Queue, Not Worker
**What goes wrong:** `settings.backoffStrategy` is placed in the `Queue` constructor options. BullMQ ignores it there. Worker falls back to 0ms delay between retries (immediate retry storm).
**Why it happens:** One community blog post (oneuptime) incorrectly shows `settings` on the Queue. The authoritative BullMQ docs place `settings.backoffStrategy` on the `Worker`.
**How to avoid:** `settings.backoffStrategy` goes in the **Worker** constructor's third argument options object. `defaultJobOptions.backoff.type: 'custom'` goes on the Queue. These are separate configuration objects on separate classes.
**Warning signs:** All retry timestamps in logs are within milliseconds of each other (no spread).

### Pitfall 3: Nested Retry (cockatiel + BullMQ)
**What goes wrong:** `wrap(retryPolicy, circuitBreakerPolicy)` is used where `retryPolicy` is a cockatiel `retry(handleAll, { maxAttempts: 3 })`. Combined with BullMQ's `attempts: 5`, each BullMQ attempt internally retries up to 3 times — 15 total CRM calls per job, with a mix of cockatiel and BullMQ timers.
**Why it happens:** D-02 says "Retry policy wraps CircuitBreaker policy" — this can be read as either cockatiel `wrap()` or BullMQ-as-retry. The correct reading is BullMQ-as-retry.
**How to avoid:** Use only `circuitBreaker(handleAll, ...)` as the cockatiel policy. BullMQ provides all retry scheduling. No cockatiel `retry()` in the worker.
**Warning signs:** Log shows "cockatiel retry attempt 1/3" inside a single BullMQ job attempt.

### Pitfall 4: Circuit Breaker Applied to `persistEvent`
**What goes wrong:** `breakerPolicy.execute()` wraps the Prisma `INSERT` inside `persistEvent()`. When Postgres goes down, the breaker opens on DB failures — but the correct use (RES-07) is that Postgres failures should be retried by BullMQ, NOT trigger the CRM breaker.
**Why it happens:** Postgres is the most visible failure point; Pitfall 7 from PITFALLS.md.
**How to avoid:** The cockatiel circuit breaker wraps **only** `crmClient.sync()`, called after `persistEvent()` returns. Postgres failures (thrown from `persistEvent`) propagate directly to BullMQ's retry mechanism, never touching the circuit breaker.
**Warning signs:** `onBreak` fires when Postgres is killed (should only fire on CRM failures).

### Pitfall 5: `failed` Event Called for Every Failed Attempt, Not Just Final
**What goes wrong:** The `worker.on('failed')` handler writes a DLQ entry on every failure, not just exhaustion. A job with 5 attempts creates 5 DLQ rows with identical fingerprints, violating the DLQ's semantics.
**Why it happens:** BullMQ fires `failed` on every failed attempt, including intermediate retries.
**How to avoid:** Gate the DLQ insert behind `job.attemptsMade >= (job.opts.attempts ?? 1)`. Only the final failure writes to `dlq_events`.
**Warning signs:** `dlq_events` has multiple rows with the same fingerprint.

### Pitfall 6: `job` Undefined in `failed` Handler
**What goes wrong:** `job.data.fingerprint` throws `TypeError: Cannot read properties of undefined` when the stalled job limit is hit with `removeOnFail` active.
**Why it happens:** BullMQ fires `failed` with `job = undefined` in this edge case (documented in WorkerListener).
**How to avoid:** Always guard: `if (!job) return;` at the top of the handler.

### Pitfall 7: `routing_rules` Cache Not Reset on Test Teardown
**What goes wrong:** Unit tests that mutate the module-level `cache` variable leak state between tests. The second test sees rules from the first.
**Why it happens:** Module-level singletons persist between test cases in the same Vitest worker.
**How to avoid:** Export a `resetRulesCache()` function from `rule-cache.ts` and call it in `beforeEach` / `afterEach` in tests. Or design the cache to accept an explicit `now` parameter for time injection in tests.

### Pitfall 8: `job.retry()` Throws When Job is Already in Waiting State
**What goes wrong:** The re-queue endpoint is called twice. Second call throws because the job is no longer in the `failed` set.
**Why it happens:** `job.retry('failed')` only works on jobs in the failed state.
**How to avoid:** Wrap `job.retry()` in try/catch. If the job is not in failed state, return HTTP 409 (Conflict) or 200 with `{ status: 'already_queued' }`.

---

## Code Examples

### Full Worker Deps Extension (Phase 4 additions)

```typescript
// apps/worker/src/worker.ts (extended)
import type { CircuitBreakerPolicy } from 'cockatiel';
import type { CrmClient } from './crm/crm-client.js';
import { fullJitterBackoff } from '@omnisync/queue';

export interface WorkerDeps {
  prisma: PrismaClient;
  connection: Redis;
  logger: ProcessorLogger;
  crmClient: CrmClient;         // NEW: injected HTTP client (or fake in tests)
  crmPolicy: CircuitBreakerPolicy; // NEW: cockatiel circuit breaker singleton
}

export function buildWorker(deps: WorkerDeps, concurrency: number): Worker {
  const processor = buildProcessor(deps.prisma, deps.logger, deps.crmClient, deps.crmPolicy);
  const worker = new Worker(QUEUE_NAME, (job: Job) => processor(job), {
    connection: deps.connection,
    concurrency,
    stalledInterval: 300_000,
    drainDelay: 30,
    settings: {
      backoffStrategy: fullJitterBackoff,
    },
  });

  // DLQ wiring (RES-02, RES-03)
  worker.on('failed', async (job: Job | undefined, error: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await deps.prisma.deadLetterEvent.create({ data: { /* ... */ } });
    }
  });

  return worker;
}
```

### Processor Extension

```typescript
// apps/worker/src/processor/event.processor.ts (extended)
export function buildProcessor(
  prisma: PrismaClient,
  logger: ProcessorLogger,
  crmClient: CrmClient,
  crmPolicy: CircuitBreakerPolicy,
) {
  return async function processEvent(job: Pick<Job, 'id' | 'data'>): Promise<void> {
    // ... existing poison guard + normalize + persistEvent ...

    // Phase 4: CRM sync after successful persist (cockatiel-guarded)
    await crmPolicy.execute(() => crmClient.sync(normalized));
    logger.info({ jobId: job.id }, '[worker] crm synced');
  };
}
```

### env.ts Extension

```typescript
// packages/config/src/env.ts (new vars to add)
RETRY_ATTEMPTS:      z.coerce.number().int().min(1).max(20).default(5),
RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).default(1000),
RETRY_CAP_MS:        z.coerce.number().int().min(1000).default(30000),
BREAKER_HALF_OPEN_MS: z.coerce.number().int().min(1000).default(10000),
RULE_CACHE_TTL_MS:   z.coerce.number().int().min(1000).default(30000),
CRM_BASE_URL:        z.url().default('http://mock-crm:3002'),
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Policy.retry().attempts(3)` (cockatiel v2/v3 builder) | `retry(handleAll, { maxAttempts: 3, backoff: ... })` free function | cockatiel 3.0.0 (2023) | All code examples using the old builder pattern are outdated |
| `opossum` for Node.js circuit breakers | `cockatiel` for TypeScript projects | 2023-2024 | opossum still valid but less TypeScript-native |
| `guardInterval` in BullMQ QueueOptions | Removed in BullMQ v2 (QueueScheduler deprecated) | BullMQ v2 (2022) | Already corrected in Phase 3 (D-09 amendment) |
| `backoff: { type: 'exponential' }` (BullMQ built-in) | `backoff: { type: 'custom' }` + `settings.backoffStrategy` | BullMQ v3+ | Built-in exponential has no jitter; custom is required for full-jitter |

**Deprecated/outdated:**
- `Policy.handleAll().retry()` chain: replaced by free function `retry(handleAll, options)` in cockatiel 3.0.0+
- BullMQ `guardInterval`: dead config since BullMQ v2 (already removed in Phase 3)

---

## Open Questions

1. **cockatiel `wrap()` vs single `circuitBreaker()` policy**
   - What we know: D-02 says "Retry policy wraps CircuitBreaker policy" but D-13 establishes BullMQ retry (`RETRY_ATTEMPTS=5`). Using both cockatiel `retry` and BullMQ retry creates nested loops.
   - What's unclear: Whether D-02 intends cockatiel-level retry composition (overriding BullMQ retry) or just means "retry is the outer layer in the pipeline" (BullMQ-as-retry, cockatiel-as-breaker).
   - Recommendation: Use **BullMQ for retry, cockatiel for circuit breaker only**. This is the correct distributed-systems pattern and resolves the D-02/D-13 tension. Document the architectural reasoning in a code comment.

2. **`CrmClient` interface method name and mock-crm sync endpoint body shape**
   - What we know: D-07 names the interface; D-08 names `/crm/sync` as the endpoint.
   - What's unclear: What fields mock-crm's `/crm/sync` needs in the POST body — just fingerprint, or the full normalized event?
   - Recommendation: Send `{ fingerprint, source, eventType, payload }` — minimal data needed for a CRM audit trail. Mock-crm ignores most of it; this shapes the real interface for a future connector.

3. **Phone normalization library weight**
   - What we know: `libphonenumber-js` is the standard but adds ~40KB to the worker bundle.
   - What's unclear: Whether the demo requires international numbers or just Indonesian (ID) numbers.
   - Recommendation: Use a simple Indonesian-focused regex for v1 (`/^0(\d{8,11})$/ → +62$1`). Document that `libphonenumber-js` replaces it for production. Zero new dependency, demonstrably extensible.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | cockatiel 4.0.0 | Docker: yes (`node:22-slim`) | 22.x in container | Use `cockatiel@3.2.1-anyengine` only if local dev on Node 20 needed for tests |
| PostgreSQL | dlq_events writes, routing_rules | Available (docker-compose) | 16 | — |
| Redis | BullMQ queue, custom backoff | Available (docker-compose) | 7 | — |
| Built-in `fetch` | HttpCrmClient | Node 22 built-in | stable | `undici.fetch` as alternative |
| `cockatiel` | Circuit breaker | Not yet installed | 4.0.0 (latest) | — |

**Missing dependencies with no fallback:**
- `cockatiel` must be installed via `pnpm add cockatiel --filter @omnisync/worker`

**Missing dependencies with fallback:**
- None — all other dependencies already present

---

## Validation Architecture

`workflow.nyquist_validation` is enabled in `.planning/config.json` (key present and `true` by default).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `apps/worker/vitest.config.ts` (exists) |
| Quick run command | `pnpm --filter @omnisync/worker test` |
| Full suite command | `pnpm --filter @omnisync/worker test:coverage` |
| Coverage target | ≥80% lines (already configured in vitest.config.ts) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RES-01 | Jitter formula returns value in `[0, min(cap, base * 2^n)]` | unit | `pnpm --filter @omnisync/worker test -- tests/unit/backoff.test.ts` | ❌ Wave 0 |
| RES-01 | Worker retry timestamps are spread (no thundering herd) | unit/mock | `pnpm --filter @omnisync/worker test -- tests/unit/backoff.test.ts` | ❌ Wave 0 |
| RES-02 | `worker.on('failed')` only writes to DLQ on final attempt | unit | `pnpm --filter @omnisync/worker test -- tests/unit/dlq-handler.test.ts` | ❌ Wave 0 |
| RES-02 | DLQ entry captures fingerprint, source, eventType, payload, error | unit | same file | ❌ Wave 0 |
| RES-03 | DLQ Postgres insert verified | integration | `pnpm --filter @omnisync/worker test -- tests/integration/dlq.test.ts` | ❌ Wave 0 |
| RES-04 | Circuit breaker opens after 5 consecutive CRM failures | unit | `pnpm --filter @omnisync/worker test -- tests/unit/crm-policy.test.ts` | ❌ Wave 0 |
| RES-05 | Open breaker causes job to throw `BrokenCircuitError` (not hammer CRM) | unit | same file | ❌ Wave 0 |
| RES-05 | Killing Postgres does NOT open the CRM circuit breaker | unit | `tests/unit/processor.test.ts` (extend existing) | ✅ (extend) |
| RES-06 | Re-queue endpoint moves failed job to waiting; idempotency holds | integration | `pnpm --filter @omnisync/api test -- tests/integration/requeue.test.ts` | ❌ Wave 0 |
| RES-07 | (Behavior) Events stay in queue when Postgres is down | covered by Phase 3 architecture; formal test is Phase 6 (TST-02) | manual | N/A |
| RTE-01 | Phone normalization transforms matching field correctly | unit | `pnpm --filter @omnisync/worker test -- tests/unit/rule-engine.test.ts` | ❌ Wave 0 |
| RTE-01 | Non-phone fields are not modified | unit | same file | ❌ Wave 0 |
| RTE-02 | Cache reloads after TTL expires (not before) | unit | `pnpm --filter @omnisync/worker test -- tests/unit/rule-cache.test.ts` | ❌ Wave 0 |
| RTE-02 | Cache does not reload within TTL window | unit | same file | ❌ Wave 0 |

### Testing cockatiel Policies Without Real Delays

The circuit breaker's `halfOpenAfter: 10000` ms makes real-timer tests impractical. Two strategies:

**Strategy A (Recommended): Inject fake `CrmClient` that throws/succeeds on demand**
- Create a `FakeCrmClient` with a `setMode('fail' | 'ok')` method.
- Test the breaker by calling the policy 5 times with a failing client → assert `BrokenCircuitError` on 6th call.
- No timer manipulation needed. The breaker opens based on consecutive failures, not time.
- `halfOpenAfter` only controls how long the breaker stays open. To test recovery: set `halfOpenAfter: 0` (or 1ms) in the test policy and use `vi.useFakeTimers()` to advance past it.

```typescript
// tests/unit/crm-policy.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrokenCircuitError } from 'cockatiel';
import { createCrmPolicy } from '../../src/crm/crm-policy.js';

describe('circuit breaker — ConsecutiveBreaker(5)', () => {
  it('opens after 5 consecutive failures', async () => {
    const policy = createCrmPolicy(1); // 1ms halfOpenAfter for tests
    const failingClient = { sync: async () => { throw new Error('CRM 500'); } };

    for (let i = 0; i < 5; i++) {
      await expect(policy.execute(() => failingClient.sync())).rejects.toThrow();
    }
    // 6th call: breaker is open
    await expect(policy.execute(() => failingClient.sync())).rejects.toBeInstanceOf(BrokenCircuitError);
  });

  it('closes after half-open probe succeeds', async () => {
    vi.useFakeTimers();
    const policy = createCrmPolicy(100); // 100ms halfOpenAfter
    // ... open the breaker ...
    vi.advanceTimersByTime(101);
    // probe call succeeds → breaker closes
    await expect(policy.execute(() => Promise.resolve())).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
```

**Strategy B: Integration test against real mock-crm**
- Start mock-crm locally (or in docker-compose for CI).
- `POST /admin/failure-mode { mode: "fail", rate: 1.0 }` → run 5 jobs → assert breaker opens.
- More realistic but slower and requires extra infra in CI.

### Sampling Rate

- **Per task commit:** `pnpm --filter @omnisync/worker test` (unit tests only, no infra required)
- **Per wave merge:** `pnpm --filter @omnisync/worker test:coverage`
- **Phase gate:** Full suite green (unit + integration) before `/gsd:verify-work`

### Wave 0 Gaps (files to create before implementation)

- [ ] `apps/worker/tests/unit/backoff.test.ts` — covers RES-01 jitter formula
- [ ] `apps/worker/tests/unit/dlq-handler.test.ts` — covers RES-02 final-attempt guard
- [ ] `apps/worker/tests/unit/crm-policy.test.ts` — covers RES-04/RES-05 breaker behavior
- [ ] `apps/worker/tests/unit/rule-engine.test.ts` — covers RTE-01 phone normalization
- [ ] `apps/worker/tests/unit/rule-cache.test.ts` — covers RTE-02 TTL invalidation
- [ ] `apps/worker/tests/integration/dlq.test.ts` — covers RES-03 Postgres mirror
- [ ] `apps/api/tests/integration/requeue.test.ts` — covers RES-06 re-queue endpoint
- [ ] `apps/mock-crm/src/app.ts` + `package.json` + `tsconfig.json` — new app, Wave 0 scaffold

*(Existing test files `processor.test.ts`, `worker.test.ts`, `normalize.test.ts` require extension, not new files)*

---

## Project Constraints (from CLAUDE.md)

| Constraint | Source | Applies To |
|------------|--------|------------|
| `zod/v4` subpath import (not `'zod'`) | CLAUDE.md Patterns | All new Zod schemas (RoutingRule, env vars) |
| ESM-native (`"type": "module"`, `.js` extensions in imports) | CLAUDE.md Patterns | All new files |
| Biome formatting (no Prettier) | CLAUDE.md Tools | All new source files |
| Conventional Commits `type(04): summary` | CLAUDE.md Commits | All Phase 4 commits |
| `@omnisync/config` fail-fast env pattern | CLAUDE.md Stack | All new env vars (BREAKER_HALF_OPEN_MS, RETRY_*, RULE_CACHE_TTL_MS, CRM_BASE_URL) |
| No `guardInterval` in BullMQ (dead config) | Phase 3 STATE.md decision | `createEventsQueue` updates |
| `stalledInterval`/`drainDelay` are WorkerOptions | Phase 3 STATE.md decision | New Worker construction must preserve these |
| Near-zero / free-tier only | CLAUDE.md Constraints | mock-crm: docker-compose only, NOT a third Render service (D-09) |
| ≥80% test coverage gate (vitest.config.ts) | CLAUDE.md Quality | New code in `src/` must not drop coverage below 80% |
| At-least-once design center | PITFALLS.md / CLAUDE.md | All worker code must be safe to run twice |
| DI factory pattern (`buildApp`, `buildWorker`) | Phase 2/3 pattern | `CrmClient` injected into `WorkerDeps`; policy injected into `WorkerDeps` |
| No check-then-act in DB writes | PITFALLS.md #3 | DLQ insert: `upsert` with unique constraint or accept duplicate DLQ rows (fingerprint+frozenAt are not unique) |

---

## Sources

### Primary (HIGH confidence)
- BullMQ official docs (https://docs.bullmq.io/guide/retrying-failing-jobs) — custom backoff strategy, `settings.backoffStrategy` on Worker
- BullMQ WorkerListener API (https://api.docs.bullmq.io/interfaces/v5.WorkerListener.html) — `failed` event signature: `(job: Job | undefined, error: Error, prev: string) => void`
- BullMQ retry job docs (https://docs.bullmq.io/guide/jobs/retrying-job) — `job.retry('failed', { resetAttemptsMade: true })` API
- BullMQ stop-retrying docs (https://docs.bullmq.io/patterns/stop-retrying-jobs) — `UnrecoverableError` for permanent errors
- cockatiel GitHub source (`src/CircuitBreakerPolicy.ts`) — `ICircuitBreakerOptions`, `CircuitState`, `BrokenCircuitError`, `IsolatedCircuitError`
- cockatiel 4.0.0 changelog — breaking change: Node >= 22 required; free function API replacing `Policy.method()` builder
- npm registry — cockatiel 4.0.0 is latest; `engines: { node: '>=22' }`; npm view bullmq version = 5.78.0

### Secondary (MEDIUM confidence)
- APIScout 2026 resilience guide — cockatiel `circuitBreaker(handleAll, { breaker: new ConsecutiveBreaker(5), halfOpenAfter })` + `wrap(retry, breaker)` example; verified against cockatiel source
- oneuptime BullMQ dead letter queue guide (2026-01-21) — `job.attemptsMade >= maxAttempts` guard pattern; verified against BullMQ docs
- oneuptime BullMQ retry guide (2026-01-21) — `settings.backoffStrategy` on Worker; verified against official docs

### Tertiary (LOW confidence — not critical paths)
- General claim that `libphonenumber-js` is ~40KB gzipped: not individually verified, widely cited
- `job.retry()` preserving jobId: implied by docs, not explicitly stated

---

## Metadata

**Confidence breakdown:**
- cockatiel API (circuitBreaker, ConsecutiveBreaker, BrokenCircuitError): HIGH — verified against CircuitBreakerPolicy.ts source and changelog
- BullMQ backoff strategy (Worker `settings.backoffStrategy`): HIGH — official docs confirmed
- BullMQ `failed` event signature: HIGH — WorkerListener API confirmed
- `job.retry()` idempotency: MEDIUM — behavior implied, not explicitly documented
- Routing rules architecture: HIGH — Claude's discretion domain, no external verification needed
- Phone normalization implementation: MEDIUM — E.164 standard well-known, specific library choice is discretion

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (BullMQ releases weekly; cockatiel stable)
