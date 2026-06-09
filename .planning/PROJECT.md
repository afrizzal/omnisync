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

**Ingestion** — Validated in Phase 02: High-Speed Ingestion API
- [x] High-speed Fastify ingestion endpoint that validates a webhook signature, generates an idempotency fingerprint, enqueues the raw payload, and returns HTTP 202 in low single-digit milliseconds
- [x] Schema validation (Zod) of inbound payloads with structured rejection of malformed events

### Active

<!-- Current scope (hypotheses until shipped). Full-spec MVP chosen. -->

**Ingestion**
- [x] High-speed Fastify ingestion endpoint that validates a webhook signature, generates an idempotency fingerprint, enqueues the raw payload, and returns HTTP 202 in low single-digit milliseconds *(Validated in Phase 02)*
- [x] Schema validation (Zod) of inbound payloads with structured rejection of malformed events *(Validated in Phase 02)*

**Queue & Workers**
- [ ] Asynchronous BullMQ queue backed by Redis decoupling ingestion from processing
- [ ] Distributed worker pool that consumes events, normalizes them, and persists to PostgreSQL
- [ ] Idempotent processing — duplicate events (same fingerprint) are detected and never double-stored

**Resilience**
- [ ] Automatic retry with jittered exponential backoff on transient failures
- [ ] Dead-Letter Queue capturing events that exhaust retries, with full error trace
- [ ] Circuit breaker that halts deliveries to a failing downstream dependency above a failure threshold and recovers automatically
- [ ] One-click (and programmatic) re-queue of DLQ items after a fault is resolved

**Routing & Transformation**
- [ ] Dynamic event-routing / transformation rules (e.g. normalize phone numbers to E.164) configurable without redeploying

**Observability**
- [ ] Structured logs + metrics for processing throughput, queue latency, retry counts, and error distribution

**Dashboard (Next.js)**
- [ ] Live queue & throughput metrics view
- [ ] Failed-job (DLQ) list with error detail and one-click re-queue
- [ ] Load-test / live-demo visualization (events processed vs. failed in real time)

**Engineering Standards**
- [ ] Automated test suite (Vitest unit + integration, Playwright E2E) with ≥80% line coverage
- [ ] Integration test proving state is preserved when PostgreSQL is killed mid-process (no data dropped from the queue)
- [ ] GitHub Actions CI/CD: type-check, test, build Docker image on every push
- [ ] Dockerized (multi-stage) for reproducible local dev and deployment

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
- **Free-tier candidates under consideration (to be validated in research):** Upstash (Redis), Supabase / Neon (PostgreSQL), Railway / Render / Fly.io / GCP Cloud Run (compute).
- **Known open tensions to resolve before/within relevant phases:**
  - GCP Cloud Run scales to zero, which conflicts with an always-on BullMQ worker → hosting model deferred to research.
  - Free-tier Redis command quotas vs. BullMQ's chatty polling → validate in research, may influence queue config or provider choice.
  - Circuit breaker is most convincing guarding a *real external* dependency (mock CRM sync) rather than the project's own DB → downstream-sync inclusion deferred to planning of the resilience phase.
- **Source:** distilled from a strategic brainstorm document (`hasil-brainstorm-gemini.md`) plus prior refinement sessions.

## Constraints

- **Tech stack**: Node.js v20+ / TypeScript v5, Fastify (ingestion API), Redis v7 + BullMQ (queue), PostgreSQL v15+ + Prisma (store), Zod (validation), Vitest + Playwright (tests), Next.js (dashboard), Docker — chosen for a high-throughput, in-demand distributed-systems stack that maps to target roles.
- **Budget**: Near-zero / free-tier only during the job-hunt period — every infra choice must fit free tiers.
- **Quality bar**: ≥80% test coverage and green CI on every push — the testing rigor is itself a portfolio deliverable.
- **Purpose**: This is a *showcase* of resilience and distributed design; when tradeoffs arise, favor demonstrable reliability and a clean, explainable architecture over feature breadth.

## Key Decisions

<!-- Decisions that constrain future work. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build the **full spec** (MVP + advanced: circuit breaker, dynamic routing UI, observability) | Maximize portfolio depth for senior/distributed roles; breadth of resilience patterns is the selling point | — Pending |
| Include a real **Next.js DLQ dashboard** | Strong live-demo value and leverages the author's Next.js strength without diluting backend focus | — Pending |
| Frame the guarantee as **at-least-once + idempotent (+ DLQ)**, not literal "0% data loss" | Honest and defensible under technical-interview scrutiny; "no silent loss" is provable, "0% loss" is not | — Pending |
| Use **Fastify** over Express for ingestion | Higher throughput / lower overhead; a deliberate, explainable choice interviewers probe for | — Pending |
| Use **mock** channel senders and mock downstream (no real marketplace/CRM creds) | Near-zero cost; resilience is fully demonstrable with controllable mocks | — Pending |
| **Hosting / worker model** deferred to research | Cloud Run scale-to-zero vs. always-on worker tension needs a free-tier comparison before committing | — Pending |
| **External downstream sync (mock CRM)** inclusion deferred to planning | Decide during the resilience phase where the circuit breaker most convincingly applies | — Pending |

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
*Last updated: 2026-06-09 — Phase 02 complete (ingestion API validated)*
