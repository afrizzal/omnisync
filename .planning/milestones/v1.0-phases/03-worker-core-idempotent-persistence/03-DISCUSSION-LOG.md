# Phase 3: Worker Core & Idempotent Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 03-worker-core-idempotent-persistence
**Areas discussed:** Normalization depth, Event status lifecycle, DLQ schema pre-staging, packages/queue hardening

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Kedalaman normalisasi (QUE-04) | Field extraction vs business-entity extraction vs defer to Phase 4 rules | delegated |
| Siklus status event | Single-write COMPLETED vs multi-stage DB transitions | delegated |
| Pre-staging schema DLQ | Fix dlq_events standalone now vs defer to Phase 4 | delegated |
| Hardening packages/queue | Factory refactor, defaultJobOptions, D-10 re-verification, EventJobData contract, API-Prisma removal | delegated |

**User's choice:** Full delegation — "saya menyerahkan sepenuhnya untuk segala keputusan kepada anda (model Fable), anda yang paling mengerti bagaimana aplikasi ini nantinya dapat menarik recruiter yang percaya akan kemampuan saya. Tolong hasil dari keputusan anda dicatat dalam memory."

**Notes:** User mandate: optimize all decisions for portfolio credibility with recruiters / senior engineers; record decisions in Claude's persistent memory for later recall.

---

## Claude's Decisions (under delegated authority)

| Area | Decision | Alternatives rejected & why |
|------|----------|------------------------------|
| Normalization depth | Canonical envelope extraction (D-01/D-02): extract source/eventType/externalId/occurredAt to columns (new migration), payload Json keeps full event; semantic transforms stay in Phase 4 | Business-entity extraction rejected: duplicates Phase 4 routing-rules scope, schema churn ahead of requirements. Pure-Json (no new columns) rejected: a CDP that can't query by business timestamp isn't credible to the target audience |
| Status lifecycle | Single atomic insert with COMPLETED (D-03/D-04/D-05); lifecycle observability via structured logs | Multi-stage DB transitions rejected: 3× write volume on free tier, partial-state races, no demo value; logs already satisfy OBS-01's consumer |
| DLQ schema | Pre-stage standalone dlq_events now (D-06): drop required FK, add fingerprint/source/eventType/error fields, nullable eventId without FK | Defer-to-Phase-4 rejected: same retrofit logic as UNIQUE(fingerprint) — the headline DLQ scenario (DB down) cannot satisfy an FK to a row that was never written |
| Queue hardening | Side-effect-free factories + defaultJobOptions + D-10 amendment mandate + EventJobData Zod contract + drop Prisma from API (D-07..D-10, D-14) | Keeping module singletons rejected: import-time socket opening is untestable and currently bypasses validated env; unbounded job retention rejected: Upstash 256 MB free tier |

## Claude's Discretion

Delegated further downstream (researcher/planner): worker file layout, Prisma write mechanism, integration-test harness (compose vs Testcontainers), log field shapes, bull-board inclusion.

## Deferred Ideas

Retry/backoff + DLQ logic (Phase 4), kill-Postgres test (Phase 6), worker healthz/keep-alive (Phase 6), Upstash command measurement (research task in this phase, not UAT), bull-board (optional).
