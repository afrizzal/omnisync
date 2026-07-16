---
phase: 01-foundation-local-infra
plan: 02
subsystem: database
tags: [prisma, zod, typescript, postgresql, schema, migrations, esm]

requires:
  - phase: 01-foundation-local-infra plan 01
    provides: pnpm workspace, tsconfig.base.json, turbo.json, biome, docker-compose Postgres

provides:
  - "@omnisync/types: Zod 4 schemas (EventSource enum, InboundEvent object) + inferred TS types"
  - "@omnisync/db: Prisma 7 schema with events + dlq_events tables + EventStatus enum"
  - "events_fingerprint_unique named unique constraint on fingerprint column (SC3)"
  - "Initial Prisma migration applied (20260602045208_init)"
  - "Shared PrismaClient singleton using PrismaPg driver adapter (Prisma 7 pattern)"
  - "prisma.config.ts with defineConfig for connection URL (Prisma 7 ESM pattern)"

affects:
  - 01-foundation-local-infra plan 03 (queue module, env loader)
  - all apps (api, worker, dashboard) that import @omnisync/types and @omnisync/db

tech-stack:
  added:
    - "zod@4.4.3 (via zod/v4 subpath import)"
    - "@prisma/client@7.8.0"
    - "prisma@7.8.0 (devDep)"
    - "@prisma/adapter-pg@7.8.0"
    - "pg@8.21.0"
    - "@types/pg@8.20.0 (devDep)"
    - "dotenv@16.x (devDep, for prisma.config.ts)"
  patterns:
    - "Zod 4 imported via 'zod/v4' subpath (not 'zod')"
    - "Prisma 7 generator = 'prisma-client', output = '../generated/prisma'"
    - "Prisma 7 connection URL in prisma.config.ts (defineConfig), NOT in schema.prisma datasource"
    - "Prisma 7 PrismaClient requires PrismaPg adapter in constructor (driver adapter pattern)"
    - "PrismaClient singleton on globalThis to prevent HMR pool exhaustion"
    - "packages/db tsconfig rootDir=. with include=[src, generated] to compile generated TS files"

key-files:
  created:
    - packages/types/package.json
    - packages/types/tsconfig.json
    - packages/types/src/event.ts
    - packages/types/src/index.ts
    - packages/db/package.json
    - packages/db/tsconfig.json
    - packages/db/prisma/schema.prisma
    - packages/db/prisma.config.ts
    - packages/db/prisma/migrations/20260602045208_init/migration.sql
    - packages/db/prisma/migrations/migration_lock.toml
    - packages/db/src/index.ts
  modified:
    - pnpm-lock.yaml

key-decisions:
  - "Prisma 7.8.0 uses prisma.config.ts (defineConfig) for DATABASE_URL — not schema.prisma datasource url field (breaking change from v6)"
  - "Prisma 7 generator name is 'prisma-client' (not 'prisma-client-js'); output is '../generated/prisma' (TS source)"
  - "PrismaClient in Prisma 7 requires SqlDriverAdapterFactory (PrismaPg) — no connection-string fallback in constructor"
  - "packages/db tsconfig uses rootDir=. + include=[src,generated] to handle generated TypeScript alongside src"
  - "Two-URL split (DATABASE_URL + DIRECT_URL) not applicable in Prisma 7 config — single url in prisma.config.ts; split only for Neon pooler (Phase 6)"
  - "omnisync postgres user needs CREATEDB permission for prisma migrate dev shadow database"

patterns-established:
  - "Zod 4 pattern: import { z } from 'zod/v4'; export type Foo = z.infer<typeof FooSchema>"
  - "Prisma 7 pattern: prisma.config.ts + defineConfig + PrismaPg adapter in PrismaClient constructor"
  - "Singleton pattern: globalThis guard for PrismaClient in globalForPrisma typed as { prisma?: PrismaClient }"

requirements-completed: []

duration: 45min
completed: 2026-06-02
---

# Phase 01 Plan 02: Shared Data Substrate Summary

**Prisma 7 ESM schema with events + dlq_events tables, named fingerprint constraint (SC3), and @omnisync/types Zod 4 schemas — applying the new prisma.config.ts + PrismaPg driver adapter pattern from Prisma 7.8.0**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-06-02T04:25:00Z
- **Completed:** 2026-06-02T05:10:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- `@omnisync/types` builds to ESM dist with EventSource enum and InboundEvent Zod 4 schema
- `@omnisync/db` schema has `events` (with `events_fingerprint_unique`), `dlq_events`, `EventStatus` enum; no routing_rules
- Migration `20260602045208_init` applied; `psql \d events` confirms `"events_fingerprint_unique" UNIQUE, btree (fingerprint)` — Success Criterion #3 met
- PrismaClient singleton exported from `@omnisync/db` with PrismaPg adapter (Prisma 7 driver pattern)
- Both packages build cleanly with TypeScript strict mode

## Task Commits

1. **Task 1: @omnisync/types** - `23529c0` (feat)
2. **Task 2: @omnisync/db Prisma 7 schema** - `85562d3` (feat)
3. **Task 3: @omnisync/db client singleton + build** - `3c497c5` (feat)

## Files Created/Modified

- `packages/types/src/event.ts` — EventSource enum + InboundEvent Zod 4 schema + inferred type
- `packages/types/src/index.ts` — re-exports via "./event.js" (NodeNext ESM extension required)
- `packages/types/package.json` — ESM package, zod@4 dep, tsc build
- `packages/types/tsconfig.json` — extends base, outDir=dist, rootDir=src
- `packages/db/prisma/schema.prisma` — Event + DeadLetterEvent models + EventStatus enum, no url in datasource
- `packages/db/prisma.config.ts` — Prisma 7 defineConfig with DATABASE_URL from env
- `packages/db/prisma/migrations/20260602045208_init/migration.sql` — initial schema migration
- `packages/db/src/index.ts` — PrismaClient singleton with PrismaPg adapter + globalThis guard
- `packages/db/package.json` — @prisma/adapter-pg, pg, dotenv deps; dist/src/ exports
- `packages/db/tsconfig.json` — rootDir=., include=[src, generated] for Prisma 7 TS output

## Decisions Made

- **Prisma 7 config pattern**: Prisma 7.8.0 removed `url` from datasource in schema.prisma — must use `prisma.config.ts` with `defineConfig({ datasource: { url } })`. This is the authoritative pattern going forward.
- **Generator name**: `"prisma-client"` (not `"prisma-client-js"`); output directory `"../generated/prisma"` (Prisma 7 generates TypeScript directly, not compiled JS)
- **Driver adapter**: PrismaClient constructor now requires `adapter: PrismaPg` — there is no fallback env-based connection. All PrismaClient instantiations must pass the adapter.
- **tsconfig rootDir**: Changed from `src` to `.` with `include: ["src", "generated"]` to allow TypeScript to compile generated Prisma files alongside source.
- **Two-URL split**: Deferred — Prisma 7's `defineConfig.datasource` only has a `url` field (no `directUrl`). The split is a Neon-specific concern for Phase 6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma 7.8.0 broke datasource url in schema.prisma**
- **Found during:** Task 2
- **Issue:** Prisma 7.8.0 no longer accepts `url = env("DATABASE_URL")` in schema.prisma datasource. Error: `The datasource property url is no longer supported in schema files.`
- **Fix:** Created `prisma.config.ts` using `defineConfig` from `prisma/config` with `datasource: { url: process.env.DATABASE_URL }`. Removed url from schema.prisma datasource.
- **Files modified:** packages/db/prisma/schema.prisma, packages/db/prisma.config.ts (new)
- **Verification:** `prisma validate` passes, migration runs successfully
- **Committed in:** 85562d3

**2. [Rule 2 - Missing Critical] Prisma 7 PrismaClient requires driver adapter**
- **Found during:** Task 3
- **Issue:** Prisma 7 PrismaClient constructor requires either `adapter` or `accelerateUrl` — no implicit env-based connection. The research assumed the old pattern would work.
- **Fix:** Added `@prisma/adapter-pg` and `pg` deps. Created PrismaPg adapter instance in src/index.ts and passed to PrismaClient constructor.
- **Files modified:** packages/db/package.json, packages/db/src/index.ts
- **Verification:** `node --input-type=module -e "import('./packages/db/dist/src/index.js')"` resolves prisma export
- **Committed in:** 3c497c5

**3. [Rule 2 - Missing Critical] omnisync user missing CREATEDB privilege for shadow DB**
- **Found during:** Task 2 migration
- **Issue:** `prisma migrate dev` needs CREATEDB to create shadow database for diff. Error: `permission denied to create database`
- **Fix:** `ALTER USER omnisync CREATEDB` via postgres superuser.
- **Files modified:** None (DB user configuration)
- **Committed in:** N/A (DB-level config)

**4. [Rule 1 - Bug] packages/db tsconfig rootDir too restrictive**
- **Found during:** Task 3
- **Issue:** `rootDir: src` caused TS error because generated prisma files are in `../generated/prisma/`, outside src/
- **Fix:** Changed tsconfig to `rootDir: "."` and `include: ["src", "generated"]`
- **Files modified:** packages/db/tsconfig.json
- **Committed in:** 3c497c5

---

**Total deviations:** 4 auto-fixed (2 Rule 1 bugs, 2 Rule 2 missing critical)
**Impact on plan:** All deviations were Prisma 7 breaking changes not reflected in research. The prisma.config.ts + driver adapter pattern is now the established pattern for all future phases.

## Verification Results

```
pnpm --filter @omnisync/types build  → exit 0
pnpm --filter @omnisync/db build     → exit 0
prisma migrate deploy                → No pending migrations
psql \d events                       → "events_fingerprint_unique" UNIQUE, btree (fingerprint)
node import test                     → ok - prisma export found
```

## Self-Check: PASSED

- packages/types/src/event.ts: FOUND
- packages/types/src/index.ts: FOUND
- packages/db/prisma/schema.prisma: FOUND
- packages/db/prisma.config.ts: FOUND
- packages/db/src/index.ts: FOUND
- packages/db/prisma/migrations/20260602045208_init/migration.sql: FOUND
- Commit 23529c0: FOUND
- Commit 85562d3: FOUND
- Commit 3c497c5: FOUND

*Phase: 01-foundation-local-infra*
*Plan: 02*
*Completed: 2026-06-02*
