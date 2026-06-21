# OmniSync

**No accepted event is ever silently lost.** Once OmniSync acknowledges a webhook (HTTP 202), that event is durably queued and processed *at-least-once and idempotently* — surviving worker crashes, database outages, and flaky downstream APIs, with a Dead-Letter Queue as the final safety net and a one-click path back to reprocessing.

OmniSync is a **distributed, event-driven Customer Data Platform (CDP)** built to prove production-grade distributed-systems engineering: decoupled ingestion (Fastify), background worker queues (BullMQ + Redis), idempotent persistence (PostgreSQL + Prisma), automated resilience patterns (retry/backoff, circuit breaker, DLQ), observability, and a rigorous automated test suite. Built for a **Senior Backend / Distributed Systems / Lead Full-Stack** portfolio showcase.

---

## Quick Demo (one command)

Requires Docker, Node 22, and pnpm.

```bash
cp .env.example .env
pnpm install
pnpm demo
```

This single command:

1. Brings up the full stack via `docker compose up` — api, worker, postgres, redis, mock-crm, and the Next.js dashboard.
2. Waits for the API health check on `:3001` and dashboard on `:3000`.
3. Runs a multi-channel autocannon load test (Shopee / Tokopedia / Meta Ads / CRM events with real HMAC signatures).

Open **http://localhost:3000/demo** to watch events flow live through the ingestion pipeline while the load test runs.

**Stop and clean up:**

```bash
docker compose down -v
```

---

## Recorded Walkthrough

> Recording: see docs/demo.gif (capture via `pnpm demo`).

![OmniSync demo](docs/demo.gif)

The walkthrough covers four scenes in order:

1. **Load-test driving the /demo chart** — autocannon blasts multi-channel events; the dashboard chart updates in real time showing events processed vs. failed.
2. **50 concurrent identical webhooks → exactly 1 stored row** — the TST-03 concurrent-dedup proof runs visibly; the database shows a single event record despite 50 parallel submissions.
3. **Circuit breaker opening and recovering under mock-crm failure** — toggle the mock-crm into failure mode:
   ```bash
   curl -X POST http://localhost:3002/admin/failure-mode \
     -H 'content-type: application/json' \
     -d '{"mode":"fail","rate":1}'
   ```
   Watch the DLQ fill as the breaker opens, then set `rate` back to `0` and observe automatic recovery.
4. **Kill-Postgres durability scenario** — `docker pause <postgres-container>` mid-load; events remain queued in Redis (zero dropped), `docker unpause` resumes and they drain completely to the database.

---

## Container Images (GHCR)

Images are built and pushed to GitHub Container Registry on every merge to `master` (build-only on PRs).

```bash
docker pull ghcr.io/afrizzal/omnisync-api:latest
docker pull ghcr.io/afrizzal/omnisync-worker:latest
docker pull ghcr.io/afrizzal/omnisync-mock-crm:latest
```

SHA-tagged images are also published for pinned deployments: `:sha-<commit-sha>`.

The `docker-compose.yml` at the root references these images and is the one-command demo substrate — `pnpm demo` uses it directly.

---

## Deployment Decision: Why No Live Public URL

As of 2026 there is no $0 always-on background-worker tier: Render background workers are paid ($7/month each), Fly.io's free tier is gone (~$2–5/month pay-as-you-go), Railway's free credit is insufficient for two always-on services, and Koyeb's free tier scales to zero. A BullMQ worker that sleeps breaks the at-least-once delivery guarantee — queued jobs pile up unprocessed and the core value proposition collapses.

So OmniSync ships as **published GHCR images + a one-command reproducible demo + a recorded walkthrough** — a more reliable recruiter artifact than a free-tier URL that may be cold or down at review time. The `docker-compose.yml` and images make a live deploy a straightforward drop-in later (Oracle Cloud Always Free ARM VM, or ~$2–5/month on Fly.io) when budget allows.

This is an **informed engineering decision**, not a gap: the research finding ("no $0 always-on worker in 2026") is itself the interview talking point.

---

## Testing

OmniSync has a rigorous automated test suite with ≥80% line coverage enforced as a CI gate.

**Signature tests:**

| ID | Test | What It Proves |
|----|------|----------------|
| TST-01 | `pnpm test -- --coverage` | ≥80% line coverage on `apps/api` + `apps/worker`; fails CI below threshold |
| TST-02 | Testcontainers kill-Postgres integration test | In-flight events survive a Postgres outage mid-processing — zero events dropped from the BullMQ queue, they drain after unpause |
| TST-03 | `idempotency.test.ts`: 50 concurrent identical jobs → exactly 1 events row | Concurrent duplicate webhooks result in exactly one stored record (DB-level idempotency under race conditions) |
| TST-04 | Playwright E2E DLQ re-queue flow | Dashboard `/dlq` page loads, re-queue button fires, event appears in the events table exactly once |

**Run tests:**

```bash
# Unit + integration (with coverage gate)
pnpm test -- --coverage

# E2E (requires the full stack to be up: pnpm demo first)
pnpm exec playwright test
```

CI runs both on every push against real Postgres and Redis service containers.

---

## Architecture Overview

```
Webhook Sources          Ingestion API (Fastify)       Queue (BullMQ + Redis)
─────────────────   →   ─────────────────────────   →  ──────────────────────
Shopee / Tokopedia       • HMAC-SHA256 validation        • At-least-once delivery
Meta Ads / CRM           • Zod schema validation         • Idempotency by jobId
                         • Fingerprint generation         • Retry + exponential backoff
                         • HTTP 202 (< 5ms)               • Circuit breaker (cockatiel)
                                                          • Dead-Letter Queue
                              ↓
                       Worker (BullMQ)                  PostgreSQL (Prisma)
                       ─────────────────   →            ─────────────────────
                       • Normalize event                 • events table
                       • Deduplicate (UNIQUE fingerprint) • routing_rules table
                       • Apply routing rules             • dlq_entries table
                       • Sync to mock-CRM
                              ↓
                       Next.js Dashboard (Port 3000)
                       ─────────────────────────────
                       • /demo  — live throughput chart
                       • /dlq   — DLQ list + one-click re-queue
                       • /metrics — queue depth, latency, error rate
```

**Tech stack:** Node.js 22 · TypeScript 5 · Fastify 5 · BullMQ 5 · ioredis 5 · PostgreSQL 15 · Prisma 7 · Zod 4 · Next.js 16 · Vitest 4 · Playwright · Testcontainers · Docker · GitHub Actions

---

## Project Structure

```
apps/
  api/          Fastify ingestion API (webhook receiver)
  worker/       BullMQ worker (event processor)
  dashboard/    Next.js observability dashboard
  mock-crm/     Controllable downstream CRM stub (failure toggle)
packages/
  db/           Prisma schema + client factory
  queue/        BullMQ queue + worker factories
  config/       Shared env-var validation (Zod)
scripts/
  demo.sh       One-command demo entrypoint (compose up + load test)
  loadtest.ts   Autocannon multi-channel load test (OPS-04)
e2e/            Playwright E2E tests (TST-04)
```
