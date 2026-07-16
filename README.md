<div align="center">

# OmniSync

### *No accepted event is ever silently lost.*

[![CI](https://github.com/afrizzal/omnisync/actions/workflows/ci.yml/badge.svg)](https://github.com/afrizzal/omnisync/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-%E2%89%A580%25-brightgreen)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6B6B)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)

A **distributed, event-driven Customer Data Platform (CDP)** — ingests high-volume webhooks from multiple channels, normalizes and deduplicates them, and routes to a central store with ironclad delivery guarantees even when the database goes down, the worker crashes, or the downstream API flakes.

**Built as a senior engineering portfolio:** decoupled ingestion · idempotent persistence · circuit breaker · DLQ · live observability dashboard · ≥ 80% CI-gated test coverage.

[Quick Start](#-quick-start) · [Demo Video](#-demo) · [Architecture](#-architecture) · [Testing Story](#-testing) · [Design Decisions](#-deployment-decision)

</div>

---

## Demo

<video src="docs/demo-omnisync.mp4" controls width="100%"></video>

> Four scenes in order: **(1)** autocannon load test driving the live /demo chart — **(2)** 50 concurrent identical webhooks → exactly 1 stored row (TST-03 idempotency proof) — **(3)** circuit breaker opening and auto-recovering under mock-CRM failure — **(4)** `docker pause postgres` mid-load → zero events dropped → unpause → full drain.

---

## The Core Guarantee

Once OmniSync acknowledges a webhook with **HTTP 202**, that event is durably queued and processed *at-least-once and idempotently* — no matter what breaks:

| Failure Scenario | What OmniSync Does |
|---|---|
| Worker process crashes mid-job | BullMQ re-locks the job and retries on restart |
| Postgres goes down during processing | Events stay durably in Redis; drain completely on recovery |
| Downstream CRM flaking or slow | Circuit breaker opens; events accumulate in DLQ, not silently dropped |
| 50 identical webhooks arrive simultaneously | Exactly 1 row stored — SHA-256 fingerprint + BullMQ `jobId` dedup under real race conditions |
| Event fails after exhausted retries | Moves to Dead-Letter Queue; one-click re-queue from the dashboard |

---

## Highlights

- **< 5 ms acknowledgment** — Fastify returns HTTP 202 before any downstream work begins; ingestion never blocks on processing
- **HMAC-SHA256 signature validation** on every incoming webhook before any work is done
- **Idempotent by design** — `SHA-256(channel + payload)` fingerprint becomes the BullMQ `jobId`; the database enforces `UNIQUE(fingerprint)` as the final backstop
- **Retry + exponential backoff** — configurable per-queue; exhausted retries move jobs to the BullMQ failed set (the DLQ)
- **Circuit breaker (cockatiel)** — wraps every downstream CRM call; opens automatically under sustained failure, half-opens for recovery probing
- **Dead-Letter Queue with one-click re-queue** — dashboard `/dlq` page lists all failed events with re-queue button; re-queued events flow through the full pipeline idempotently
- **Live observability dashboard** — real-time throughput waveform, queue depth + latency stat cards, error rate, DLQ list with auto-poll, Bull-Board job browser
- **≥ 80% line coverage enforced in CI** — coverage gate fails the build; Testcontainers kill-Postgres integration test + Playwright E2E on every push

---

## Quick Start

> **Requires:** Docker Desktop · Node.js 22 · pnpm

```bash
cp .env.example .env
pnpm install
pnpm demo
```

This single command brings up the full stack, waits for health checks, and fires a multi-channel load test automatically:

1. `docker compose up` — api · worker · postgres · redis · mock-crm · dashboard
2. Health check polling on `:3001` (API) and `:3000` (dashboard)
3. Autocannon load test — Shopee / Tokopedia / Meta Ads / CRM webhooks with real HMAC signatures

Open **http://localhost:3000/demo** to watch events flow live through the ingestion pipeline while the load test runs.

```bash
# Tear down everything (including volumes)
docker compose down -v
```

### Try the failure scenarios yourself

```bash
# Toggle mock-CRM into 100% failure mode — watch circuit breaker open and DLQ fill
curl -X POST http://localhost:3002/admin/failure-mode \
  -H 'content-type: application/json' \
  -d '{"mode":"fail","rate":1}'

# Restore — watch circuit breaker recover and DLQ drain
curl -X POST http://localhost:3002/admin/failure-mode \
  -H 'content-type: application/json' \
  -d '{"mode":"fail","rate":0}'

# Kill Postgres mid-load — events stay in Redis, zero dropped
docker pause $(docker ps -qf name=postgres)

# Restore — all queued events drain to the database
docker unpause $(docker ps -qf name=postgres)
```

---

## Architecture

```
Webhook Sources              Ingestion API (Fastify · :3001)
────────────────   →   ──────────────────────────────────────
Shopee              HMAC-SHA256 validation → reject if invalid
Tokopedia           Zod v4 schema validation (14× faster than v3)
Meta Ads            SHA-256(channel + payload) fingerprint
CRM Webhooks        Queue.add(jobId = fingerprint) → HTTP 202 in < 5ms

                               ↓

             BullMQ Queue (Redis · :6379)
             ──────────────────────────────────────
             at-least-once delivery guarantee
             idempotency by jobId (fingerprint)
             retry + exponential backoff (configurable)
             circuit breaker via cockatiel
             DLQ = BullMQ failed set on exhausted retries

                               ↓

        BullMQ Worker                     PostgreSQL 15 (Prisma 7)
        ─────────────────   →   ──────────────────────────────────
        normalize event                   events (UNIQUE fingerprint)
        deduplicate (DB UNIQUE)           routing_rules
        apply routing rules               dlq_entries
        sync to mock-CRM
        (circuit-breaker guarded)

                               ↓

             Next.js Dashboard (:3000)
             ──────────────────────────────────────
             /demo          live throughput waveform + stat cards
             /dlq           DLQ list + one-click re-queue
             /dashboard     queue depth · latency · retries · error rate
             /admin/queues  Bull-Board live job browser
```

**Full stack:**

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS · TypeScript 5 |
| Ingestion | Fastify 5 (v5 — Node 20+ only, 5–10% faster than v4) |
| Queue | BullMQ 5 + ioredis 5 (Redis Streams, durable at-least-once) |
| Resilience | cockatiel (TypeScript-first circuit breaker + retry policies) |
| Database | PostgreSQL 15 + Prisma 7 (Rust-free, ESM-native) |
| Validation | Zod 4 (14× faster than v3, native `.toJSONSchema()`) |
| Dashboard | Next.js 16 + React 19 |
| Testing | Vitest 4 · Playwright · Testcontainers |
| CI/CD | GitHub Actions · Docker · GHCR |

---

## Testing

Four named deliverables define the reliability proof:

| ID | Test | What It Proves |
|---|---|---|
| **TST-01** | `pnpm test -- --coverage` (CI gate) | ≥ 80% line coverage on `apps/api`, `apps/worker` + `packages/queue`; build fails below threshold |
| **TST-02** | Testcontainers kill-Postgres integration | `docker pause postgres` mid-processing → zero events dropped from Redis queue → all drain after unpause |
| **TST-03** | `idempotency.test.ts` — 50 concurrent identical jobs → exactly 1 `events` row | DB-level idempotency holds under real parallel race conditions (not mocked) |
| **TST-04** | Playwright E2E — DLQ re-queue operator path | Dashboard `/dlq` renders failed events, re-queue button fires, event appears in `events` table exactly once |

CI runs all four against real Postgres 16 and Redis service containers on every push and pull request.

```bash
# Unit + integration with coverage gate
pnpm test -- --coverage

# E2E (start the full stack first with pnpm demo)
pnpm exec playwright test
```

---

## Deployment Decision

As of 2026, **there is no $0 always-on background-worker tier**:

| Platform | Reality |
|---|---|
| Render background workers | Paid — $7/month per service (free tier is web services only, and they sleep after 15 min) |
| Fly.io | No permanent free tier — pay-as-you-go ~$2–5/month, requires credit card |
| Railway | No permanent free tier — $5/month minimum base charge |
| Cloud Run / Koyeb | Scale-to-zero — a sleeping BullMQ worker means queued jobs pile up unprocessed; the delivery guarantee collapses |

A BullMQ worker that sleeps breaks the core promise. OmniSync therefore ships as **pre-built GHCR images + a one-command reproducible demo + this recorded walkthrough** — a more reliable recruiter artifact than a free-tier URL that may be cold, paused, or down at review time.

This is an **informed engineering decision**, not a gap. The research finding ("no $0 always-on worker in 2026") is the interview talking point. A live deployment is a straightforward drop-in later — the `docker-compose.yml` and published images make it a single config change to target an Oracle Cloud Always Free ARM VM or Fly.io.

```bash
# Pre-built images — pull and run without cloning the repo
docker pull ghcr.io/afrizzal/omnisync-api:latest
docker pull ghcr.io/afrizzal/omnisync-worker:latest
docker pull ghcr.io/afrizzal/omnisync-mock-crm:latest
```

Images are published to GHCR on every merge to `master`; SHA-tagged images are also pushed for pinned production deploys.

---

## Project Structure

```
apps/
  api/          Fastify ingestion API — HMAC validation, Zod parsing, fingerprint, enqueue → HTTP 202
  worker/       BullMQ worker — normalize, deduplicate, route, circuit-break to mock-CRM
  dashboard/    Next.js dashboard — /demo throughput chart, /dlq re-queue, /metrics, Bull-Board
  mock-crm/     Controllable downstream CRM stub — toggleable failure mode via admin endpoint
packages/
  db/           Prisma schema + generated client factory (shared by api and worker)
  queue/        BullMQ Queue + Worker factories (shared queue config, job type definitions)
  config/       Shared Zod env-var validation — fails fast on startup if misconfigured
scripts/
  demo.sh       One-command demo orchestrator: compose up → health checks → autocannon load test
  loadtest.ts   Multi-channel autocannon load test with real HMAC-signed payloads
e2e/            Playwright E2E test suite (TST-04 DLQ re-queue flow)
.github/
  workflows/
    ci.yml      Verify (typecheck + lint + test:coverage + E2E) + Docker build + GHCR publish
```

---

<div align="center">

Built by **[@afrizzal](https://github.com/afrizzal)**

*Open to Senior Backend / Distributed Systems / Lead Full-Stack roles — [afrizzal](https://github.com/afrizzal)*

</div>
