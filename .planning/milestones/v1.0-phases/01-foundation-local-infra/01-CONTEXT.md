# Phase 1: Foundation & Local Infra - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the shared substrate every other phase builds on: an ESM-native pnpm monorepo, the authoritative Prisma schema (`events` with `UNIQUE(fingerprint)` + `dlq_events` + status enum), shared Zod types, the BullMQ queue connection, and a reproducible **local** Docker environment with a green CI skeleton.

This phase builds NO business logic. Ingestion (Phase 2), worker processing (Phase 3), resilience (Phase 4), dashboard (Phase 5), and deployment/testing (Phase 6) are out of scope here. The bar is: everything compiles, the schema migrates with the unique constraint present, shared packages import cleanly across all apps, `docker compose up` brings up Postgres + Redis (noeviction), and CI passes.

Requirements covered: **QUE-01** (Redis-backed BullMQ queue decoupling — connection/config established), **OPS-02** (api + worker build as Docker images, run via docker-compose locally). Schema also pre-stages **IDM-02**'s `UNIQUE(fingerprint)` even though enforcement logic lands in Phase 3.
</domain>

<decisions>
## Implementation Decisions

### Monorepo & Build Tooling
- **D-01:** pnpm workspaces + **Turborepo** for task orchestration (build / typecheck / lint / test pipelines with caching). Chosen for the modern-monorepo signal and cheap-now / expensive-to-retrofit reasoning.
- **D-02:** Workspace layout — `apps/api`, `apps/worker`, `apps/dashboard`; `packages/db` (`@omnisync/db` — Prisma schema + generated client), `packages/types` (`@omnisync/types` — Zod schemas + shared TS types). No circular dependencies between packages.
- **D-03:** ESM-native across the whole repo (`"type": "module"`) — mandatory for Prisma 7. Runtime: Node 22 LTS.

### Scaffolding Depth (this phase)
- **D-04:** `apps/api` and `apps/worker` = minimal buildable TypeScript entrypoints that import `@omnisync/db` + `@omnisync/types` and pass `pnpm -r build`. No ingestion/worker business logic (that is Phases 2–3).
- **D-05:** `apps/dashboard` = bare Next.js (App Router) app that builds and can import shared types. No real UI (that is Phase 5).
- **D-06:** Deferred, NOT scaffolded now: `apps/mock-crm` and the `routing_rules` table → Phase 4; `/healthz` endpoints → with their owning apps (api Phase 2 / deployment Phase 6).

### Database Schema (Prisma 7)
- **D-07:** Authoritative schema defined now: `events` table with a named unique constraint `events_fingerprint_unique` on `fingerprint`; `dlq_events` table; `EventStatus` enum (`RECEIVED`, `PROCESSING`, `COMPLETED`, `FAILED`, `DLQ`). Index `status`, `source`, `created_at` per architecture research.
- **D-08:** `routing_rules` table is NOT in Phase 1 — added via a later migration in Phase 4 (RTE).
- **D-09:** Establish the two-URL Prisma pattern from day one — pooled runtime URL + `directUrl` for migrations (Neon-compatible per research), even though local dev points both at the docker Postgres. Keeps the env shape correct for the Phase 6 cloud switch.

### Queue Infrastructure (QUE-01)
- **D-10:** Establish the shared BullMQ queue connection + tuned config now, with research-sourced interval defaults locked early so later integration-test timing assumptions are stable: `guardInterval: 30000`, `stalledInterval: 300000`, `drainDelay: 30` (rationale: free-tier Upstash command-quota viability). Queue is wired; real producers/consumers arrive in Phases 2–3.
- **D-11:** Redis must run with `maxmemory-policy noeviction`, asserted at startup (a failed assertion should stop boot, not warn).

### Lint & Format
- **D-12:** **Biome** as the single lint + format tool for the entire repo (fast, minimal config, ESM/TS-native). Wired into the Turborepo pipeline and the CI skeleton.

### Env Config & Validation
- **D-13:** A shared **Zod-validated env loader** — parses `process.env` against a Zod schema and **fails fast at startup** on missing/invalid config. Ships a committed `.env.example`. Consumed by all apps (no per-app duplication).

### Local Infra & CI
- **D-14:** `docker-compose.yml` runs Postgres + Redis locally only. Pin major versions (Postgres 16, Redis 7). Phase 1 is LOCAL-ONLY — cloud providers and hosting are Phase 6; env var shape stays compatible so the later switch is config-only.
- **D-15:** GitHub Actions CI skeleton: pnpm install → type-check → `pnpm -r build` → Biome check, on every push, green. Coverage-gate machinery may be scaffolded but the strict ≥80% enforcement lands in Phase 6 with the real test suite. CI uses Node 22.

### Claude's Discretion
- Exact patch versions / docker image tags.
- Shared base `tsconfig` layout and how apps extend it.
- Whether the env loader lives in `packages/types` or a dedicated `packages/config` (must be shared, not duplicated).
- Turborepo pipeline task naming and cache config.
- Exact file location of the BullMQ config constants (values themselves are locked in D-10).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner) MUST read these before planning or implementing.**

### Research (project-level, already done)
- `.planning/research/STACK.md` — current versions (Node 22, Fastify 5.8, BullMQ 5.77, Prisma 7 ESM, Zod 4, Vitest 4), Biome vs ESLint note, BullMQ interval tuning numbers, Neon `directUrl` pattern, free-tier providers
- `.planning/research/ARCHITECTURE.md` — monorepo topology, package boundaries, fingerprint strategy, Prisma schema design, indexes, strict build order
- `.planning/research/PITFALLS.md` — Redis `noeviction`, the ESM/`"type":"module"` trap, unique-constraint-before-worker, two-Prisma-URL gotcha
- `.planning/research/SUMMARY.md` — reconciled decisions + per-phase implications

### Requirements & Project
- `.planning/REQUIREMENTS.md` — QUE-01, OPS-02 (Phase 1); IDM-02 (`UNIQUE(fingerprint)`, enforced Phase 3 but schema defined now)
- `.planning/PROJECT.md` — constraints (near-zero cost, ≥80% coverage bar), Key Decisions, stack rationale

No external ADRs/specs — this is a greenfield project; requirements are captured in the research docs + decisions above.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield. The repo currently contains only `.planning/` and `.claude/`. This phase creates the first code.

### Established Patterns
- None yet. **This phase DEFINES the patterns** (ESM, monorepo layout, shared packages, Biome, Zod-validated env) that every later phase inherits. Treat the decisions above as the pattern source of truth.

### Integration Points
- `packages/db` and `packages/types` are the shared seams every app imports — get their public surfaces and ESM exports right, since Phases 2–5 depend on them.
</code_context>

<specifics>
## Specific Ideas

- **Executor is Sonnet in a separate terminal** (see [[workflow-two-terminal-opus-sonnet]]). The PLAN.md must be explicit enough that the executor needs no architectural judgment — leave no implicit decisions. Every choice above is intentionally locked for that reason.
- **"Correct from day one" framing:** the value of this phase is that the unique constraint, ESM, two-URL Prisma pattern, and noeviction Redis are right *before* any logic depends on them — retrofitting them later is the documented failure mode.
</specifics>

<deferred>
## Deferred Ideas

- `apps/mock-crm` (toggleable-failure downstream) — **Phase 4** (resilience / circuit breaker).
- `routing_rules` table + dynamic routing — **Phase 4** (RTE).
- `/healthz` endpoints — api in **Phase 2**, worker keep-alive wiring in **Phase 6**.
- Cloud providers (Neon, Upstash) + always-on worker hosting + keep-alive — **Phase 6** (deployment). Env shape kept compatible now.
- Strict ≥80% coverage gate enforcement — **Phase 6** (with the real test suite).

No scope creep surfaced — discussion stayed within the foundation boundary.
</deferred>

---

*Phase: 01-foundation-local-infra*
*Context gathered: 2026-06-02*
