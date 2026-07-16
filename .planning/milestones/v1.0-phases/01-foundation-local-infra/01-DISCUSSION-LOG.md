# Phase 1: Foundation & Local Infra - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 1-foundation-local-infra
**Areas discussed:** Monorepo build tooling, Scaffolding depth, Lint & format, Env config & validation

---

## Monorepo build tooling

| Option | Description | Selected |
|--------|-------------|----------|
| Turborepo + pnpm | Task caching & pipeline (build/lint/test) across packages; modern monorepo signal; cheap now, costly to retrofit | ✓ |
| Plain pnpm workspaces | `pnpm -r` + npm scripts, no extra layer; add Turborepo later | |

**User's choice:** Turborepo + pnpm (recommended)
**Notes:** Portfolio signal weighed positively; locked as repo-wide build orchestration.

---

## Scaffolding depth

| Option | Description | Selected |
|--------|-------------|----------|
| Stub minimal buildable | api/worker = TS entrypoints importing @omnisync/db+types that build; dashboard = bare Next.js; mock-crm & routing_rules deferred to Phase 4 | ✓ |
| Stub + /healthz | Same plus minimal /healthz on api & worker | |
| Include mock-crm & routing schema | Scaffold mock-crm app + routing_rules table now | |

**User's choice:** Stub minimal buildable (recommended)
**Notes:** Keeps Phase 1 to substrate only; mock-crm + routing_rules explicitly deferred to Phase 4; healthz deferred to owning phases.

---

## Lint & format

| Option | Description | Selected |
|--------|-------------|----------|
| Biome | Single lint+format tool, very fast, minimal config, ESM/TS-native | ✓ |
| ESLint + Prettier | Ecosystem standard, fullest TS/Next plugins, more config, slower | |

**User's choice:** Biome (recommended)
**Notes:** Aligns with user's existing `rtk lint` (Biome). Wired into Turborepo pipeline + CI.

---

## Env config & validation

| Option | Description | Selected |
|--------|-------------|----------|
| Zod-validated loader | Shared module parses process.env via Zod, fail-fast at startup; .env.example | ✓ |
| Raw process.env | Direct access, no validation; simplest | |

**User's choice:** Zod-validated loader (recommended)
**Notes:** Fail-fast on missing/invalid config; shared across all apps; fits resilience story.

---

## Claude's Discretion

- Exact patch versions / docker tags
- Shared base tsconfig layout
- Env loader package location (packages/types vs dedicated packages/config)
- Turborepo task naming & cache config
- BullMQ config constants file location (values locked: guardInterval 30000, stalledInterval 300000, drainDelay 30)

## Deferred Ideas

- apps/mock-crm → Phase 4
- routing_rules table → Phase 4
- /healthz endpoints → Phase 2 (api) / Phase 6 (deploy)
- Cloud providers + always-on worker hosting + keep-alive → Phase 6
- Strict ≥80% coverage gate enforcement → Phase 6
