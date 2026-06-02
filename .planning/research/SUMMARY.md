# Project Research Summary

**Project:** OmniSync — Distributed Event-Driven Customer Data Platform (CDP)
**Domain:** High-throughput webhook ingestion + asynchronous queue/worker processing with resilience patterns (Node.js/TypeScript)
**Researched:** 2026-06-02
**Confidence:** HIGH (core mechanics & stack), MEDIUM (free-tier hosting viability, load behavior)

## Executive Summary

OmniSync is an infrastructure-layer portfolio project: a decoupled pipeline where a fast Fastify ingestion API accepts webhooks, acknowledges in milliseconds (HTTP 202), and hands work to a separate, always-on BullMQ worker pool over Redis, which normalizes and durably persists events to PostgreSQL — surviving worker crashes, DB outages, and flaky downstream APIs. Research strongly confirms the tentative stack and the build approach; the project's credibility as a *senior / distributed-systems* showcase rests not on feature breadth but on resilience patterns that actually work under *demonstrated* failure.

The recommended approach is a monorepo (pnpm workspaces + Turborepo) with shared `packages/db` (Prisma) and `packages/types` (Zod), and **physically separate** `apps/api` and `apps/worker` processes — this process separation is the heart of the architecture and the resolution to the "Cloud Run scale-to-zero vs. always-on worker" tension. Idempotency must be enforced in two layers (a fast Redis `SET NX` in-flight gate plus an authoritative PostgreSQL `UNIQUE(fingerprint)` constraint with `INSERT … ON CONFLICT DO NOTHING`). BullMQ has **no built-in DLQ** and provides **at-least-once, not exactly-once** delivery — both facts drive design.

The two main risks are operational, not architectural: (1) free-tier hosting genuinely conflicts with an always-on worker (Cloud Run scales to zero, Render free sleeps after 15 min, Railway free is a one-time credit) — the final hosting choice must be resolved in a dedicated infrastructure/deployment phase; and (2) BullMQ's polling can exhaust Upstash's free Redis command quota in days — viable only with tuned intervals, validated by a real command-count measurement early in the worker phase. The honest delivery-guarantee framing ("at-least-once + idempotent + DLQ", **not** "0% data loss") is technically defensible and interview-proof.

## Key Findings

### Recommended Stack

The tentative stack is the correct 2025/2026 standard — but several versions have moved and carry migration implications. Full detail in `STACK.md`.

**Core technologies:**
- **Node.js 22 LTS + TypeScript 5** — Fastify 5 requires Node 20+; 22 LTS gives longer runway.
- **Fastify 5.8.x** — ingestion API; high-throughput, low-overhead HTTP (deliberate choice over Express).
- **BullMQ 5.77.x + Redis 7 (`noeviction`)** — distributed queue; reduced Redis command overhead vs v4.
- **PostgreSQL 15+ + Prisma 7** — Prisma 7 is ESM-native and Rust-free → requires `"type": "module"` from day one. Authoritative store + idempotency anchor.
- **Zod 4** — schema validation (`zod/v4` subpath; ~14× faster than v3).
- **opossum v9** — circuit breaker (Node 20+, de-facto Node standard). *cockatiel* is a TypeScript-native alternative, but opossum wins (3-of-4 researchers + ecosystem default).
- **Vitest 4 + Playwright + Testcontainers** — unit/integration + E2E + failure-injection tests.
- **Next.js (App Router)** — DLQ dashboard. **OpenTelemetry** — observability (BullMQ ≥5.71 ships a native OTel adapter; `bullmq.queue.jobs.state` gauge).
- **Docker (multi-stage) + pnpm workspaces + Turborepo** — reproducible builds; shared code across api/worker/dashboard.

**Free-tier providers (validate in infra phase):** Neon (Postgres — beats Supabase: ~10k pooled connections vs 200, 5-min suspend vs 1-week pause, CI branching; needs pooler URL + `directUrl` for migrations). Upstash (Redis — free 500k commands/mo, 256 MB; viable only with tuned BullMQ intervals). Compute: Render Web Service + UptimeRobot keep-alive, Fly.io always-on VM, or a small paid tier — **decision deferred**.

### Expected Features

From `FEATURES.md`. For a senior showcase, "table stakes" = what a technical interviewer probes for.

**Must have (table stakes):**
- High-speed ingestion endpoint: signature validation → idempotency fingerprint → enqueue → HTTP 202.
- Async BullMQ queue + distributed worker pool; idempotent processing (two-layer dedup).
- Retry with **jittered** exponential backoff (full-jitter; jitter is not optional).
- Dead-Letter Queue (hand-built via `worker.on('failed')` + separate queue mirrored to a Postgres `dlq_events` table) + re-queue path.
- ≥80% coverage; the **kill-Postgres-mid-process integration test** (the signature deliverable); CI/CD; Docker.

**Should have (differentiators):**
- Circuit breaker (opossum) guarding a **mock external CRM** downstream — *not* the DB.
- Dynamic event-routing / transformation rules stored in Postgres, loaded without redeploy (Hookdeck/Segment-style).
- OpenTelemetry observability (throughput, queue latency, retry counts, error distribution).
- Next.js dashboard: live metrics, failed-job list, one-click re-queue, live load-test visualization.

**Anti-features (deliberately NOT built):** real marketplace/CRM integrations (use mocks), Kafka/Redpanda, multi-tenancy/billing, AI/ML anomaly detection. (Matches PROJECT.md Out of Scope.)

### Architecture Approach

From `ARCHITECTURE.md`. Monorepo with strict process separation; shared schema/types eliminate drift.

**Major components:**
1. **`apps/api` (Fastify)** — webhook intake, signature check, fingerprint, Redis `SET NX` in-flight gate, enqueue, ACK 202. Can scale to zero.
2. **`packages/db` + `packages/types`** — Prisma schema (`EventIngestion` with `UNIQUE(fingerprint)`, `DeadLetterQueue`) + Zod schemas, shared by all apps.
3. **Redis + BullMQ** — durable queue between API and worker.
4. **`apps/worker` (BullMQ)** — consumes, normalizes, idempotent upsert (`ON CONFLICT DO NOTHING`), optional downstream sync. **Always-on** (cannot scale to zero).
5. **`apps/mock-crm`** — toggleable-failure external endpoint so circuit breaker + DLQ have a real dependency to guard.
6. **`apps/dashboard` (Next.js)** — metrics, DLQ list, re-queue, load-test viz.

**Fingerprint:** SHA-256 of `source + event_type + external_id + occurred_at` (stable across retries; not raw-payload hash, not receipt timestamp, not sender-controlled key alone).

### Critical Pitfalls

Top items from `PITFALLS.md`:

1. **Redis eviction = silent queue corruption** — BullMQ requires `noeviction`; never rely on Redis alone for dedup (keys can be evicted). → Postgres unique constraint is the authoritative anchor.
2. **At-least-once ≠ exactly-once** — stalled jobs (event-loop blocking) cause double processing. → idempotent `INSERT … ON CONFLICT` designed into the schema *before* worker code.
3. **Check-then-act race** — two workers both pass a `SELECT` check before inserting. → atomic upsert, not read-then-write.
4. **Circuit breaker on the wrong dependency** — wrapping the Postgres write stalls everything and loses data. → breaker only around the mock CRM hop.
5. **Free-tier worker hosting** — scale-to-zero / sleep kills the worker; Upstash quota exhaustion. → resolve hosting in a dedicated phase; tune BullMQ intervals; measure command count early.
6. **"0% data loss" overclaim** — not defensible. → frame as at-least-once + idempotent + DLQ; rehearse the precise residual failure modes.

## Implications for Roadmap

Research converges on a **strict early build order** (idempotency anchor → ingestion → worker → resilience → dashboard → testing/demo). Suggested phase structure (standard granularity):

### Phase 1: Foundation & Local Infra
**Rationale:** Everything depends on shared schema/types and a stable local environment; the `UNIQUE(fingerprint)` constraint and `"type":"module"` (Prisma 7 ESM) must exist from day one.
**Delivers:** Monorepo (pnpm + Turborepo), `packages/db` (Prisma schema: `EventIngestion`, `DeadLetterQueue`), `packages/types` (Zod), `docker-compose` (Redis `noeviction` + Postgres), locked BullMQ interval config, CI skeleton.
**Avoids:** retrofitting the unique constraint / ESM later (PITFALLS #2, stack ESM trap).

### Phase 2: High-Speed Ingestion API
**Rationale:** The worker needs real jobs to consume; ingestion comes first.
**Delivers:** Fastify endpoint, signature validation, SHA-256 fingerprint, Zod validation, Redis `SET NX` in-flight gate, enqueue, HTTP 202 fast-ACK.
**Implements:** component 1; **Avoids** weak-fingerprint idempotency mistakes.

### Phase 3: Worker Core & Persistence
**Rationale:** Establish durable, idempotent processing before layering resilience on top.
**Delivers:** BullMQ worker, normalization, idempotent upsert (`ON CONFLICT DO NOTHING`), Postgres persistence.
**Avoids:** at-least-once double-processing (PITFALLS #2/#3).
**Research flag:** measure Upstash command count here (validate free-tier viability).

### Phase 4: Resilience (Retry → DLQ → Circuit Breaker)
**Rationale:** Sequenced — DLQ must exist before the circuit breaker is tested (open-circuit jobs need somewhere to land).
**Delivers:** jittered exponential backoff, hand-built DLQ (failed handler + Postgres mirror), mock CRM downstream, opossum circuit breaker, re-queue path. (Dynamic routing rules can attach here or in Phase 5.)
**Research flag:** mock CRM idempotency + DLQ-archival design are planning-time decisions.

### Phase 5: Dashboard & Observability
**Rationale:** Needs real events + failures flowing through to be meaningful.
**Delivers:** Next.js DLQ dashboard (live metrics, failed-job list, one-click re-queue, load-test viz), OpenTelemetry wiring.

### Phase 6: Testing, CI/CD & Deployment/Demo
**Rationale:** The testing rigor *is* a deliverable; hosting must be resolved with real infra; the demo must be rehearsed.
**Delivers:** kill-Postgres integration test (Testcontainers `docker pause`), Playwright E2E, ≥80% coverage gate, GitHub Actions, multi-stage Docker, **resolved hosting** (Render/Fly + Upstash + Neon wiring, keep-alive, secrets), load-test script ("blast 5000 events + kill DB + re-queue"), README with honest delivery-guarantee framing.

### Phase Ordering Rationale
- Idempotent worker processing must exist **before** DLQ re-queue is safe; DLQ must exist **before** the dashboard's re-queue button and **before** the circuit breaker is testable. This chain cannot be parallelized in early phases.
- Ingestion before worker; shared packages before any app.
- Hosting decision intentionally late (Phase 6) but informed by STACK.md so it isn't a surprise.

### Research Flags
Phases likely needing deeper planning-time research:
- **Phase 4 (Resilience):** mock CRM design, DLQ archival to Postgres, exact opossum API shape (`Policy`/`circuitBreaker`) — verify against current docs.
- **Phase 6 (Deployment):** final free-tier hosting choice for the always-on worker; Render/Fly reliability for live recruiter demos.
- **Phase 3 (Worker):** Upstash command-count measurement under load.

Phases with standard, well-documented patterns (lighter research):
- **Phase 1–2:** monorepo, Fastify, Prisma, Zod — established patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm/official release pages (Fastify 5.8.x, BullMQ 5.77.x, Prisma 7, Zod 4, Vitest 4). |
| Features | HIGH | Resilience/BullMQ/OTel patterns confirmed by 2026 official docs; dynamic-routing impl is MEDIUM (pattern-inferred). |
| Architecture | HIGH | Two-layer idempotency, process separation, DLQ pattern corroborated by multiple authoritative sources. |
| Pitfalls | HIGH | Redis/BullMQ mechanics and free-tier limits verified directly against provider + library docs. |

**Overall confidence:** HIGH for what to build and how; MEDIUM for free-tier operational viability (needs live validation).

### Gaps to Address
- **Worker hosting (free-tier, always-on):** resolve in Phase 6; candidates known, final pick pending real testing.
- **Upstash command quota under load:** measure in Phase 3; fallback = self-hosted Redis beside the worker or paid tier.
- **opossum current API shape:** confirm before implementing the circuit breaker (Phase 4).
- **DLQ re-queue vs. fingerprint TTL:** rely on Postgres `ON CONFLICT` as durable dedup rather than Redis TTL.

## Sources

### Primary (HIGH confidence)
- BullMQ official docs + release notes (retry/backoff, DLQ pattern, OTel adapter ≥5.71, at-least-once clarification).
- Redis official docs (`noeviction` requirement, `SET NX`).
- Fastify, Prisma 7, Zod 4, Vitest 4 official release pages (versions).
- Provider pricing/docs: Upstash (500k cmd/mo, 256 MB), Neon (connections, suspend, branching, `directUrl`), Render/Railway/Fly/GCP Cloud Run (free-tier behavior).
- opossum GitHub (v9, June 2025, Node 20+).

### Secondary (MEDIUM confidence)
- Hookdeck / Svix / Segment patterns (idempotency, no-redeploy dynamic routing).
- Turborepo + pnpm workspaces topology guides (constituent patterns; no single combined Fastify+BullMQ+Next.js example).
- Testcontainers failure-injection patterns.

### Tertiary (LOW confidence)
- Community estimates of BullMQ command counts under load (calculated, not benchmarked — validate in Phase 3).

---
*Research completed: 2026-06-02*
*Ready for roadmap: yes*
