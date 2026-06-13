# Phase 4: Resilience & Dynamic Routing - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the failure-handling layer on top of the happy path Phase 3 completed. This phase delivers:
- Jittered exponential backoff for transient worker failures (RES-01)
- Dead-Letter Queue: Redis failed set + Postgres `dlq_events` mirror (RES-02, RES-03)
- `apps/mock-crm` Fastify service with runtime failure-mode control (RES-04 prerequisite)
- cockatiel circuit breaker protecting the CRM downstream (RES-04, RES-05)
- Re-queue API: individual DLQ entry reprocessing, idempotent (RES-06)
- Kill-Postgres preserves in-flight queue events — behavior (RES-07); the integration test proving it is Phase 6 (TST-02)
- Runtime-reloadable routing rules: E.164 phone normalization via lazy TTL cache (RTE-01, RTE-02)

This phase does NOT build the dashboard (Phase 5), does NOT add Playwright E2E or ≥80% coverage gate enforcement (Phase 6).

Requirements: **RES-01, RES-02, RES-03, RES-04, RES-05, RES-06, RES-07, RTE-01, RTE-02**

</domain>

<decisions>
## Implementation Decisions

### Circuit Breaker (RES-04, RES-05)
- **D-01:** Use **cockatiel** (not opossum). ROADMAP.md/REQUIREMENTS.md name "opossum" — this decision overrides that naming. Rationale: TypeScript-first, composable policy API, explicitly recommended in CLAUDE.md stack doc as the ideal choice for the mock-CRM guard.
- **D-02:** Policy composition: **Retry policy wraps CircuitBreaker policy** — layered policies. Retry handles transient errors; when failure rate exceeds the threshold, the breaker opens and subsequent calls fail-fast without hammering the CRM. This demonstrates cockatiel composability — the key portfolio interview talking point.
- **D-03:** Breaker type: **`ConsecutiveBreaker(5)`** — opens after 5 consecutive failures. Chosen over `SamplingBreaker` (rate-based) because SamplingBreaker needs traffic volume to trigger; ConsecutiveBreaker is deterministic and visible in a live demo.
- **D-04:** `halfOpenAfter`: **10–15 seconds**, configurable via env var (e.g., `BREAKER_HALF_OPEN_MS=10000`). Short enough that the open → half-open → closed cycle is visible in a live demo without waiting.
- **D-05:** All breaker parameters go into `@omnisync/config` Zod env schema with the above defaults — consistent with the existing fail-fast env validation pattern.

### Mock CRM Downstream (RES-04 prerequisite)
- **D-06:** Implement as **`apps/mock-crm`** — a small standalone Fastify app running in docker-compose. Worker calls it over real HTTP. A real HTTP downstream is essential for the demo story: the circuit breaker opening because a real service is misbehaving is far more convincing than an in-process throw.
- **D-07:** Worker depends on a **`CrmClient` interface** (DI). The production implementation is an HTTP client to mock-crm. Unit tests inject a fake in-process `CrmClient`. This gives both the demo story (real HTTP) and testability (in-process fake) simultaneously.
- **D-08:** Failure mode is controlled at **runtime via an admin endpoint** on mock-crm: `POST /admin/failure-mode { mode: "fail" | "slow" | "ok", rate: number }`. Env-var-only control would require a restart and breaks the live demo flow. `slow` mode (delayed response) is required to demo the Timeout policy in addition to error rate.
- **D-09:** `apps/mock-crm` is docker-compose only — it is **not** deployed as a third Render service. This preserves free-tier budget.

### Retry Profile (RES-01)
- **D-10:** Retry configuration lives in **`packages/queue` `createEventsQueue()` `defaultJobOptions`**. Retry policy is a property of the pipeline, not of the caller. API route must not know about backoff values. Consistent with where `removeOnComplete`/`removeOnFail` already live.
- **D-11:** BullMQ has no built-in jitter. Use `backoff: { type: 'custom' }` in `defaultJobOptions`. The custom backoff strategy function is defined in `packages/queue` and imported by the worker's `Worker` constructor — single source of truth.
- **D-12:** Backoff formula: **full jitter exponential** — `delay = Math.random() * Math.min(cap, base * 2 ** attempt)`. This is the "Full Jitter" algorithm from the AWS Architecture Blog — defensible in interviews.
- **D-13:** Env-configurable defaults: `RETRY_ATTEMPTS=5`, `RETRY_BASE_DELAY_MS=1000`, `RETRY_CAP_MS=30000`. With `halfOpenAfter` at 10–15s, the final attempts land after the breaker has had a chance to half-open — clean demo cycle.

### DLQ (RES-02, RES-03)
- **D-14:** DLQ schema (`dlq_events`) was pre-staged in Phase 3 (D-06 of 03-CONTEXT.md): standalone, no FK to events, nullable `eventId?`. No migration needed for the table shape — Phase 4 only wires the BullMQ `failed` event handler that inserts into it.
- **D-15:** DLQ handler writes to `dlq_events` on job exhaustion (all attempts consumed). Captures: `fingerprint`, `source`, `eventType`, `payload`, `failureReason` (error message), `errorStack`, `attempts` count, nullable `eventId` (set if the events row exists). This satisfies RES-03: Postgres mirror survives Redis restart.

### Re-queue API (RES-06)
- **D-16:** The re-queue logic lives in Phase 4 as a service-layer function + API endpoint on `apps/api` (or a dedicated admin router). Phase 5 (dashboard) calls this endpoint — it does not own the business logic. Re-queue is idempotent: the fingerprint + DB unique constraint absorb any duplicate on reprocessing (IDM-02/IDM-03 already guarantee this).

### Routing Rules (RTE-01, RTE-02)
- **D-17:** **E.164 phone normalization only** for v1. One concrete, demonstrable rule type. The senior-reviewer signal is the extensibility of the infrastructure, not the count of rule types.
- **D-18:** Rule schema uses a **Zod discriminated union with a `type` field** (e.g., `{ type: "phone_normalize_e164", field: string }`). v1 has one variant. Adding a rule type later = one new Zod variant + one handler + one test. No refactoring needed.
- **D-19:** Rule execution via **dispatch table** (`Record<RuleType, RuleHandler>`) — not if/else. Extensibility is structural, not just claimed. A comment/README note explicitly names field rename/drop as the obvious extension point.
- **D-20:** Rules are applied at the **`normalize()` seam** in `apps/worker/src/normalizer/normalize.ts`. Phase 3 left a comment there ("Phase 4 inserts rule application HERE") — honor it.
- **D-21:** Rules stored in a **`routing_rules` Postgres table**, Prisma model in `packages/db/prisma/schema.prisma`. Phase 4 ships the migration.
- **D-22:** Reload mechanism: **lazy TTL cache** (not background `setInterval`). Cache holds rules + loaded timestamp. When a job is about to be processed, if `now - loadedAt > TTL`, reload from DB synchronously before applying rules. No background timer — DB is only hit when there's actual work. TTL configurable via env (default ~30s).

### Claude's Discretion
- Exact `routing_rules` schema columns (enabled flag, source filter, priority ordering)
- `CrmClient` interface method names and HTTP request shape to mock-crm `/crm/sync`
- Whether re-queue goes on a `/admin` router or `/api` router on apps/api
- Test infrastructure for cockatiel policy behavior (mock timers vs real wait)
- `bull-board` — defer unless trivially cheap (confirmed deferred from Phase 3)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 requirements
- `.planning/REQUIREMENTS.md` — RES-01..RES-07, RTE-01, RTE-02 definitions
- `.planning/ROADMAP.md` — Phase 4 success criteria SC-1..SC-5

### Prior phase foundations
- `.planning/phases/03-worker-core-idempotent-persistence/03-CONTEXT.md` — buildWorker DI pattern, normalize() seam (D-02), dlq_events schema (D-06), queue factory patterns (D-07/D-08), at-least-once design center
- `.planning/phases/03-worker-core-idempotent-persistence/03-VERIFICATION.md` — verified Phase 3 behavior that Phase 4 extends
- `.planning/phases/02-high-speed-ingestion-api/02-CONTEXT.md` — buildApp DI pattern, queue.add() call site (Phase 4 adds retry defaultJobOptions here)

### Project-level research
- `.planning/research/PITFALLS.md` — at-least-once ≠ exactly-once (#2), check-then-act race (#3), Redis eviction (#1)
- `.planning/research/STACK.md` — BullMQ 5.77 / ioredis 5.10 / Prisma 7 versions; Upstash quota (relevant to retry polling)

### Source files this phase extends (read before implementing)
- `apps/worker/src/normalizer/normalize.ts` — routing rule application seam (Phase 4 inserts rule logic here)
- `apps/worker/src/worker.ts` — add failed-event handler (DLQ wiring) and CrmClient injection
- `apps/worker/src/processor/event.processor.ts` — add CRM sync call + cockatiel policy wrap
- `packages/queue/src/index.ts` — add retry defaultJobOptions (D-10/D-11/D-12), custom backoff strategy
- `packages/db/prisma/schema.prisma` — add RoutingRule model; dlq_events already exists
- `packages/config/src/env.ts` — add BREAKER_HALF_OPEN_MS, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_CAP_MS, RULE_CACHE_TTL_MS
- `docker-compose.yml` — add mock-crm service

### External library docs (researcher must fetch)
- cockatiel npm/docs — ConsecutiveBreaker, CircuitBreaker policy, Retry policy composition, Timeout policy API
- BullMQ custom backoff strategy docs — `backoff: { type: 'custom' }` + Worker `settings.backoffStrategy`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`buildWorker(deps: WorkerDeps)`** (`apps/worker/src/worker.ts`) — DI factory ready for `crmClient` injection
- **`buildProcessor(prisma, logger)`** (`apps/worker/src/processor/event.processor.ts`) — Phase 4 adds CRM sync call + cockatiel wrap here
- **`normalize(job)`** (`apps/worker/src/normalizer/normalize.ts`) — Phase 4 inserts routing-rule application here; seam comment already in code
- **`createEventsQueue(connection)`** (`packages/queue/src/index.ts`) — `defaultJobOptions` already has `removeOnComplete`/`removeOnFail`; Phase 4 adds `attempts` + `backoff`
- **`dlq_events` Prisma model** (`packages/db/prisma/schema.prisma`) — standalone, no FK, ready to receive DLQ entries
- **`@omnisync/config` env schema** — Zod-validated, fail-fast; add new env vars here

### Established Patterns
- DI factory pattern (`buildApp`, `buildWorker`) — inject `CrmClient` the same way
- Zod discriminated union already used in `EventJobData` — apply same pattern to `RoutingRule`
- `ProcessorLogger` structural interface — cockatiel errors surface through the same logger
- Conventional Commits `type(NN): summary` — Phase 4 scope is `(04)`
- ESM-native, `zod/v4` subpath imports, Biome formatting

### Integration Points
- BullMQ `Worker` `failed` event → DLQ handler (insert to `dlq_events`)
- `normalize()` function → routing rule application before `persistEvent()`
- `processor()` → CRM sync call after `persistEvent()` succeeds → wrapped in cockatiel policies
- `packages/queue` → custom backoff strategy exported, imported by `buildWorker`
- `docker-compose.yml` → add `mock-crm` service alongside `api`, `worker`, `postgres`, `redis`

</code_context>

<specifics>
## Specific Ideas

- **"Retry policy is a property of the pipeline, not the caller"** — the architectural principle behind D-10. API route stays unaware of retry config.
- **ConsecutiveBreaker(5) not SamplingBreaker** — determinism for demo > theoretical correctness. Rate-based breakers need traffic volume to trigger; consecutive is visible immediately.
- **Lazy TTL cache for rules** — "not a background setInterval" is the specific design call. Reload only when work is happening.
- **Full jitter formula** (`random(0, min(cap, base * 2^attempt))`) is explicitly from the AWS Architecture Blog — cite this in a code comment for interview credibility.
- **`POST /admin/failure-mode`** on mock-crm — runtime toggle without restart. `slow` mode for Timeout policy demo, not just error rate.

</specifics>

<deferred>
## Deferred Ideas

- **Bulk re-queue** (re-queue multiple DLQ entries at once) — mentioned in RES-06. Service layer will support it, but the bulk trigger point is the dashboard button (Phase 5). Phase 4 only builds single-entry re-queue.
- **Kill-Postgres integration test** (TST-02) — the behavior (RES-07, events survive DB outage in queue) is delivered here; the test proving it formally is Phase 6 per roadmap.
- **Playwright E2E for DLQ re-queue flow** (TST-04) — Phase 6.
- **Upstash command count measurement** — flagged in Phase 3 research; retry polling with 5 attempts adds ~5 Redis ops per failed job — still within free-tier budget but researcher should reconfirm.
- **`bull-board` queue browser** — deferred again; only if trivially cheap.
- **Real CRM connector** (CONN-01) — v2, out of scope.

</deferred>

---

*Phase: 04-resilience-dynamic-routing*
*Context gathered: 2026-06-13*
