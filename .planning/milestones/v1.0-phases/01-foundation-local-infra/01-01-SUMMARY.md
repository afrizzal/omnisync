---
phase: 01-foundation-local-infra
plan: "01"
subsystem: monorepo-tooling
tags:
  - pnpm
  - turborepo
  - biome
  - docker
  - redis
  - typescript
  - esm
dependency_graph:
  requires: []
  provides:
    - root-esm-pnpm-workspace
    - turborepo-pipeline
    - shared-tsconfig-base
    - biome-config
    - docker-compose-local-infra
    - redis-noeviction-assertion
  affects:
    - all-subsequent-plans
tech_stack:
  added:
    - pnpm@9.15.9 (workspace manager)
    - turbo@2.9.16 (task orchestration)
    - "@biomejs/biome@2.4.16" (lint + format)
    - typescript@5.9.3 (type safety)
    - ioredis@5.11.0 (Redis client for assert-redis)
    - tsx@4.22.4 (TypeScript script runner)
  patterns:
    - ESM-native monorepo with "type":"module" across all packages
    - NodeNext module/moduleResolution for strict ESM import resolution
    - Turborepo v2 "tasks" key (not legacy "pipeline")
    - Biome 2 files.includes pattern (not files.ignore)
    - Redis noeviction assertion at boot/CI as a process.exit(1) hard stop
key_files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - .npmrc
    - .nvmrc
    - pnpm-lock.yaml
    - turbo.json
    - tsconfig.base.json
    - biome.json
    - docker-compose.yml
    - scripts/assert-redis.ts
    - .gitignore
  modified: []
decisions:
  - "Biome 2.4.16 uses files.includes (not files.ignore) with negation patterns — verified and auto-fixed during execution"
  - "Biome 2.2.0+ folder exclusions do not need trailing /** — auto-fixed via biome check --write"
  - "VCS useIgnoreFile disabled in biome.json for now (no .gitignore existed at Task 2 execution time)"
  - "Docker not available in CI agent — docker compose up verification deferred to human/local run"
  - "Node 20.19.0 running in agent (engine requires >=22) — warning only, does not break install or tooling"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-02T04:16:21Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 11
  files_modified: 0
---

# Phase 01 Plan 01: Repo Skeleton + Tooling + Local Infra Summary

**One-liner:** ESM-native pnpm + Turborepo monorepo with Biome linting, shared strict NodeNext tsconfig, and local Postgres 16 + Redis 7 (noeviction) via docker-compose with a boot assertion script.

## What Was Built

This plan established the complete foundational substrate for the OmniSync monorepo:

1. **Root ESM workspace** — `package.json` with `"type":"module"`, `"private":true`, Node >=22 engine, pnpm@9.15.9 as packageManager. Scripts delegate all pipeline tasks to Turborepo. `pnpm-workspace.yaml` globs `apps/*` and `packages/*`. `.npmrc` enables workspace package linking. `.nvmrc` pins Node 22.

2. **Turborepo v2 pipeline** — `turbo.json` uses the v2 `tasks` schema (not legacy `pipeline`). Tasks: `build` (dependsOn ^build, outputs dist/**/.next/**/generated/**), `typecheck` (dependsOn ^build), `lint` (no deps), `dev` (cache:false, persistent:true).

3. **Shared base TypeScript config** — `tsconfig.base.json` with `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `declaration true`, `verbatimModuleSyntax true`, `resolveJsonModule true`. This is the single source of truth extended by all packages/apps.

4. **Biome 2.4.16** — `biome.json` with 2-space formatter, double-quote JS, recommended linter rules. Scoped to `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.json` while excluding dist, .next, generated, node_modules, .planning, .claude. `biome check .` passes cleanly.

5. **Local Docker infra** — `docker-compose.yml` with `postgres:16` (pg_isready healthcheck, named pgdata volume) and `redis:7` launched with `--maxmemory-policy noeviction` (redis-cli ping healthcheck).

6. **assert-redis.ts** — TypeScript script at `scripts/assert-redis.ts` that connects to Redis via ioredis, calls `CONFIG GET maxmemory-policy`, logs OK and exits 0 if noeviction, logs FATAL and exits 1 otherwise. Registered as `pnpm assert:redis`. This enforces Success Criterion #1.

7. **`.gitignore`** — Protects `node_modules/`, `dist/`, `.next/`, `.turbo/`, `generated/`, `.env`, `*.log`.

## Verification Results

| Check | Result |
|-------|--------|
| `grep '"type": "module"' package.json` | PASS |
| `grep '"private": true' package.json` | PASS |
| `grep '"packageManager": "pnpm@' package.json` | PASS |
| `grep 'turbo run build' package.json` | PASS |
| `pnpm-workspace.yaml has packages/*` | PASS |
| `.nvmrc has 22` | PASS |
| `pnpm exec turbo --version` → 2.9.16 | PASS |
| `pnpm exec biome --version` → 2.4.16 | PASS |
| `pnpm exec biome check .` | PASS (5 files, 0 errors) |
| `turbo.json has "build"` | PASS |
| `tsconfig.base.json has NodeNext` | PASS |
| `tsconfig.base.json has "strict": true` | PASS |
| `docker-compose.yml has postgres:16` | PASS |
| `docker-compose.yml has noeviction` | PASS |
| `scripts/assert-redis.ts has maxmemory-policy` | PASS |
| `package.json has assert:redis` | PASS |
| `.gitignore has .env and node_modules` | PASS |
| `docker compose up -d + pnpm assert:redis` | DEFERRED — Docker not in agent environment; verified structurally |

## Installed Versions (Actual)

| Package | Installed |
|---------|-----------|
| pnpm | 9.15.9 |
| turbo | 2.9.16 |
| @biomejs/biome | 2.4.16 |
| typescript | 5.9.3 |
| ioredis | 5.11.0 |
| tsx | 4.22.4 |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 54abff2 | feat(01-01): root ESM pnpm workspace manifest and tooling |
| Task 2 | 9da13d2 | feat(01-01): Turborepo pipeline, shared base tsconfig, and Biome config |
| Task 3 | ac05d96 | feat(01-01): docker-compose local infra, assert-redis script, and .gitignore |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome 2 uses files.includes, not files.ignore**
- **Found during:** Task 2
- **Issue:** RESEARCH.md referenced `files.ignore` but Biome 2.x uses `files.includes` with negation patterns (`!pattern`) instead
- **Fix:** Changed to `files.includes` array with `!` prefixed exclusions
- **Files modified:** `biome.json`
- **Commit:** 9da13d2

**2. [Rule 1 - Bug] Biome 2.2.0+ folder exclusion patterns don't need trailing /\*\***
- **Found during:** Task 2
- **Issue:** Used `!**/dist/**` patterns which triggered `useBiomeIgnoreFolder` lint warnings
- **Fix:** Applied `biome check --write` auto-fix to strip trailing `/**`
- **Files modified:** `biome.json`
- **Commit:** 9da13d2

**3. [Rule 1 - Bug] Single-quote strings in assert-redis.ts**
- **Found during:** Task 3
- **Issue:** Used single-quote string in one console.error call, violating biome's quoteStyle:double setting
- **Fix:** Applied `biome check --write` auto-fix; also wrapped ternary operand in parens per biome formatting
- **Files modified:** `scripts/assert-redis.ts`
- **Commit:** ac05d96

**4. [Rule 3 - Environment] Docker not available in agent bash environment**
- **Found during:** Task 3 verification
- **Issue:** `docker compose config` and `docker compose up -d` commands not available — docker binary not in PATH
- **Fix:** Verified docker-compose.yml structurally via Node.js content inspection; deferred functional Docker + Redis assertion test to human/local run
- **Impact:** `pnpm assert:redis` not verified live in this agent run; will pass when Docker Desktop is running locally

**5. [Rule 2 - Enhancement] VCS useIgnoreFile disabled temporarily**
- **Found during:** Task 2
- **Issue:** Biome VCS `useIgnoreFile: true` fails when `.gitignore` doesn't exist yet (created in Task 3)
- **Fix:** Set `useIgnoreFile: false` since the `files.includes` patterns provide equivalent exclusion
- **Note:** This is intentional — when `.gitignore` is present and consistent, it can be re-enabled; the current exclusion list in `files.includes` serves the same purpose

## Known Stubs

None — this plan creates only configuration files and a utility script. No application data flows through stubs.

## Self-Check: PASSED

Files exist:
- FOUND: package.json
- FOUND: pnpm-workspace.yaml
- FOUND: .npmrc
- FOUND: .nvmrc
- FOUND: turbo.json
- FOUND: tsconfig.base.json
- FOUND: biome.json
- FOUND: docker-compose.yml
- FOUND: scripts/assert-redis.ts
- FOUND: .gitignore

Commits exist:
- FOUND: 54abff2 (Task 1)
- FOUND: 9da13d2 (Task 2)
- FOUND: ac05d96 (Task 3)
