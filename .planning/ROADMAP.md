# Roadmap: OmniSync

## Overview

OmniSync is built in six phases that follow a strict dependency chain: shared infrastructure and schema first (the `UNIQUE(fingerprint)` constraint and ESM/Prisma 7 foundation must exist before any app code), then the ingestion API (events must enter the system before a worker can consume them), then the worker core (idempotent persistence before resilience layers are added on top), then resilience (retry → DLQ → circuit breaker, sequenced so DLQ exists before the breaker is testable), then the dashboard and observability layer (meaningful only once real events and failures flow through), and finally the testing, CI/CD, and deployment phase where the kill-Postgres integration test — the project's signature deliverable — is locked in and the always-on worker hosting is resolved for the live demo.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Local Infra** - Monorepo scaffold, shared Prisma schema (with `UNIQUE(fingerprint)`), Zod types, Docker Compose (Redis noeviction + Postgres), and CI skeleton (completed 2026-06-02)
- [x] **Phase 2: High-Speed Ingestion API** - Fastify ingestion endpoint with HMAC validation, Zod validation, SHA-256 fingerprint, Redis SET NX gate, BullMQ enqueue, and HTTP 202 fast-ACK (completed 2026-06-09)
- [x] **Phase 3: Worker Core & Idempotent Persistence** - Always-on BullMQ worker pool that normalizes events and persists them idempotently via `ON CONFLICT DO NOTHING`, completing the happy path end-to-end (completed 2026-06-10)
- [ ] **Phase 4: Resilience & Dynamic Routing** - Jittered exponential backoff, hand-built DLQ (BullMQ failed handler + Postgres mirror), mock CRM downstream, opossum circuit breaker, re-queue path, and runtime-reloadable routing rules
- [ ] **Phase 5: Dashboard & Observability** - Next.js dashboard with live queue metrics, DLQ list with one-click re-queue and load-test visualization, plus OpenTelemetry structured logs and metrics wired to real events
- [ ] **Phase 6: Testing, CI/CD & Deployment** - Kill-Postgres integration test, Playwright E2E, ≥80% coverage gate, GitHub Actions CI/CD, multi-stage Docker, resolved always-on worker hosting, and load-test demo script

## Phase Details

### Phase 1: Foundation & Local Infra
**Goal**: The shared substrate every other phase builds on exists and is correct — ESM-native monorepo, authoritative Prisma schema with `UNIQUE(fingerprint)` and `dlq_events` table, shared Zod types, and a reproducible local environment.
**Depends on**: Nothing (first phase)
**Requirements**: QUE-01, OPS-02
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts Postgres and Redis locally with Redis `maxmemory-policy noeviction` verified by a startup assertion
  2. `pnpm -r build` in the monorepo compiles all packages and apps without TypeScript errors
  3. `prisma migrate dev` applies the schema and `psql \d events` shows `CONSTRAINT events_fingerprint_unique UNIQUE (fingerprint)`
  4. Shared `@omnisync/db` and `@omnisync/types` packages are importable from `apps/api`, `apps/worker`, and `apps/dashboard` with no circular dependencies
  5. GitHub Actions CI skeleton runs type-check on every push and passes green
**Plans**: TBD

### Phase 2: High-Speed Ingestion API
**Goal**: Webhooks can enter OmniSync: a Fastify endpoint validates signatures, rejects malformed payloads, generates a deterministic fingerprint, gates duplicates via Redis SET NX, enqueues the job, and returns HTTP 202 before any DB write occurs.
**Depends on**: Phase 1
**Requirements**: ING-01, ING-02, ING-03, ING-04, ING-05, IDM-01
**Success Criteria** (what must be TRUE):
  1. `POST /ingest/:source` with a valid HMAC signature and well-formed payload returns HTTP 202 in low single-digit milliseconds (measured under local load)
  2. A request with a tampered or missing `X-Webhook-Signature` header returns HTTP 401 and no job is enqueued
  3. A request with a schema-invalid payload (missing required fields) returns HTTP 422 with a structured error body
  4. Sending the identical webhook twice concurrently results in exactly one job enqueued in BullMQ (the second call returns 202 with `status: "duplicate"`)
  5. The SHA-256 fingerprint of `source + event_type + external_id + occurred_at` is present on every enqueued job payload and is stable across identical re-deliveries
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Foundation: extend env schema with WEBHOOK_SECRET_*, install Fastify + Vitest deps, create test scaffold + rawBody type augmentation (Wave 0)
- [x] 02-02-PLAN.md — Pure functions (TDD): buildFingerprint (ING-04/SC-5) + verifySignature (ING-02/SC-2) with unit tests (Wave 1)
- [x] 02-03-PLAN.md — Fastify app factory, /healthz, POST /ingest/:source hot path, entrypoint wiring, and app.inject() route tests (Wave 2)

### Phase 3: Worker Core & Idempotent Persistence
**Goal**: Events queued by the ingestion API are consumed by a separate, always-on BullMQ worker process, normalized to a canonical schema, and persisted to PostgreSQL idempotently — duplicate events are silently absorbed, never double-stored.
**Depends on**: Phase 2
**Requirements**: QUE-02, QUE-03, QUE-04, IDM-02, IDM-03
**Success Criteria** (what must be TRUE):
  1. A valid job enqueued by the API is picked up by the worker, normalized, and appears as a row in the `events` table within a few seconds, with the worker process running as a separate Docker service
  2. Sending 50 identical webhooks simultaneously results in exactly one row in `events` (DB unique constraint absorbs all duplicates; no `INSERT` error surfaces to the caller)
  3. Re-queuing the same event after it has already been persisted marks the job complete without creating a duplicate row — idempotency holds across the re-queue path
  4. Worker concurrency is configurable via an environment variable and the worker processes multiple jobs in parallel without connection pool exhaustion on the local Postgres instance
**Plans**: 5 plans

Plans:
- [x] 03-01-PLAN.md — DB foundation: schema migrations (D-01 canonical columns + D-06 standalone DLQ), createPrismaClient pool factory, $executeRaw enum-cast smoke (Wave 0)
- [x] 03-02-PLAN.md — Shared packages: side-effect-free queue factories + remove guardInterval (D-07/08/09), EventJobData contract (D-10), WORKER_CONCURRENCY (D-12), API rewire + drop @omnisync/db (D-14) (Wave 0)
- [x] 03-03-PLAN.md — Worker test scaffold (vitest config/setup/deps) + CI postgres/redis services block (Wave 0)
- [x] 03-04-PLAN.md — Worker core: normalize seam + idempotent persist + poison guard + buildWorker + graceful shutdown with unit tests (Wave 1)
- [x] 03-05-PLAN.md — Integration proof vs real Postgres+Redis: SC-2 (50→1), SC-3 (re-queue absorbed), QUE-02 end-to-end, SC-4 concurrency; coverage gate + nyquist sign-off (Wave 2)

### Phase 4: Resilience & Dynamic Routing
**Goal**: The system survives failures gracefully: transient errors retry with jittered backoff, exhausted jobs land in a durable DLQ (Redis + Postgres mirror), a circuit breaker protects the mock CRM downstream, failed jobs can be re-queued idempotently, and routing/transformation rules can be updated in the DB and take effect in the running worker without a redeploy.
**Depends on**: Phase 3
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05, RES-06, RES-07, RTE-01, RTE-02
**Success Criteria** (what must be TRUE):
  1. Injecting a transient error into the worker causes automatic retry with jittered exponential backoff — retry timestamps in logs are spread across a window, not synchronized (no thundering herd)
  2. After exhausting all retry attempts, the job appears in the `dlq_events` Postgres table with the original payload, full error stack, attempt count, and source channel — the DLQ entry survives a Redis restart
  3. Configuring the mock CRM to return 5xx errors at a rate above the threshold causes the cockatiel circuit breaker to open (D-01 overrides the "opossum" naming); while open, affected events route to retry/DLQ without hammering the mock CRM; killing Postgres does NOT open the breaker
  4. Clicking "Re-queue" on a DLQ entry reprocesses the event through the normal worker pipeline and results in exactly one DB row — idempotency holds on re-queue
  5. Updating a routing rule in the `routing_rules` table (e.g., enabling E.164 phone normalization) takes effect in the running worker without restarting, and the next processed event reflects the updated rule
**Plans**: 6 plans

Plans:
- [x] 04-01-PLAN.md — Foundation: Phase 4 env vars, install cockatiel@4, RoutingRule model + migration, apps/mock-crm scaffold (Wave 0)
- [ ] 04-02-PLAN.md — Pure functions (TDD): full-jitter backoff (RES-01), CrmClient + cockatiel circuit breaker (RES-04/05), final-attempt-gated DLQ handler (RES-02/03) (Wave 0)
- [ ] 04-03-PLAN.md — Routing rules (TDD): RoutingRule Zod union, dispatch-table engine (RTE-01), lazy TTL cache (RTE-02) (Wave 0)
- [ ] 04-04-PLAN.md — Wire into worker: backoff on Worker, DLQ on failed handler, CRM breaker in processor (persist outside breaker → RES-07), rules at normalize() seam (Wave 1)
- [x] 04-05-PLAN.md — Re-queue service + POST /admin/dlq/:id/requeue (RES-06, fingerprint-as-jobId idempotency) + mock-crm docker-compose service (Wave 1)
- [ ] 04-06-PLAN.md — Integration proof: DLQ Postgres mirror (RES-03) + re-queue idempotency (RES-06); coverage gate + Nyquist sign-off (Wave 2)

### Phase 5: Dashboard & Observability
**Goal**: Operators can see the system's health in real time: a Next.js dashboard shows live queue throughput metrics, lists DLQ entries with full error detail and a one-click re-queue action, and visualizes a live load test — all backed by OpenTelemetry-instrumented structured logs and metrics covering every event lifecycle transition.
**Depends on**: Phase 4
**Requirements**: OBS-01, OBS-02, DSH-01, DSH-02, DSH-03, DSH-04
**Success Criteria** (what must be TRUE):
  1. The dashboard `/dashboard` page shows live queue depth and throughput metrics that update without a page reload as events flow through the system
  2. The dashboard `/dlq` page lists all DLQ entries with error detail (message, stack, attempt count, source channel) and a "Re-queue" button that triggers reprocessing
  3. The dashboard `/demo` page visualizes a running load test in real time — events processed vs. failed charted live as the test script fires synthetic events
  4. Structured logs are emitted for every event lifecycle transition (received, processing, completed, failed, DLQ) and are queryable/filterable in the local log output
  5. The OpenTelemetry metrics endpoint (or BullMQ job-state gauge) exposes throughput, queue latency, retry count, and error distribution as observable, numeric values
**Plans**: TBD
**UI hint**: yes

### Phase 6: Testing, CI/CD & Deployment
**Goal**: The project's quality bar is enforced and the system is demonstrable live: the kill-Postgres integration test proves queue durability under DB failure, Playwright E2E covers the DLQ re-queue flow, ≥80% line coverage is a CI gate, Docker images build cleanly, and the always-on worker is deployed to a free-tier host reachable for a live recruiter demo.
**Depends on**: Phase 5
**Requirements**: TST-01, TST-02, TST-03, TST-04, OPS-01, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):
  1. Killing Postgres mid-processing (via `docker pause` in a Testcontainers test) results in zero events dropped from the BullMQ queue — all in-flight events complete successfully once Postgres is restored
  2. Firing 50 concurrent identical webhooks in an integration test results in exactly one row in the `events` table (concurrent dedup test passes in CI)
  3. The Playwright E2E test navigates to the DLQ dashboard, clicks re-queue on a seeded failed job, and asserts the event appears in the `events` table exactly once — this test passes in CI headlessly
  4. `pnpm test` reports ≥80% line coverage and the GitHub Actions workflow blocks merges that fall below the threshold
  5. The always-on worker is reachable at a public URL (Render background worker, Fly.io, or equivalent) and the load-test script successfully blasts synthetic events through the full live pipeline
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Local Infra | 4/4 | Complete   | 2026-06-02 |
| 2. High-Speed Ingestion API | 3/3 | Complete | 2026-06-09 |
| 3. Worker Core & Idempotent Persistence | 5/5 | Complete   | 2026-06-10 |
| 4. Resilience & Dynamic Routing | 2/6 | In Progress|  |
| 5. Dashboard & Observability | 0/TBD | Not started | - |
| 6. Testing, CI/CD & Deployment | 0/TBD | Not started | - |
