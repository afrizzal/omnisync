# OmniSync

## What This Is

OmniSync is a **distributed, event-driven Customer Data Platform (CDP)** that ingests high-volume webhook events from multiple sales & marketing channels (e-commerce marketplaces, ad platforms, CRM) asynchronously, then normalizes, deduplicates, and routes them to a central store — with strong delivery guarantees even when downstream systems fail.

It is built as a **portfolio project** to prove production-grade distributed-systems engineering: decoupled ingestion, background worker queues, idempotency, automated resilience patterns (retry/backoff, circuit breaker, Dead-Letter Queue), observability, and a rigorous automated test suite. The target audience is technical recruiters and senior/lead engineers evaluating the author for **Senior Backend / Distributed Systems / Lead Full-Stack** roles.

## Core Value

**No accepted event is ever silently lost.** Once OmniSync acknowledges a webhook (HTTP 202), that event is durably queued and processed *at-least-once and idempotently* — surviving worker crashes, database outages, and flaky downstream APIs, with a Dead-Letter Queue as the final safety net and a one-click path back to reprocessing.

If everything else is stripped away, this guarantee — and the ability to *demonstrate* it live under simulated failure — is what must work.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

**Ingestion** — v1.0 (Phase 02)
- ✓ High-speed Fastify ingestion endpoint: HMAC signature validation, idempotency fingerprint, enqueue, HTTP 202 in low single-digit milliseconds — v1.0
- ✓ Schema validation (Zod) of inbound payloads with structured rejection of malformed events — v1.0

**Queue & Workers** — v1.0 (Phase 03)
- ✓ Asynchronous BullMQ queue backed by Redis decoupling ingestion from processing — v1.0
- ✓ Distributed worker pool that consumes events, normalizes them, and persists to PostgreSQL — v1.0
- ✓ Idempotent processing — duplicate events (same fingerprint) never double-stored (50-concurrent race proven) — v1.0

**Resilience** — v1.0 (Phase 04)
- ✓ Automatic retry with jittered exponential backoff on transient failures — v1.0
- ✓ Dead-Letter Queue with full error trace, mirrored to durable Postgres — v1.0
- ✓ Circuit breaker (cockatiel) guarding the mock-CRM downstream with half-open recovery — v1.0
- ✓ One-click (and programmatic) idempotent re-queue of DLQ items — v1.0

**Routing & Transformation** — v1.0 (Phase 04)
- ✓ DB-stored routing/transformation rules, hot-reloaded via lazy TTL cache (no redeploy) — v1.0

**Observability** — v1.0 (Phase 05, completed in v1.0 audit remediation)
- ✓ Structured logs for every lifecycle transition (received, processing, completed, failed/retry, DLQ) — v1.0
- ✓ /api/metrics: job-state gauge, throughput, queue latency, retry counts, error distribution — v1.0

**Dashboard (Next.js)** — v1.0 (Phase 05)
- ✓ Live queue & throughput metrics view (incl. latency + retries cards) — v1.0
- ✓ DLQ list with error detail (expandable stack trace) and one-click re-queue — v1.0
- ✓ Live load-test visualization (/demo Recharts waveform vs real ingest pipeline) — v1.0

**Engineering Standards** — v1.0 (Phase 06)
- ✓ Automated test suite (Vitest unit + integration, Playwright E2E) with ≥80% line coverage gate in CI — v1.0
- ✓ Testcontainers kill-Postgres integration test — zero events dropped mid-outage — v1.0
- ✓ GitHub Actions CI/CD: type-check, test+coverage, lint, Docker build (+GHCR push on master), compose-stack E2E — v1.0
- ✓ Multi-stage Docker images for api/worker/mock-crm/dashboard via docker-compose — v1.0
- ✓ Deployment story: published GHCR images + one-command `pnpm demo` + recorded walkthrough (documented substitution for live free-tier hosting; see v1.0 audit) — v1.0

### Active

<!-- Current scope (hypotheses until shipped). -->

(None — v1.0 shipped in full. Define v2 scope via `/gsd:new-milestone`; candidates: dashboard auth, real connectors, routing-rule admin UI, live hosting if a viable always-on free tier appears. See `.planning/research/brainstorming_omnisync_Jul26.md`.)

### Out of Scope

<!-- Explicit boundaries with reasoning to prevent re-adding. -->

- **Real production integrations** with live Shopee / Tokopedia / Meta Ads / Dynamics 365 — use *mock* webhook senders and a *mock* downstream. (No real credentials, near-zero cost, and the resilience story is fully demonstrable with mocks.)
- **Kafka / Redpanda / dedicated stream-processing engine** — Redis + BullMQ is sufficient to showcase distributed queueing at portfolio scale; Kafka adds cost and operational weight without changing the narrative.
- **Multi-tenancy, user accounts, billing** — not part of the infrastructure/resilience story this project exists to prove.
- **AI / ML anomaly detection** — deliberately excluded; AI capability is already proven by prior projects (Miracle Intelligence). This project is intentionally an *infrastructure* showcase, not another AI app.
- **Full auth/RBAC** beyond minimal dashboard protection — deferred; not the focus (candidate for v2).

## Context

- **Portfolio strategy:** OmniSync completes the author's "golden triangle" of competencies — *Data* (MarkovLens, predictive analytics) → *Application* (Miracle Intelligence, AI marketing automation) → *Infrastructure* (OmniSync, distributed/resilient backend). It directly attacks the biggest gap in the existing portfolio: high-throughput distributed systems, fault tolerance, and rigorous automated testing.
- **Real industry problem mirrored:** customer-data silos across ERP/CRM/web channels, data loss during third-party outages, and bottlenecks under webhook spikes (e.g. flash sales). The author's RevOps / Dynamics 365 background makes this domain authentic.
- **Shipped v1.0 state (2026-07-16):** ~5,000 LOC TypeScript across 4 apps (api, worker, dashboard, mock-crm) + 4 packages (types, config, db, queue); 25 test/spec files (42 API + 37 worker-unit + 5 queue tests locally, container-backed integration suites + Playwright E2E in CI); 6 phases, 28 plans, all 35 v1 requirements verified (see `.planning/v1.0-MILESTONE-AUDIT.md`).
- **Open tensions — all resolved in v1.0:**
  - Hosting: no $0 always-on background-worker tier exists (2026) → shipped GHCR images + one-command `pnpm demo` + recorded walkthrough instead of a live URL (documented substitution, accepted in audit).
  - Free-tier Redis quotas: BullMQ tuned (stalledInterval 5 min, drainDelay 30 s, no guardInterval) — moot for v1 since no hosted deploy; revisit only if v2 pursues live hosting.
  - Circuit breaker guards the mock-CRM downstream (not the project's own DB); persist happens outside the breaker so DB outages ride the retry path (RES-07 invariant).
- **Source:** distilled from a strategic brainstorm document (`hasil-brainstorm-gemini.md`) plus prior refinement sessions; v2 brainstorm at `.planning/research/brainstorming_omnisync_Jul26.md`.

## Constraints

- **Tech stack**: Node.js v20+ / TypeScript v5, Fastify (ingestion API), Redis v7 + BullMQ (queue), PostgreSQL v15+ + Prisma (store), Zod (validation), Vitest + Playwright (tests), Next.js (dashboard), Docker — chosen for a high-throughput, in-demand distributed-systems stack that maps to target roles.
- **Budget**: Near-zero / free-tier only during the job-hunt period — every infra choice must fit free tiers.
- **Quality bar**: ≥80% test coverage and green CI on every push — the testing rigor is itself a portfolio deliverable.
- **Purpose**: This is a *showcase* of resilience and distributed design; when tradeoffs arise, favor demonstrable reliability and a clean, explainable architecture over feature breadth.

## Key Decisions

<!-- Decisions that constrain future work. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build the **full spec** (MVP + advanced: circuit breaker, dynamic routing, observability) | Maximize portfolio depth for senior/distributed roles; breadth of resilience patterns is the selling point | ✓ Good — all 35 v1 requirements shipped and verified (v1.0 audit) |
| Include a real **Next.js DLQ dashboard** | Strong live-demo value and leverages the author's Next.js strength without diluting backend focus | ✓ Good — /dashboard, /dlq, /demo shipped; Playwright E2E covers operator re-queue path |
| Frame the guarantee as **at-least-once + idempotent (+ DLQ)**, not literal "0% data loss" | Honest and defensible under technical-interview scrutiny; "no silent loss" is provable, "0% loss" is not | ✓ Good — TST-02 (kill-Postgres, zero drops) + TST-03 (50-concurrent → 1 row) prove it mechanically |
| Use **Fastify** over Express for ingestion | Higher throughput / lower overhead; a deliberate, explainable choice interviewers probe for | ✓ Good — hot path returns 202 in single-digit ms with HMAC + Zod + SET NX + enqueue |
| Use **mock** channel senders and mock downstream (no real marketplace/CRM creds) | Near-zero cost; resilience is fully demonstrable with controllable mocks | ✓ Good — mock-crm fail mode drives deterministic DLQ/breaker demos and E2E seeding |
| **Hosting / worker model** deferred to research | Cloud Run scale-to-zero vs. always-on worker tension needs a free-tier comparison before committing | ✓ Resolved — no $0 always-on tier exists (2026); shipped GHCR images + `pnpm demo` + recorded walkthrough as documented substitution (v1.0 audit) |
| **External downstream sync (mock CRM)** inclusion deferred to planning | Decide during the resilience phase where the circuit breaker most convincingly applies | ✓ Good — cockatiel breaker wraps mock-CRM sync only; persist stays outside the breaker (RES-07 invariant) |
| **cockatiel** over opossum for the circuit breaker | TypeScript-first, composable policy API | ✓ Good — clean breaker + retry layering, singleton policy injected via WorkerDeps |
| Hand-built **DLQ with Postgres mirror** (BullMQ failed set + `dlq_events` table) | DLQ history must survive Redis loss; final-attempt gating avoids noise | ✓ Good — RES-03 proven by integration test; one-click re-queue idempotent by fingerprint-as-jobId |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-16 after v1.0 milestone*
