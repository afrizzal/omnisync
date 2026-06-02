---
status: passed
phase: 01-foundation-local-infra
source: [01-VERIFICATION.md]
started: 2026-06-02T09:00:00.000Z
updated: 2026-06-03T00:00:00.000Z
---

## Current Test

[all tests complete — passed]

## Tests

### 1. Redis noeviction policy at runtime (SC1)
expected: `docker compose up -d && pnpm assert:redis` exits 0, confirming Redis is running with `--maxmemory-policy noeviction`
result: PASS — `docker compose up -d postgres redis` → both healthy; `pnpm assert:redis` → "OK: Redis maxmemory-policy is \"noeviction\" at redis://localhost:6379" (exit 0). Verified 2026-06-03 with Docker 29.5.2.

### 2. Full monorepo TypeScript compilation (SC2)
expected: `pnpm install && pnpm build` completes with exit 0 across all packages and apps
result: PASS — `pnpm build` exit 0; Prisma Client 7.8.0, Next.js 16.2.7, all 7 packages compile (verified prior session; re-confirmed by the in-image turbo build).

### 3. Migration applied and fingerprint constraint visible (SC3 runtime)
expected: `psql` `\d events` shows `events_fingerprint_unique` index on the `fingerprint` column
result: PASS — `prisma migrate deploy` applied `20260602045208_init` to live Postgres (localhost:5433); `\d events` shows `"events_fingerprint_unique" UNIQUE, btree (fingerprint)`.

### 4. Multi-stage Docker images build successfully (OPS-02)
expected: `docker compose build api worker` completes without errors, producing runnable images
result: PASS (after 2 fixes) — `docker compose build api worker` exits 0; `Image omnisync-api Built`, `Image omnisync-worker Built`.
  Fix 1: pruned image was missing root `tsconfig.base.json` (turbo prune --docker omits it; every package tsconfig extends it and Prisma's TS-client generator reads it) → added `COPY tsconfig.base.json ./` to both Dockerfiles.
  Fix 2: Dockerfile built only the target app, not its workspace deps, so `tsc` couldn't resolve `@omnisync/config`/`@omnisync/queue` → switched build step to `pnpm exec turbo run build --filter=@omnisync/<app>` (topological ^build, mirrors local `pnpm build`; also runs @omnisync/db prisma generate).

## Environment notes

- Port conflict resolved: native PostgreSQL holds host 5432; docker-compose Postgres remapped to `5433:5432`. `.env` / `.env.example` DATABASE_URL/DIRECT_URL updated to `localhost:5433`.
- Node local is v20.19.0 (project wants >=22; engine-strict off → non-fatal warning). CI/Docker use node:22.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — all Phase 1 success criteria verified live.
