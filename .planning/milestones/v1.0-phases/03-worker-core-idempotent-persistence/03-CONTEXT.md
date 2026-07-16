# Phase 3: Worker Core & Idempotent Persistence - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning
**Decision authority:** User delegated ALL gray-area decisions to Claude with the mandate "optimize for what makes this portfolio convincing to recruiters / senior engineers." Decisions below are locked unless the user explicitly reopens them.

<domain>
## Phase Boundary

Events enqueued by the ingestion API are consumed by a **separate, always-on BullMQ worker process**, normalized to a canonical envelope, and persisted to PostgreSQL **idempotently** — duplicates are silently absorbed, never double-stored, and never surface an error. This completes the happy path end-to-end (webhook → 202 → queue → worker → `events` row).

This phase builds NO retry/backoff, NO DLQ logic, NO circuit breaker (Phase 4), NO dashboard (Phase 5). The bar is the four roadmap success criteria: row appears within seconds via a separate Docker service; 50 concurrent identical webhooks → exactly 1 row; re-queue after persistence completes without duplicating; concurrency configurable via env var without pool exhaustion.

Requirements covered: **QUE-02, QUE-03, QUE-04, IDM-02, IDM-03**

</domain>

<decisions>
## Implementation Decisions

### Normalization depth (QUE-04)
- **D-01:** Normalization in v1 = **canonical envelope extraction**, not semantic transformation. The worker extracts `source`, `eventType`, `externalId`, `occurredAt` into typed columns and stores the full validated inbound event in `payload` (Json). **Phase 3 adds a migration extending `events` with `externalId String` and `occurredAt DateTime` columns** (currently missing from the schema) — a CDP that can't query by business timestamp vs ingest timestamp is not credible. `occurredAt` is stored canonicalized (same `new Date(x).toISOString()` rule the fingerprint uses — commit eb6a4d9).
- **D-02:** Semantic/business transformation (E.164 phone normalization, field mapping) is **Phase 4 routing-rules territory**. Do not build transformation hooks here; the worker pipeline just needs a seam where Phase 4 can insert rule application later (a single `normalize(event)` function boundary is enough).

### Persistence & idempotency (IDM-02, IDM-03)
- **D-03:** **Single atomic write per event**: `INSERT … ON CONFLICT DO NOTHING` semantics with `status: COMPLETED` written in that one insert. NO multi-stage DB status transitions (RECEIVED→PROCESSING→COMPLETED) in Phase 3 — multi-write lifecycles triple write volume and reintroduce partial-state races for zero demo value. Exact Prisma mechanism (`createMany({ skipDuplicates: true })` vs `$executeRaw` ON CONFLICT) is a research/planner choice; the semantics are locked: atomic, conflict-silent, never check-then-act (PITFALLS #3).
- **D-04:** Lifecycle observability comes from **structured pino logs** (received / processing / completed / duplicate-absorbed / failed), NOT from DB status updates. OBS-01 (Phase 5) consumes logs; `EventStatus.FAILED`/`DLQ` transitions arrive with Phase 4 failure handling. The enum stays as-is.
- **D-05:** Duplicate/re-queue handling: a conflict (row already exists) is **success** — the job completes normally and logs `duplicate absorbed`. This is what makes re-queue (SC-3) and at-least-once redelivery safe by construction.

### DLQ schema pre-staging (audit finding, decided: fix NOW)
- **D-06:** Phase 3 ships a migration redesigning `dlq_events` to be **standalone** — the current `eventId` FK (required, cascade) is a design flaw: the headline DLQ scenario is "job exhausted retries because the DB was down," in which case the `events` row may never exist and the DLQ insert itself would violate the FK. New shape: `id`, `fingerprint String @index`, `source`, `eventType`, `payload Json`, `failureReason String`, `errorStack String?`, `attempts Int`, `resolved Boolean @default(false)`, `frozenAt DateTime @default(now())`, plus **nullable** `eventId String?` (plain column, NO FK constraint) for linking when the event row does exist. The `Event.dlq` relation is removed. Same day-one logic as `UNIQUE(fingerprint)`: schema must precede the logic that depends on it (Phase 4 builds DLQ logic on this shape).

### packages/queue hardening (audit findings, folded in)
- **D-07:** Refactor `packages/queue` to **side-effect-free factories**: `createRedisConnection(url)` and `createEventsQueue(connection)` replace the current top-level `new Redis(process.env.REDIS_URL!)` / `new Queue(...)` module side effects. App entrypoints (`apps/api/src/index.ts`, `apps/worker/src/index.ts`) construct instances using the validated `@omnisync/config` env — the package itself never reads `process.env`. Importing a constant must never open a socket.
- **D-08:** `createEventsQueue` sets **`defaultJobOptions`**: `removeOnComplete: { age: 3600, count: 1000 }` and `removeOnFail: { age: 7 * 24 * 3600 }`. Bounded Redis footprint is a free-tier requirement (Upstash 256 MB); failed jobs are retained long enough for Phase 4 DLQ wiring to consume them.
- **D-09:** The Phase 1 D-10 "locked" interval values (`guardInterval`, `stalledInterval`, `drainDelay`) **must be re-verified against BullMQ v5 current API during research**: `guardInterval` is suspected dead config (QueueScheduler was removed in BullMQ v2; v5 uses queue markers), and `stalledInterval`/`drainDelay` are WorkerOptions, not QueueOptions. Amendment mandate: **preserve the intent (Upstash free-tier command-quota viability), correct the mechanism** to whatever v5 actually supports, and record the amendment in the plan + STATE decisions log. This explicitly supersedes the "do NOT change values" comment if research confirms the keys are obsolete.
- **D-10:** Producer–consumer contract made explicit: new `EventJobData` Zod schema in `@omnisync/types` — `{ source: EventSource, payload: InboundEvent, fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }`. The API enqueues a type-checked `EventJobData`; the worker **runtime-validates** `job.data` with `safeParse` before processing. Invalid job data → fail the job with an explicit error message (poison-message guard; these land in the failed set until Phase 4 routes them to the DLQ).

### Worker app architecture (QUE-02, QUE-03)
- **D-11:** Mirror the Phase 2 pattern that worked: a **`buildWorker(deps)` factory** with injected dependencies (prisma client, redis connection) so unit tests run with mocks and no real infra; `apps/worker/src/index.ts` wires live instances and graceful shutdown (`worker.close()` then connection/prisma cleanup on SIGINT/SIGTERM — drain in-flight jobs before exit).
- **D-12:** `WORKER_CONCURRENCY` env var (default `5`), added to the `@omnisync/config` schema as optional-with-default. Planner must ensure the Prisma/pg pool size ≥ concurrency (SC-4: no pool exhaustion) — document the relationship in code.
- **D-13:** Tests: unit tests (normalization, EventJobData validation, idempotent-persist semantics with mocked prisma) PLUS **integration tests against real local Postgres + Redis** (docker-compose services; Testcontainers optional if research prefers it) proving SC-2 (50 concurrent identical events → exactly 1 row) and SC-3 (re-queue absorbed). Phase 3's success criteria are unverifiable with mocks alone — this is the first phase where integration tests are mandatory, and the CI coverage gate (80% lines, wired 2026-06-10) already applies.

### Cleanup fold-in
- **D-14:** Remove the `@omnisync/db` import and dependency from `apps/api` (currently imported in `index.ts` only for `$disconnect`). After this, the API process **structurally cannot touch the database** — ING-05 becomes an architectural property, not a convention. (Strong interview line; zero functional risk.)

### Claude's Discretion (delegated downstream)
- Exact file layout in `apps/worker/src/` (processor/normalizer/persistence module split).
- Prisma write mechanism (`createMany skipDuplicates` vs raw SQL) — pick during research/planning per Prisma 7 best practice.
- Integration-test harness choice (compose-services vs Testcontainers) and how CI runs it.
- Log field shapes and event names (keep consistent with existing pino usage).
- Whether `bull-board` is worth adding now for demo visibility (lean: defer unless trivially cheap).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prior locked decisions
- `.planning/phases/01-foundation-local-infra/01-CONTEXT.md` — monorepo/ESM/Prisma-7 foundation, D-10 interval lock (amended by D-09 above), noeviction mandate
- `.planning/phases/02-high-speed-ingestion-api/02-CONTEXT.md` — buildApp DI pattern, error envelope, fingerprint/jobId contract
- `.planning/phases/02-high-speed-ingestion-api/02-VERIFICATION.md` — verified ingestion behavior the worker consumes

### Research (project-level)
- `.planning/research/ARCHITECTURE.md` — two-layer idempotency, worker component design, fingerprint strategy
- `.planning/research/PITFALLS.md` — at-least-once ≠ exactly-once (#2), check-then-act race (#3), Redis eviction (#1)
- `.planning/research/STACK.md` — BullMQ 5.77 / ioredis 5.10 / Prisma 7 versions; Upstash quota math (re-verify per D-09)
- `.planning/research/SUMMARY.md` — Phase 3 research flag: measure Upstash command count under load

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — QUE-02/03/04, IDM-02/03
- `.planning/ROADMAP.md` — Phase 3 success criteria SC-1..SC-4

### Source files this phase touches (read before implementing)
- `packages/queue/src/index.ts` — current side-effectful module (refactor target, D-07/D-08)
- `packages/types/src/event.ts` — InboundEvent/EventSource (extend with EventJobData, D-10)
- `packages/db/prisma/schema.prisma` — Event + DeadLetterEvent models (migrations: D-01 columns, D-06 DLQ redesign)
- `packages/config/src/env.ts` — env schema (add WORKER_CONCURRENCY, D-12)
- `apps/api/src/routes/ingest.ts` — producer side of the job contract (gate-rollback pattern from commit 8da595f must keep working)
- `apps/api/src/index.ts` — remove prisma import (D-14); update to queue factories (D-07)
- `apps/worker/src/index.ts` — current keep-alive stub (replace)
- `apps/api/vitest.config.ts` + `apps/api/vitest.setup.ts` — test scaffold pattern to mirror in apps/worker
- `docker-compose.yml` — worker service exists; Redis has AOF + noeviction (commits 3a8cb7d)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`buildApp(deps)` DI pattern** (`apps/api/src/app.ts`) — proven testable-factory pattern; replicate as `buildWorker(deps)`.
- **Vitest scaffold** (`apps/api/vitest.config.ts`, `vitest.setup.ts` env stubs, coverage thresholds) — copy structure for `apps/worker`; coverage gate already enforced repo-wide in CI.
- **`@omnisync/db` prisma singleton** with PrismaPg adapter — the worker's persistence client (api drops it per D-14).
- **Fingerprint canonicalization** (`apps/api/src/lib/fingerprint.ts`) — worker does NOT recompute fingerprints; it trusts `job.data.fingerprint` (jobId dedup + DB unique constraint are the safety nets). The same `toISOString()` canonicalization rule applies to the `occurredAt` column value (D-01).

### Established Patterns
- ESM-native, `zod/v4` subpath imports, Biome formatting (`.turbo`/`coverage` excluded), fail-fast env via `@omnisync/config`, Conventional Commits `type(NN): summary`.
- Job payload currently enqueued as `{ source, payload: parsed.data, fingerprint }` with `jobId = fingerprint` — D-10 formalizes exactly this shape as `EventJobData`; do not change the wire shape (no migration of in-flight jobs needed).

### Integration Points
- `eventsQueue` ("events" queue) is the seam: API produces, worker consumes. Queue factory refactor (D-07) touches both entrypoints.
- `events` table unique constraint `events_fingerprint_unique` is the authoritative idempotency anchor (Phase 1 pre-staged it for exactly this phase).
- docker-compose `worker` service already builds/runs — Phase 3 makes it actually process jobs (SC-1's "separate Docker service" criterion).

</code_context>

<specifics>
## Specific Ideas

- **The recruiter narrative this phase must enable:** "watch 50 identical webhooks race through two processes and produce exactly one row — then re-queue one and watch it absorb." The integration test IS the demo script seed.
- **At-least-once is the design center:** every worker code path must be safe to run twice (BullMQ stalled-job redelivery). No code path may assume first-delivery.
- **Redis SET NX gate is advisory only** — it deduplicates the request path; the DB unique constraint is the truth. Never extend the Redis gate's responsibilities into the worker.
- **25 existing API tests + CI gate must stay green** throughout — queue factory refactor (D-07) changes `AppDeps` wiring in tests minimally or not at all (`Pick<Queue,"add">`/`Pick<Redis,"set"|"del">` interfaces are already injection-friendly).

</specifics>

<deferred>
## Deferred Ideas

- **Retry/backoff config (`attempts`, jittered backoff)** — Phase 4 (RES-01). Phase 3 jobs run with default attempts; failures sit in the failed set.
- **DLQ logic** (failed-handler → `dlq_events` mirror) — Phase 4 (RES-02/03). Phase 3 only ships the corrected schema (D-06).
- **Kill-Postgres durability test** — stays Phase 6 per roadmap (TST-02); Phase 3's integration tests reduce its risk but don't pull it forward.
- **Worker `/healthz` + keep-alive wiring** — Phase 6 (deployment).
- **Upstash command-count measurement** — flagged for this phase in research SUMMARY; treat as a research task informing D-09, not a UAT gate (local Redis is the Phase 3 runtime).
- **`bull-board` queue browser** — optional; only if trivially cheap (Claude's discretion).

</deferred>

---

*Phase: 03-worker-core-idempotent-persistence*
*Context gathered: 2026-06-10*
