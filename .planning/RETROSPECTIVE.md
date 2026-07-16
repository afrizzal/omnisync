# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — OmniSync CDP (full spec)

**Shipped:** 2026-07-16
**Phases:** 6 | **Plans:** 28 | **Sessions:** ~12 (2026-06-02 → 2026-07-16)

### What Was Built

- Fastify ingestion hot path: HMAC → Zod → SHA-256 fingerprint → Redis SET NX → BullMQ enqueue → HTTP 202 in single-digit ms, structurally DB-free (ING-05 enforced by the dependency graph).
- Always-on BullMQ worker: poison guard → DB-stored routing rules (lazy TTL hot-reload) → normalize → `ON CONFLICT DO NOTHING` persist → cockatiel-guarded mock-CRM sync, with full-jitter backoff and final-attempt-gated DLQ mirrored to Postgres.
- Next.js dashboard: live metrics (queue gauge, throughput, latency, retries), DLQ table with expandable stack traces and one-click idempotent re-queue, /demo live load-test waveform.
- Reliability proof suite: kill-Postgres Testcontainers test (TST-02), 50-concurrent-duplicates → 1 row (TST-03), Playwright DLQ re-queue E2E over the compose stack (TST-04), ≥80% coverage gate (TST-01).
- CI/CD: verify → docker (GHCR push on master) → e2e jobs; multi-stage images for all 4 apps; one-command `pnpm demo` + recorded walkthrough.

### What Worked

- Goal-backward phase verification caught what plan-completion tracking missed — every phase got a VERIFICATION.md except 06, and the milestone audit caught exactly that.
- The `vitest.setup.ts` env-prepopulation pattern (?? defaults, CI overrides pass through) — once established in apps/api, reusing it fixed both apps/worker and (belatedly) packages/queue.
- TDD on the pure seams (fingerprint, backoff, rule engine, DLQ gate) made the resilience logic cheap to verify and safe to rewire.
- Deterministic failure injection (mock-crm fail mode + real signed webhooks) let E2E seed a genuine DLQ entry through the full pipeline instead of a DB shortcut.

### What Was Inefficient

- CI was red for ~3.5 weeks (since 2026-06-21) without anyone noticing — the milestone was "closed" on plan completion, not on green CI. Eight latent defects hid behind the first failure, surfacing one at a time as each fix let the pipeline run further: queue tests crashing at import (no vitest env setup), dockerode missing as a direct devDep, TST-02 hanging forever against a paused Postgres (no pg client timeouts), 33 lint errors behind the unreachable lint step, E2E seed missing the `sha256=` signature prefix, no `migrate deploy` for the fresh compose database, Playwright running configless and sweeping up vitest files, and a BullMQ teardown race (plus a 3-field `buildWorker` call that tsc never saw because tests/ sit outside tsconfig). The kill-Postgres durability test and the Playwright E2E had never actually executed anywhere before this audit.
- OBS-01/OBS-02 were marked complete at phase level but only partially implemented (no intermediate-retry logs; no latency/retry/error-distribution metrics) — caught only by the milestone audit's independent integration check.
- Planning docs drifted from reality (STATE/ROADMAP/REQUIREMENTS all stale after the 06-06 checkpoint closed) — required manual reconciliation during the audit.

### Patterns Established

- Every package whose module graph reaches `@omnisync/config` needs a `vitest.setup.ts` that pre-populates env before imports.
- pnpm strict isolation: any package a test file imports directly must be a direct (dev)dependency — transitive availability is a landmine.
- Milestone audit = 3-source cross-reference (VERIFICATION × SUMMARY frontmatter × traceability) + independent code-level integration check; SUMMARY claims alone are insufficient.
- "Documented substitution" as an honest closure for requirements blocked by external reality (OPS-03: no $0 always-on worker tier) — record decision + rationale + artifacts in the audit rather than silently rescoping.

### Key Lessons

1. "All plans complete" ≠ "milestone done" — the audit found a missing phase verification, two partial requirements, and a red CI behind a 100% plan count.
2. Green CI on every push is a constraint, not a metric: check the actual runs, not the badge, before declaring completion.
3. Verification artifacts should be produced in the same wave as execution (Phase 6 shipped without one because the phase ended on a human-verify checkpoint).

### Cost Observations

- Model mix: primarily sonnet subagents for verification/integration checks; main-loop orchestration on the session model.
- Sessions: ~12 across 45 calendar days (~10 active working days).
- Notable: the audit session closed 14 findings (2 requirement gaps, 1 missing verification, 8 CI/test defects, doc drift, dashboard polish, 1 requirement decision) in a single pass, ending with the repo's first fully-green CI run (29515250970).

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~12 | 6 | Added milestone audit with independent integration check before completion; established red-CI-is-a-blocker rule |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|--------------------|
| v1.0 | 24 test/spec files — 42 api + 46 worker + 5 queue in CI, plus Playwright E2E | ≥80% gate (api, worker, queue; queue at 100%) | crypto (built-in) for HMAC/fingerprint |

### Top Lessons (Verified Across Milestones)

1. (v1.0) Completion tracking must be evidence-based: verification artifacts + green CI, not checked-off plans.
2. (v1.0) Env-validation-at-import (`process.exit` in config) is convenient in prod and hostile in tests — every consumer package needs a setup shim.
