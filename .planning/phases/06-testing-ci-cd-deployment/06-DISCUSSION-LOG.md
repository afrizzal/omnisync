# Phase 6: Testing, CI/CD & Deployment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 06-testing-ci-cd-deployment
**Areas discussed:** Deployment & live-demo topology, Kill-Postgres test mechanism, CI/CD scope, E2E + load-test harness

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Deployment & live-demo topology | OPS-03 hosting + live-demo strategy | ✓ |
| Kill-Postgres test mechanism | TST-02 durability test approach | ✓ |
| CI/CD scope | OPS-01 Docker/CD step | ✓ |
| E2E + load-test harness | TST-04 + OPS-04 tooling | ✓ |

**User's choice:** All four.

---

## Deployment & Live-Demo Topology (OPS-03)

Research-grounded (2026 free-tier state): no free tier runs an always-on background worker.

| Option | Description | Selected |
|--------|-------------|----------|
| CI/CD + local + recorded demo | $0; `docker compose up` full stack + recorded walkthrough + published images; no live URL | ✓ |
| Oracle Free VM (live $0 URL) | Self-host whole stack on Ampere A1 ARM; genuine live URL at $0; setup effort + flaky free capacity | |
| Fly.io pay-as-you-go | ~$2–5/mo always-on machines; easy Docker; breaks free-only; mock-crm stays local | |
| Both: Oracle live + recorded | Recorded/local now + Oracle live URL as follow-on | |

**User's choice:** CI/CD + local + recorded demo.
**Notes:** Pragmatic for a time-boxed job hunt; $0 and always works for a recruiter. mock-crm runs in compose so the live breaker demo is preserved in the recording. ROADMAP SC-5 / OPS-03 to be reframed at transition (→ D-01).

## Kill-Postgres Test Mechanism (TST-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Testcontainers | Ephemeral PG container, `container.pause()` mid-flight, isolated; roadmap's named approach | ✓ |
| Reuse CI/compose PG + docker pause | No new lib but fragile; risks disturbing parallel tests | |
| Local-only compose pause script | Demo-only, not a clean CI-gated test | |

**User's choice:** Testcontainers.
**Notes:** Isolation is the deciding factor — the kill-test must own the DB it pauses. Daemon present on GH Actions ubuntu-latest; existing service containers stay for other integration tests (→ D-05/D-06).

## CI/CD Scope (OPS-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Build + push images to GHCR | Merge-to-master builds api/worker/mock-crm → GHCR (latest+sha); PRs build-only | ✓ |
| Build-only (no registry) | Build to prove Dockerfiles green, no push; weaker CD story | |
| Build + push + Release bundle | Above + tagged Release with compose + demo assets | |

**User's choice:** Build + push images to GHCR.
**Notes:** Gives a real "deploy-ready images" CD narrative without a host; makes the one-command demo pullable. Coverage gate stays on api+worker only (honors Phase 3 decision). Branch-protection toggle is a manual user step (→ D-08..D-11).

## E2E + Load-Test Harness (TST-04 + OPS-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone autocannon CLI | `scripts/loadtest.ts` (tsx) blasts multi-channel signed events at /ingest; points at any URL; drives /demo chart | ✓ |
| k6 script | Industry-standard, nicer metrics, but non-Node binary to install | |
| Custom tsx fetch-loop | Zero deps, full control, less polished metrics | |
| Reuse /api/demo/start route | Simplest, but not an external blaster (OPS-04 implies a script) | |

**User's choice:** Standalone autocannon CLI.
**Notes:** Playwright runs against the docker-compose stack (assumed default, accepted). Load-test must use real per-source HMAC signatures, not a bypass (→ D-12/D-13/D-14).

## Claude's Discretion

- Demo orchestration entrypoint, Testcontainers file location, Playwright seeding mechanism, autocannon flags, GHCR naming/tagging + Actions job structure, recorded-demo tooling.

## Deferred Ideas

- Live public deploy (Oracle Free / Fly.io) as optional post-Phase-6 stretch; branch-protection toggle (manual); bull-board; real connectors/auth (v2); k6 suite (future).
