# Milestones

## v1.0 Full Spec (Shipped: 2026-07-16)

**Phases completed:** 6 phases, 28 plans, 59 tasks
**Requirements:** 35/35 v1 requirements satisfied — audit PASSED (`milestones/v1.0-MILESTONE-AUDIT.md`)
**Evidence:** CI run 29515250970 fully green (verify + Playwright E2E + Docker/GHCR), commit `90d6a90`
**Timeline:** 2026-06-02 → 2026-07-16 (~10 active working days)

**Key accomplishments:**

- **Ingestion hot path** — Fastify `POST /ingest/:source`: HMAC verification over raw body → Zod validation → SHA-256 idempotency fingerprint → Redis SET NX gate → BullMQ enqueue (jobId = fingerprint) → HTTP 202 in single-digit milliseconds, structurally DB-free.
- **Idempotent worker core** — always-on BullMQ worker: poison guard → DB-stored routing rules (lazy TTL hot-reload, no redeploy) → normalize → `INSERT … ON CONFLICT DO NOTHING` persist; 50 concurrent identical webhooks provably yield exactly one row.
- **Resilience stack** — full-jitter exponential backoff, cockatiel circuit breaker guarding the mock-CRM downstream (persist stays outside the breaker), final-attempt-gated DLQ mirrored to durable Postgres, idempotent one-click re-queue.
- **Operator dashboard** — Next.js: live metrics (queue gauge, throughput, latency, retries, error distribution), DLQ table with expandable stack traces + re-queue, /demo live load-test waveform driven through the real pipeline.
- **Reliability proof suite** — Testcontainers kill-Postgres durability test (zero drops, exactly-once after recovery), concurrency/idempotency/DLQ/re-queue integration suites vs real Postgres+Redis, Playwright E2E over the full compose stack, ≥80% coverage gate.
- **CI/CD & delivery** — GitHub Actions verify → docker (GHCR publish on master) → E2E jobs; multi-stage images for all 4 apps; one-command `pnpm demo`; recorded walkthrough `docs/demo-omnisync.mp4` (accepted substitution for live free-tier hosting — no $0 always-on worker tier exists in 2026).

**Closing audit notes:** milestone audit (2026-07-16) found and remediated 14 findings in one session — OBS-01/OBS-02 partial implementations, missing Phase 6 verification, planning-doc drift, and 8 latent CI/test defects (CI had been red since 2026-06-21; the durability and E2E tests had never actually executed before the audit). Details and lessons: `milestones/v1.0-MILESTONE-AUDIT.md`, `RETROSPECTIVE.md`.

**Accepted tech debt (v2 backlog):** `packages/db` outside the coverage gate (documented scoping); no operator UI/API for routing-rule CRUD; Nyquist VALIDATION drafts for phases 1/2/5.

---
