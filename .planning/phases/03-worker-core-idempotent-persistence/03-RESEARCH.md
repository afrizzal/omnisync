# Phase 3: Worker Core & Idempotent Persistence - Research

**Researched:** 2026-06-10
**Domain:** BullMQ v5 worker, Prisma 7 idempotent writes, PostgreSQL schema migration, Vitest integration testing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Normalization = canonical envelope extraction. Worker extracts `source`, `eventType`, `externalId`, `occurredAt` into typed columns; full validated inbound event in `payload` (Json). Phase 3 adds migration for `externalId String` and `occurredAt DateTime` columns. `occurredAt` stored canonicalized via `new Date(x).toISOString()` (same rule as fingerprint, commit eb6a4d9).
- **D-02:** Semantic/business transformation (E.164 phone, field mapping) is Phase 4 territory. Only seam needed: a single `normalize(event)` function boundary.
- **D-03:** Single atomic write per event: `INSERT … ON CONFLICT DO NOTHING` semantics with `status: COMPLETED` in one insert. NO multi-stage DB status transitions. Exact Prisma mechanism is a planner choice.
- **D-04:** Lifecycle observability via structured pino logs (received / processing / completed / duplicate-absorbed / failed), NOT DB status updates.
- **D-05:** A conflict (row already exists) is **success** — job completes normally, logs `duplicate absorbed`.
- **D-06:** Phase 3 ships a migration redesigning `dlq_events` to standalone — remove `eventId` FK (required cascade), new shape: `id`, `fingerprint String @index`, `source`, `eventType`, `payload Json`, `failureReason String`, `errorStack String?`, `attempts Int`, `resolved Boolean @default(false)`, `frozenAt DateTime @default(now())`, nullable `eventId String?` (plain column, NO FK). Remove `Event.dlq` relation.
- **D-07:** Refactor `packages/queue` to side-effect-free factories: `createRedisConnection(url)` and `createEventsQueue(connection)`. App entrypoints construct instances using validated `@omnisync/config` env. Package never reads `process.env`.
- **D-08:** `createEventsQueue` sets `defaultJobOptions`: `removeOnComplete: { age: 3600, count: 1000 }` and `removeOnFail: { age: 7 * 24 * 3600 }`.
- **D-09:** Phase 1 D-10 interval values must be re-verified against BullMQ v5 current API. Amendment mandate: preserve intent (Upstash free-tier command-quota), correct mechanism to whatever v5 actually supports.
- **D-10:** New `EventJobData` Zod schema in `@omnisync/types`: `{ source: EventSource, payload: InboundEvent, fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }`. Worker runtime-validates `job.data` with `safeParse`. Invalid → fail job with explicit error message.
- **D-11:** Mirror Phase 2 pattern: `buildWorker(deps)` factory with injected deps (prisma client, redis connection). `apps/worker/src/index.ts` wires live instances and graceful shutdown on SIGINT/SIGTERM.
- **D-12:** `WORKER_CONCURRENCY` env var (default `5`), added to `@omnisync/config` schema as optional-with-default. Pool size ≥ concurrency (SC-4).
- **D-13:** Unit tests (normalization, EventJobData validation, idempotent-persist with mocked prisma) PLUS integration tests against real local Postgres + Redis proving SC-2 and SC-3.
- **D-14:** Remove `@omnisync/db` import from `apps/api/src/index.ts`. API structurally cannot touch DB after this.

### Claude's Discretion

- Exact file layout in `apps/worker/src/` (processor/normalizer/persistence module split).
- Prisma write mechanism (`createMany skipDuplicates` vs raw SQL) — pick per Prisma 7 best practice.
- Integration-test harness choice (compose-services vs Testcontainers) and how CI runs it.
- Log field shapes and event names (keep consistent with existing pino usage).
- Whether `bull-board` is worth adding now (lean: defer unless trivially cheap).

### Deferred Ideas (OUT OF SCOPE)

- Retry/backoff config (`attempts`, jittered backoff) — Phase 4 (RES-01).
- DLQ logic (failed-handler → `dlq_events` mirror) — Phase 4 (RES-02/03). Phase 3 only ships the corrected schema (D-06).
- Kill-Postgres durability test — Phase 6 (TST-02).
- Worker `/healthz` + keep-alive wiring — Phase 6 (deployment).
- Upstash command-count measurement — research flag only, not a UAT gate.
- `bull-board` queue browser — optional, deferred.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUE-02 | A separate, always-on worker process (distinct from the API process) consumes events from the queue | buildWorker factory pattern (D-11), BullMQ Worker class, docker-compose worker service |
| QUE-03 | Workers process events concurrently with a configurable concurrency limit | WORKER_CONCURRENCY env var (D-12), BullMQ Worker `concurrency` option, pool size formula |
| QUE-04 | Worker normalizes each event into a canonical schema before persistence | normalize(event) seam (D-01/D-02), EventJobData schema (D-10), canonical envelope columns |
| IDM-02 | PostgreSQL `UNIQUE(fingerprint)` constraint with `INSERT … ON CONFLICT DO NOTHING` guarantees at-most-once storage | `$executeRaw` ON CONFLICT pattern, createMany skipDuplicates analysis (D-03) |
| IDM-03 | Re-delivering or re-queuing the same event never creates a duplicate stored record | D-05 conflict-as-success pattern, two-layer dedup architecture |
</phase_requirements>

---

## Summary

Phase 3 completes the happy path: BullMQ worker consumes jobs enqueued by the API, normalizes them into canonical form, and persists them idempotently to PostgreSQL. The critical research questions were the BullMQ v5 API correctness (D-09), the Prisma 7 idempotent write mechanism (D-03), the DLQ schema redesign migration (D-06), and the concurrency-versus-pool-size relationship (D-12/SC-4).

The most important finding is that `guardInterval` does not exist in BullMQ v5 and never should have been in the locked config. `QueueScheduler` was removed in BullMQ v2; by v5 the functionality was folded into the Worker itself. The correct free-tier tuning options are `stalledInterval` and `drainDelay`, both `WorkerOptions`, with confirmed defaults of 30000ms and 5s respectively. The Phase 1 D-10 lock is now formally superseded by D-09: remove `guardInterval` entirely, retain `stalledInterval` and `drainDelay` with their Upstash-tuned values as `WorkerOptions`.

For idempotent persistence, `$executeRaw` with `INSERT … ON CONFLICT (fingerprint) DO NOTHING` is the recommended mechanism: it is atomic, returns affected row count (1 = inserted, 0 = conflict absorbed), enables the `duplicate absorbed` log (D-05), and is not subject to the `createMany skipDuplicates` limitation of returning only a total count without distinguishing insert vs. skip. `createMany skipDuplicates` works but hides whether the record was actually new or absorbed.

**Primary recommendation:** Use `prisma.$executeRaw` for the idempotent insert, `stalledInterval`/`drainDelay` as `WorkerOptions` (removing `guardInterval` entirely), set `pg` pool `max` to `WORKER_CONCURRENCY + 2`, and use docker-compose services for integration tests (simpler than Testcontainers on Windows).

---

## Standard Stack

### Core (this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bullmq` | 5.77.x (pinned in repo) | Job queue worker | Already in repo; Worker class consumes from the events queue |
| `ioredis` | 5.10.1 (pinned in repo) | Redis client | Pinned to match BullMQ bundled ioredis — must not change |
| `prisma` / `@prisma/client` | 7.8.x (in repo) | ORM + `$executeRaw` | Rust-free, ESM-native; `$executeRaw` gives atomic ON CONFLICT |
| `@prisma/adapter-pg` | 7.8.x (in repo) | pg driver adapter | Required for Prisma 7 PrismaClient construction |
| `pg` | 8.21.x (in repo) | PostgreSQL client | Underlying pool; configure `max` for concurrency |
| `zod/v4` | 4.4.x (in repo) | EventJobData schema + safeParse | Runtime validation of job.data |
| `vitest` | 4.1.8 (in repo) | Unit + integration tests | Already enforced as CI gate |

### Worker-specific additions (new installs)

None required. All dependencies are already present in the monorepo packages. `apps/worker/package.json` needs to add `vitest` and `@vitest/coverage-v8` as devDependencies (mirroring `apps/api`) and `bullmq`/`ioredis`/`zod` as direct deps (same pattern as `apps/api` — NodeNext resolution requires direct deps).

### Installation additions for `apps/worker`

```bash
cd apps/worker
pnpm add bullmq@^5.77.0 ioredis@5.10.1 zod@^4.4.0
pnpm add -D vitest@4.1.8 @vitest/coverage-v8@4.1.8 tsx@^4.0.0
```

---

## Architecture Patterns

### Recommended File Layout (Claude's Discretion)

```
apps/worker/src/
├── index.ts              # Entrypoint — wire deps, buildWorker, graceful shutdown
├── worker.ts             # buildWorker(deps) factory — mirrors buildApp pattern
├── processor/
│   └── event.processor.ts  # BullMQ processor fn: validate → normalize → persist
├── normalizer/
│   └── normalize.ts      # normalize(event: EventJobData): NormalizedEvent boundary seam
└── persistence/
    └── persist-event.ts  # persistEvent(prisma, normalized) — $executeRaw idempotent insert
```

### Pattern 1: buildWorker(deps) Factory (D-11)

Mirror the proven `buildApp(deps)` pattern from Phase 2. The factory takes injected dependencies so unit tests can pass mocks.

```typescript
// apps/worker/src/worker.ts
import type { PrismaClient } from "@omnisync/db";
import type { Redis } from "ioredis";
import { Worker } from "bullmq";
import { QUEUE_NAME } from "@omnisync/queue";
import { buildProcessor } from "./processor/event.processor.js";

export interface WorkerDeps {
  prisma: PrismaClient;
  redis: Pick<Redis, "quit" | "disconnect">;
}

export function buildWorker(deps: WorkerDeps, concurrency: number): Worker {
  const processor = buildProcessor(deps.prisma);
  return new Worker(QUEUE_NAME, processor, {
    connection: deps.redis as Redis,
    concurrency,
    stalledInterval: 300_000,  // 5 min (Upstash free-tier tuning)
    drainDelay: 30,            // 30s (Upstash free-tier tuning)
  });
}
```

### Pattern 2: Side-Effect-Free Queue Factory (D-07)

Replace the current module-level `new Redis(...)` and `new Queue(...)` with factory functions.

```typescript
// packages/queue/src/index.ts (new shape)
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAME = "events";

export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createEventsQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
```

**Breaking change for `apps/api/src/index.ts` and `apps/worker/src/index.ts`:** Both must construct instances via these factories. The `AppDeps` interface in `app.ts` already uses `Pick<Queue, "add">` so the type-side of the API is unaffected.

### Pattern 3: Idempotent Atomic Insert via $executeRaw (D-03)

**Recommendation: `$executeRaw` over `createMany skipDuplicates`.**

Rationale: `$executeRaw` returns the number of rows affected (1 = inserted, 0 = conflict absorbed), enabling the `duplicate absorbed` log (D-05). `createMany { skipDuplicates: true }` also generates `ON CONFLICT DO NOTHING` under the hood for PostgreSQL, but returns only a total `count` — for a single-record insert you get either `{ count: 1 }` or `{ count: 0 }`, which is technically sufficient. The `$executeRaw` approach is more explicit, more common in production code, and maps better to the SQL narrative in interviews.

```typescript
// apps/worker/src/persistence/persist-event.ts
import { Prisma } from "@omnisync/db";
import type { PrismaClient } from "@omnisync/db";

export interface NormalizedEvent {
  fingerprint: string;
  source: string;
  eventType: string;
  externalId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export async function persistEvent(
  prisma: PrismaClient,
  event: NormalizedEvent,
): Promise<"inserted" | "duplicate"> {
  const affected = await prisma.$executeRaw`
    INSERT INTO events (
      id, fingerprint, source, "eventType", "externalId",
      "occurredAt", payload, status, "retryCount", "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid(),
      ${event.fingerprint},
      ${event.source},
      ${event.eventType},
      ${event.externalId},
      ${event.occurredAt},
      ${event.payload}::jsonb,
      'COMPLETED'::"EventStatus",
      0,
      now(),
      now()
    )
    ON CONFLICT (fingerprint) DO NOTHING
  `;
  return affected === 1 ? "inserted" : "duplicate";
}
```

**Note:** Prisma 7 with `$executeRaw` uses tagged template literals with parameterized values (safe against SQL injection). The `::jsonb` cast is needed for the Json column; `'COMPLETED'::"EventStatus"` is the Prisma-generated enum cast.

**Alternative — `createMany skipDuplicates`** is valid if you don't need insert-vs-absorbed distinction:

```typescript
const result = await prisma.event.createMany({
  data: [{ ...eventData, status: "COMPLETED" }],
  skipDuplicates: true,
});
// result.count === 1 → inserted; result.count === 0 → duplicate
```

Both generate `ON CONFLICT DO NOTHING` for PostgreSQL. Pick `$executeRaw` for explicitness.

### Pattern 4: BullMQ v5 Worker Graceful Shutdown (D-11)

```typescript
// apps/worker/src/index.ts (shutdown section)
const worker = buildWorker(deps, concurrency);

async function shutdown(): Promise<void> {
  worker.log?.info("[worker] shutdown signal received — draining in-flight jobs");
  await worker.close();           // waits for all in-flight jobs to complete or fail
  await deps.prisma.$disconnect();
  await deps.redis.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

**Order is mandatory:** `worker.close()` must resolve before disconnecting Redis. If Redis disconnects first, `worker.close()` will throw on any pending lock renewals.

`worker.close()` does NOT have a built-in timeout — it waits indefinitely for in-flight jobs. Set a process-level timeout if needed:

```typescript
const SHUTDOWN_TIMEOUT_MS = 30_000;
async function shutdown(): Promise<void> {
  const timer = setTimeout(() => {
    console.error("[worker] shutdown timeout — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  await worker.close();
  clearTimeout(timer);
  await deps.prisma.$disconnect();
  await deps.redis.quit();
  process.exit(0);
}
```

Docker Compose `stop_grace_period: 35s` should be added to the worker service to allow the 30s timeout before Docker sends SIGKILL.

### Pattern 5: EventJobData Schema and Poison-Message Guard (D-10)

```typescript
// packages/types/src/event.ts — extend with EventJobData
import { z } from "zod/v4";

export const EventJobData = z.object({
  source: EventSource,
  payload: InboundEvent,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EventJobData = z.infer<typeof EventJobData>;
```

**Worker processor pattern:**

```typescript
// apps/worker/src/processor/event.processor.ts
import { EventJobData } from "@omnisync/types";

export function buildProcessor(prisma: PrismaClient) {
  return async function processEvent(job: Job): Promise<void> {
    // Poison-message guard — invalid job data fails immediately
    const parsed = EventJobData.safeParse(job.data);
    if (!parsed.success) {
      throw new Error(
        `[worker] invalid job data for job ${job.id}: ${JSON.stringify(z.treeifyError(parsed.error))}`
      );
      // Throwing causes BullMQ to mark job failed; with Phase 3 defaults (attempts=1),
      // it goes directly to the failed set. Phase 4 wires the DLQ handler.
    }
    // ... normalize and persist
  };
}
```

**Poison-message behavior in Phase 3:** With no `attempts` configured on the queue/job, BullMQ defaults to `attempts: 1` (no retry). A throw on validation failure lands the job directly in the failed set. Phase 4 adds retry config and the DLQ handler. This is the correct Phase 3 boundary — don't pre-build Phase 4 logic here.

**Advanced option (not needed for Phase 3):** A custom `backoffStrategy` can return `-1` to immediately skip retries for permanent errors even when `attempts > 1`. Document in Phase 4.

### Pattern 6: Concurrency vs Pool Size Formula (D-12/SC-4)

**Formula:** `pg pool max = WORKER_CONCURRENCY + 2` (2 spare for migrations / health checks)

The `@prisma/adapter-pg` default pool size is **10** (node-postgres default). With `WORKER_CONCURRENCY=5`, the worker holds at most 5 simultaneous Prisma connections. Each job holds its connection only for the duration of the `$executeRaw` INSERT (milliseconds), not for the full job lifecycle. The pool recycles connections between jobs.

**Configuration in `packages/db/src/index.ts`:**

```typescript
const poolMax = Number(process.env.WORKER_CONCURRENCY ?? "5") + 2;
const adapter = new PrismaPg({
  connectionString,
  max: poolMax,
});
```

However, because `@omnisync/db` is shared by all apps, pool configuration should be passed in as an option or set in the worker entrypoint. The cleanest approach is to expose a `createPrismaClient(options?)` factory from `@omnisync/db` (similar to the queue factory pattern in D-07):

```typescript
// packages/db/src/index.ts
export function createPrismaClient(opts?: { max?: number }): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts?.max ?? 10 });
  return new PrismaClient({ adapter });
}
```

**Local dev pool math:** docker-compose postgres:16 defaults to `max_connections=100`. With `WORKER_CONCURRENCY=5`, pool max=7. Well within limits. At concurrency=20, pool max=22 — still safe.

**Neon (production):** PgBouncer transaction mode sits in front; 10,000 pooled connections available. The formula holds — no special Neon config needed for Phase 3 concurrency levels.

### Pattern 7: Integration Test Harness (D-13)

**Recommendation: docker-compose services (not Testcontainers)**

Rationale for this project:
1. **Windows compatibility** — Testcontainers on Windows requires Docker Desktop with the WSL2 backend. It works, but cold-start time per test suite is 10-30s for container spin-up. The project already has a healthy docker-compose setup.
2. **CI compatibility** — The existing CI gate uses GitHub Actions with service containers declared in the workflow YAML. The same `postgres:16` and `redis:7` service containers are reused.
3. **Simplicity** — docker-compose services are already running for local dev; integration tests connect to them via environment variables. No lifecycle management code needed in test files.

**Testcontainers is deferred** to Phase 6 (TST-02: kill-Postgres durability test) where per-test container lifecycle control is actually necessary.

**Integration test config for `apps/worker`:**

```typescript
// apps/worker/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80 },
    },
  },
});
```

**The 50-concurrent-identical-events test (SC-2):**

```typescript
// apps/worker/tests/integration/idempotency.test.ts
it("50 identical jobs result in exactly 1 events row", async () => {
  const fingerprint = buildFingerprint("SHOPEE", "order.created", "ext-001", "2024-01-01T00:00:00Z");
  const jobData: EventJobData = {
    source: "SHOPEE",
    payload: { /* valid InboundEvent */ },
    fingerprint,
  };

  // Enqueue 50 identical jobs concurrently (BullMQ deduplicates by jobId=fingerprint)
  // But to test the DB constraint we bypass BullMQ dedup by using processEvent directly
  await Promise.all(
    Array.from({ length: 50 }, () =>
      processorFn({ data: jobData } as Job) // direct processor invocation
    )
  );

  const count = await prisma.event.count({ where: { fingerprint } });
  expect(count).toBe(1);
});
```

**Note:** The test invokes the processor function directly (not via BullMQ queue) to bypass BullMQ's own jobId deduplication — this tests the DB constraint directly. This is the correct pattern for proving IDM-02.

---

## BullMQ v5 API Corrections (D-09 Amendment Mandate)

### VERDICT: `guardInterval` is DEAD CONFIG — Remove It

**Finding (HIGH confidence — verified against official BullMQ v5.78.0 API docs):**

`guardInterval` is **not present** in either `WorkerOptions` or `QueueOptions` in BullMQ v5. It was a `QueueScheduler` option. `QueueScheduler` was deprecated and removed in BullMQ v2. By v5, the QueueScheduler's responsibilities were folded directly into the `Worker` class.

The current `packages/queue/src/index.ts` exports `queueOptions` with `guardInterval: 30_000` which has **zero effect** — it is silently ignored by BullMQ v5. The comment "do NOT change values" in that file is incorrect regarding `guardInterval`.

### Correct v5 Free-Tier Tuning

**Both `stalledInterval` and `drainDelay` are `WorkerOptions` (not `QueueOptions`).**

| Option | Location | Default | Recommended for Upstash Free Tier | Purpose |
|--------|----------|---------|-----------------------------------|---------|
| `stalledInterval` | `WorkerOptions` | 30,000 ms | `300_000` (5 min) | How often worker checks for stalled jobs |
| `drainDelay` | `WorkerOptions` | 5 seconds | `30` (30 s) | Long-poll interval when queue is empty |
| `guardInterval` | **DOES NOT EXIST in v5** | — | **Remove entirely** | Was a QueueScheduler option, removed in v2 |

**The `queueOptions` export in `packages/queue` must be removed** — these were never valid Queue options. The Phase 3 refactor (D-07) converts the package to factories; move `stalledInterval` and `drainDelay` into the `buildWorker` factory's `WorkerOptions`.

**Upstash free-tier math (verification):**
- `drainDelay: 30` → 2 polls/min × 60 min × 24h = 2,880 drain heartbeats/day
- `stalledInterval: 300_000` (5 min) → 12 stall checks × 24h = 288 stall checks/day
- Baseline: ~3,168 commands/day idle
- At 100 jobs/day: ~15 commands/job = 1,500 job commands/day
- Total: ~4,668 commands/day = ~140,040 commands/month — well within 500k/month free tier

**`removeOnComplete` / `removeOnFail` shape (D-08):** Verified correct for BullMQ v5. The `KeepJobs` type `{ age: number; count?: number }` is the supported object form.

---

## Prisma 7 Schema Migrations (D-01, D-06)

### D-01: Adding `externalId` and `occurredAt` to `events`

**Two new required columns on a table that may have zero rows** (Phase 2 only enqueues; no persisted rows exist yet). Since no data exists yet in the table, columns can be added as `NOT NULL` with no default value risk.

```prisma
model Event {
  // ... existing fields ...
  externalId   String
  occurredAt   DateTime

  @@map("events")
  @@unique([fingerprint], map: "events_fingerprint_unique")
}
```

**Migration:** `prisma migrate dev --name add-event-canonical-columns` — straightforward `ALTER TABLE ADD COLUMN` with no data migration required (table is empty at this migration point).

**`occurredAt` canonicalization rule:** `new Date(raw.occurredAt).toISOString()` converts any ISO-8601 string to UTC millisecond precision. Store as `DateTime` (maps to `TIMESTAMPTZ` in PostgreSQL). This is the same rule used in `buildFingerprint` (commit eb6a4d9).

### D-06: DLQ Schema Redesign

**Current schema problem:**
```prisma
model DeadLetterEvent {
  eventId  String  @unique          // REQUIRED FK
  event    Event   @relation(...)   // cascade
}
```

If the DB was down when the job exhausted retries, the `events` row may never exist. The DLQ INSERT would violate the FK constraint — a second failure on the failure handler itself.

**New schema:**
```prisma
model DeadLetterEvent {
  id            String   @id @default(uuid())
  fingerprint   String
  source        String
  eventType     String
  payload       Json
  failureReason String
  errorStack    String?
  attempts      Int      @default(0)
  resolved      Boolean  @default(false)
  frozenAt      DateTime @default(now())
  eventId       String?              // nullable plain column, NO FK

  @@map("dlq_events")
  @@index([fingerprint])
  @@index([resolved])
}
```

**Also remove from `Event` model:** The `dlq DeadLetterEvent?` relation field.

**Migration approach for removing FK relation in Prisma 7:**

Prisma will generate an `ALTER TABLE dlq_events DROP CONSTRAINT ...` + `DROP COLUMN eventId` + `ADD COLUMN eventId TEXT` migration. Because the current `dlq_events` table is empty (Phase 4 hasn't wired DLQ logic yet), the migration is safe.

**Use `--create-only` pattern if the auto-generated SQL needs inspection:**
```bash
prisma migrate dev --name redesign-dlq-schema --create-only
# Review the generated SQL, then:
prisma migrate dev
```

The generated migration will include:
```sql
-- Drop FK constraint
ALTER TABLE "dlq_events" DROP CONSTRAINT "DeadLetterEvent_eventId_fkey";
-- Drop old required eventId column
ALTER TABLE "dlq_events" DROP COLUMN "eventId";
-- Add nullable eventId plain column
ALTER TABLE "dlq_events" ADD COLUMN "eventId" TEXT;
-- Add remaining new columns
ALTER TABLE "dlq_events" ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '';
-- etc.
```

The `prisma.config.ts` pattern (`datasource.url`) handles the Neon `directUrl` for migrations; no special migration config needed beyond what Phase 1 established.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job queue deduplication by jobId | Custom Redis dedup in worker | BullMQ `jobId: fingerprint` in `queue.add()` (already implemented in Phase 2) | BullMQ atomically prevents duplicate jobs with same jobId |
| Idempotent DB insert | SELECT-then-INSERT pattern | `$executeRaw` INSERT ON CONFLICT DO NOTHING | Atomic — no race condition; already proven pattern |
| Connection pool management | Manual connection tracking | PrismaPg `max` option | pg pool handles acquisition, release, timeout |
| Job processor isolation | Manual try/catch wrappers | BullMQ Worker error model (throw = fail) | BullMQ handles job state transitions on throw |
| Graceful shutdown drain | Custom job-tracking set | `worker.close()` | BullMQ tracks in-flight jobs internally; `close()` waits for them |

**Key insight:** The combination of BullMQ's jobId deduplication (Layer 1 at enqueue) and PostgreSQL's unique constraint (Layer 2 at persist) means the worker processor itself needs zero custom deduplication logic — just attempt the insert and handle the two outcomes.

---

## Common Pitfalls

### Pitfall 1: guardInterval in packages/queue will be silently ignored

**What goes wrong:** The current `queueOptions` export includes `guardInterval: 30_000`. Passing this to a `Queue` constructor has zero effect in BullMQ v5 — it is not a `QueueOption`. The QueueScheduler was removed in v2. The intent (reduce Upstash polling) is sound but the mechanism is wrong.
**How to avoid:** D-07 refactor removes `queueOptions` entirely and puts `stalledInterval`/`drainDelay` in `buildWorker` as `WorkerOptions`.
**Warning signs:** Search for `guardInterval` in the codebase after the refactor — should be zero results.

### Pitfall 2: check-then-act race in the worker processor

**What goes wrong:** `SELECT * FROM events WHERE fingerprint = ?` → if row, return early; else `INSERT`. Under concurrent jobs with the same fingerprint, both workers read "no row" and both insert — violating uniqueness. (PITFALLS.md #3)
**How to avoid:** Never add a pre-check SELECT. Trust the atomic `ON CONFLICT DO NOTHING` to handle races. The worker has zero SELECT-before-INSERT logic.

### Pitfall 3: PrismaClient constructed per-job (not per-worker-process)

**What goes wrong:** `new PrismaClient()` inside the processor function creates a new connection pool per job — pool exhaustion in seconds under concurrency.
**How to avoid:** One PrismaClient per worker process, injected via `buildWorker(deps)`. The DI pattern (D-11) enforces this.

### Pitfall 4: Redis disconnects before worker.close() resolves

**What goes wrong:** Shutdown handler calls `redis.quit()` before `worker.close()` — worker tries to acknowledge completed jobs to Redis and fails.
**How to avoid:** Shutdown order is: `worker.close()` → `prisma.$disconnect()` → `redis.quit()`. This is fixed in the `shutdown()` pattern above.

### Pitfall 5: D-14 removal breaks API test coverage

**What goes wrong:** Removing `prisma` from `apps/api/src/index.ts` changes the module import graph. If any API test imports `index.ts` (not `app.ts`), the test may fail.
**How to avoid:** API tests should test via `buildApp(deps)` directly, not via `index.ts`. The existing test structure already does this — verify that no test file imports `apps/api/src/index.ts`.

### Pitfall 6: EventJobData schema drift between API enqueue and worker decode

**What goes wrong:** The API enqueues `{ source, payload: parsed.data, fingerprint }` (current shape from Phase 2). D-10 formalizes this as `EventJobData`. If the schema definition doesn't exactly match the wire shape, `safeParse` fails every job.
**How to avoid:** D-10 explicitly states "do not change the wire shape." The `EventJobData` schema codifies the existing enqueued shape. Verify by running the existing ingest tests after adding `EventJobData` to `@omnisync/types`.

### Pitfall 7: $executeRaw enum cast syntax

**What goes wrong:** PostgreSQL enum casts require `'VALUE'::"EnumType"` syntax. Prisma-generated enums in PostgreSQL are actual enum types. Using `'COMPLETED'` without the cast fails with `operator does not exist: text = "EventStatus"`.
**How to avoid:** Use `'COMPLETED'::"EventStatus"` in the raw SQL. If using `createMany` instead, Prisma handles the cast automatically.

---

## Code Examples

### EventJobData Zod Schema

```typescript
// packages/types/src/event.ts — final shape
import { z } from "zod/v4";

export const EventSource = z.enum(["SHOPEE", "TOKOPEDIA", "META_ADS", "CRM"]);
export type EventSource = z.infer<typeof EventSource>;

export const InboundEvent = z.object({
  source: EventSource,
  eventType: z.string().min(1),
  externalId: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
export type InboundEvent = z.infer<typeof InboundEvent>;

export const EventJobData = z.object({
  source: EventSource,
  payload: InboundEvent,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EventJobData = z.infer<typeof EventJobData>;
```

### Updated packages/queue/src/index.ts (D-07 refactor)

```typescript
// packages/queue/src/index.ts
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAME = "events";

export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createEventsQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
```

### Updated @omnisync/config env.ts (D-12)

```typescript
// packages/config/src/env.ts — add WORKER_CONCURRENCY
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  REDIS_URL: z.url(),
  WEBHOOK_SECRET_SHOPEE: z.string().min(1),
  WEBHOOK_SECRET_TOKOPEDIA: z.string().min(1),
  WEBHOOK_SECRET_META_ADS: z.string().min(1),
  WEBHOOK_SECRET_CRM: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
});
```

### Updated apps/api/src/index.ts (D-14 — remove prisma)

```typescript
// apps/api/src/index.ts — after D-14 (no @omnisync/db import)
import { env } from "@omnisync/config";
import { createRedisConnection, createEventsQueue } from "@omnisync/queue";
import { buildApp } from "./app.js";

const connection = createRedisConnection(env.REDIS_URL);
const queue = createEventsQueue(connection);

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({ queue, redis: connection });
await app.listen({ port, host });
app.log.info(`[api] listening on ${host}:${port} — NODE_ENV=${env.NODE_ENV}`);

async function shutdown(): Promise<void> {
  await app.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

**After D-14:** `apps/api/package.json` should remove `@omnisync/db` from `dependencies`.

---

## Prisma Schema Changes (Final)

### Updated schema.prisma (combined D-01 + D-06)

```prisma
// packages/db/prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum EventStatus {
  RECEIVED
  PROCESSING
  COMPLETED
  FAILED
  DLQ
}

model Event {
  id           String      @id @default(uuid())
  fingerprint  String
  source       String
  eventType    String
  externalId   String                    // D-01 new
  occurredAt   DateTime                  // D-01 new
  payload      Json
  status       EventStatus @default(RECEIVED)
  retryCount   Int         @default(0)
  errorMessage String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  // REMOVED: dlq DeadLetterEvent?      // D-06

  @@map("events")
  @@unique([fingerprint], map: "events_fingerprint_unique")
  @@index([status])
  @@index([source])
  @@index([createdAt])
}

model DeadLetterEvent {
  id            String   @id @default(uuid())
  fingerprint   String                          // D-06 indexed
  source        String                          // D-06 denormalized (no FK)
  eventType     String                          // D-06 denormalized
  payload       Json                            // D-06 full payload
  failureReason String                          // D-06
  errorStack    String?                         // D-06
  attempts      Int      @default(0)            // D-06
  resolved      Boolean  @default(false)        // D-06
  frozenAt      DateTime @default(now())        // D-06
  eventId       String?                         // D-06 nullable plain column, NO FK

  @@map("dlq_events")
  @@index([fingerprint])
  @@index([resolved])
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| QueueScheduler + guardInterval | Removed; Worker handles delayed/stalled internally | BullMQ v2 | Remove guardInterval from all code |
| `attempts: 0` (unlimited retries) | `attempts: 1` (default, no retry in Phase 3) | Phase 3 design decision | Jobs fail fast to failed set; Phase 4 adds retries |
| Module-level side effects in packages/queue | Factory functions (D-07) | Phase 3 | Testable, import-safe, no socket-on-import |
| Prisma v6 Rust engine | Prisma v7 Rust-free, ESM-native | Nov 2025 | Smaller Docker images, faster cold start |

---

## Environment Availability

Services required for integration tests — already available in docker-compose:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | IDM-02/03 integration tests | ✓ | 16 (docker-compose) | — |
| Redis | BullMQ worker tests | ✓ | 7 (docker-compose) | — |
| Docker | docker-compose | ✓ | Required (dev machine has it) | — |
| Node.js 22 | Worker runtime | ✓ | 22 LTS (in Dockerfile) | — |

**Note:** Integration tests run against docker-compose services (`localhost:5433` for Postgres, `localhost:6379` for Redis). CI GitHub Actions `services:` block provides the same. The `vitest.setup.ts` pattern (pre-populate env vars) from Phase 2 is mirrored in `apps/worker/vitest.setup.ts`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `apps/worker/vitest.config.ts` (Wave 0 gap — doesn't exist yet) |
| Quick run command | `pnpm --filter @omnisync/worker test` |
| Full suite command | `pnpm --filter @omnisync/worker test:coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUE-02 | Worker process consumes job and persists event row | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/worker.test.ts` | ❌ Wave 0 |
| QUE-03 | Configurable concurrency — N jobs processed in parallel | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/concurrency.test.ts` | ❌ Wave 0 |
| QUE-04 | Normalize produces canonical schema with externalId+occurredAt columns | Unit | `pnpm --filter @omnisync/worker test -- tests/unit/normalize.test.ts` | ❌ Wave 0 |
| IDM-02 | 50 identical jobs → exactly 1 events row (DB constraint absorbs duplicates) | Integration | `pnpm --filter @omnisync/worker test -- tests/integration/idempotency.test.ts` | ❌ Wave 0 |
| IDM-03 | Re-queuing an already-persisted event completes without duplicate | Integration | same integration file | ❌ Wave 0 |
| D-10 (poison guard) | Invalid job data fails immediately with structured error | Unit | `pnpm --filter @omnisync/worker test -- tests/unit/processor.test.ts` | ❌ Wave 0 |
| D-09 (no guardInterval) | packages/queue exports have no guardInterval key | Unit | `pnpm --filter @omnisync/queue test` | ❌ Wave 0 |

### Success Criteria Coverage

| SC | Criterion | Test | Type | Automated |
|----|-----------|------|------|-----------|
| SC-1 | Valid job enqueued → persisted in events table within seconds (separate Docker service) | Smoke — `docker-compose up worker` + POST /ingest + query DB | Manual demo + integration | Manual for Docker service aspect; integration for persistence |
| SC-2 | 50 identical webhooks → exactly 1 row | `tests/integration/idempotency.test.ts` — 50 concurrent `processEvent()` calls → `prisma.event.count()` === 1 | Integration | `pnpm --filter @omnisync/worker test` |
| SC-3 | Re-queue after persistence → job completes, no duplicate | Same integration file — processEvent twice with same fingerprint → count still 1 | Integration | `pnpm --filter @omnisync/worker test` |
| SC-4 | `WORKER_CONCURRENCY` configurable, no pool exhaustion | Integration with concurrency=10, assert no "Max clients" error | Integration | `pnpm --filter @omnisync/worker test` |

### Sampling Rate

- **Per task commit:** `pnpm --filter @omnisync/worker run typecheck` (fast; catches type drift)
- **Per wave merge:** `pnpm --filter @omnisync/worker test:coverage` (full suite + coverage)
- **Phase gate:** Full suite green + coverage ≥ 80% before `/gsd:verify-work`

### Wave 0 Gaps (must exist before any implementation)

- [ ] `apps/worker/vitest.config.ts` — mirrors `apps/api/vitest.config.ts`
- [ ] `apps/worker/vitest.setup.ts` — pre-populates env vars (add `WORKER_CONCURRENCY=5`)
- [ ] `apps/worker/tests/unit/normalize.test.ts` — normalize function unit tests
- [ ] `apps/worker/tests/unit/processor.test.ts` — processor with mocked prisma
- [ ] `apps/worker/tests/integration/idempotency.test.ts` — SC-2/SC-3 concurrent identical jobs
- [ ] `apps/worker/package.json` — add vitest, @vitest/coverage-v8, bullmq, ioredis, zod as deps
- [ ] `apps/worker/package.json` scripts: `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"`

---

## Open Questions

1. **Prisma `$executeRaw` enum cast syntax in Prisma 7**
   - What we know: `'COMPLETED'::"EventStatus"` is the standard PostgreSQL cast for Prisma-generated enums
   - What's unclear: Whether Prisma 7 with PrismaPg adapter changes the generated enum type name or adds a schema prefix
   - Recommendation: In Wave 0, write a simple integration test that executes the INSERT and verify it compiles and runs before building the full processor

2. **`@omnisync/db` pool configuration — singleton vs factory**
   - What we know: `packages/db/src/index.ts` creates a singleton `prisma` export; pool `max` is hardcoded to pg default (10)
   - What's unclear: If we add a `createPrismaClient(opts?)` factory, does the existing API code (which imports the singleton) still work without changes?
   - Recommendation: Expose BOTH the singleton (for API's `prisma.$disconnect()` in shutdown) AND a factory (for worker to configure pool size). The singleton retains `max: 10` which is fine for the API's uses.

3. **CI integration test database**
   - What we know: Existing CI uses no services block yet (only `pnpm test` which has `passWithNoTests: true`)
   - What's unclear: Whether the existing `.github/workflows/ci.yml` needs a `services:` block added for Phase 3 integration tests
   - Recommendation: Plan must include updating CI workflow to add `postgres:16` and `redis:7` service containers; environment variables must match `vitest.setup.ts` values.

---

## Sources

### Primary (HIGH confidence)

- [BullMQ v5.78.0 WorkerOptions API](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html) — confirmed stalledInterval/drainDelay are WorkerOptions; guardInterval absent
- [BullMQ v5.78.0 QueueOptions API](https://api.docs.bullmq.io/interfaces/v5.QueueOptions.html) — confirmed guardInterval absent from QueueOptions
- [BullMQ QueueScheduler deprecation docs](https://docs.bullmq.io/guide/queuescheduler) — "deprecated from BullMQ 2.0 and onwards"
- [BullMQ auto-removal docs](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs) — KeepJobs `{ age, count }` shape verified
- [BullMQ graceful shutdown docs](https://docs.bullmq.io/guide/workers/graceful-shutdown) — worker.close() behavior
- [BullMQ retrying failing jobs docs](https://docs.bullmq.io/guide/retrying-failing-jobs) — backoffStrategy returning -1 for permanent errors
- [node-postgres Pool API](https://node-postgres.com/apis/pool) — default max=10 confirmed
- [Prisma raw queries docs](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/raw-queries) — $executeRaw returns affected row count

### Secondary (MEDIUM confidence)

- [Prisma createMany reference](https://www.prisma.io/docs/orm/reference/prisma-client-reference#createmany) — skipDuplicates=true for PostgreSQL verified; returns { count } only
- [Prisma connection pool docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool) — PrismaPg default pool size 10; max option
- [Prisma customizing migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations) — --create-only flag for reviewing FK removal migrations

### Tertiary (LOW confidence — needs validation)

- Search results on Upstash command count math — consistent with project STACK.md research; verified calculation independently above

---

## Metadata

**Confidence breakdown:**
- BullMQ v5 API corrections: HIGH — verified directly against api.docs.bullmq.io v5.78.0 type definitions
- Prisma 7 idempotent write: HIGH — $executeRaw returning affected count is a documented behavior
- Schema migrations (D-01, D-06): HIGH — straightforward Prisma migrate dev with known patterns
- Concurrency formula: HIGH — node-postgres default max=10 verified; formula (concurrency+2) is conservative best practice
- Integration test harness: HIGH — docker-compose is simpler and more compatible than Testcontainers on Windows
- Graceful shutdown order: HIGH — BullMQ docs explicit that close() must resolve before redis cleanup

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (BullMQ releases weekly; core Worker API is stable)
