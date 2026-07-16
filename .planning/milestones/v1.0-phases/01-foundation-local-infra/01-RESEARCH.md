# Phase 1: Foundation & Local Infra - Research

**Researched:** 2026-06-02
**Author:** inline (Opus, main session) — sub-agent spawn declined by user
**Confidence:** HIGH (patterns), MEDIUM (exact Prisma 7 / Biome 2 config syntax — flagged below, verify against installed version)

> Concrete, planner-ready implementation patterns for the decisions locked in `01-CONTEXT.md`.
> Versions follow `.planning/research/STACK.md`. Where a config syntax is version-sensitive and I could not pin it to certainty, it is flagged **⚠ VERIFY** — the executor must confirm against the installed package's docs (`npx prisma -v`, `npx @biomejs/biome --version`).

---

## 0. Build order within the phase

Strict internal dependency order (drives waves):

1. **Repo skeleton + tooling** (pnpm workspaces, Turborepo, base tsconfig, Biome, ESM root) — everything imports this.
2. **Shared packages** (`packages/types` → `packages/db`) + shared **env loader** + **BullMQ queue module** — apps import these.
3. **App stubs** (`api`, `worker`, `dashboard`) + **docker-compose** + **Dockerfiles** + **CI**.

`packages/types` has no internal deps. `packages/db` depends on `types`. Apps depend on both. Dockerfiles/compose depend on app stubs existing.

---

## 1. pnpm workspaces + Turborepo (ESM TS monorepo)

**`pnpm-workspace.yaml`** (repo root):
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Root `package.json`** — ESM, private, scripts delegate to Turborepo:
```jsonc
{
  "name": "omnisync",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.x",        // ⚠ VERIFY current pnpm 9 patch
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "dev": "turbo run dev",
    "db:migrate": "pnpm --filter @omnisync/db migrate",
    "db:generate": "pnpm --filter @omnisync/db generate"
  },
  "devDependencies": {
    "turbo": "^2.x",                    // ⚠ VERIFY Turborepo 2 latest
    "@biomejs/biome": "^2.x",           // ⚠ VERIFY Biome 2 latest
    "typescript": "^5.x"
  }
}
```

**`turbo.json`** — pipeline with caching; `^build` means "build deps first":
```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "generated/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```
> Note: in Turborepo 2 the key is `tasks` (was `pipeline` in v1). ⚠ VERIFY.

**Shared base TS config** — `packages/tsconfig/base.json` (or a `tsconfig.base.json` at root):
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  }
}
```
Each package/app `tsconfig.json` does `{"extends": "../../tsconfig.base.json", "compilerOptions": {"outDir": "dist", "rootDir": "src"}, "include": ["src"]}`. Next.js app uses its own `module: esnext, moduleResolution: bundler, jsx: preserve, noEmit: true` extending the base where compatible.

**Workspace dependency wiring:** apps/packages reference each other with `"@omnisync/types": "workspace:*"`. pnpm symlinks them. Build order is enforced by Turborepo `^build`.

**Gotcha (ESM):** with `"type":"module"` + `NodeNext`, relative imports in compiled output need explicit `.js` extensions in source TS (e.g. `import { x } from "./env.js"`). `verbatimModuleSyntax` + `NodeNext` enforce this. Document it so the executor writes extensions from the start.

---

## 2. Prisma 7 (ESM) — `packages/db` = `@omnisync/db`

Per STACK.md: Prisma 7 is ESM-native / Rust-free and benefits from `"type":"module"`.

**`packages/db/prisma/schema.prisma`:**
```prisma
generator client {
  provider = "prisma-client"            // ⚠ VERIFY: Prisma 7 ESM generator. v6/v7 introduce the
  output   = "../generated/client"      //   `prisma-client` (ESM, explicit output) generator vs the
}                                        //   legacy `prisma-client-js`. Confirm name+output for installed v7.

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // pooled (runtime)
  directUrl = env("DIRECT_URL")          // direct (migrations) — Neon pattern, set now
}

enum EventStatus {
  RECEIVED
  PROCESSING
  COMPLETED
  FAILED
  DLQ
}

model Event {
  id             String      @id @default(uuid())
  fingerprint    String
  source         String                       // e.g. "SHOPEE","TOKOPEDIA","META_ADS"
  eventType      String
  payload        Json
  status         EventStatus @default(RECEIVED)
  retryCount     Int         @default(0)
  errorMessage   String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  dlq            DeadLetterEvent?

  @@map("events")
  @@unique([fingerprint], map: "events_fingerprint_unique")   // named constraint (success criterion #3)
  @@index([status])
  @@index([source])
  @@index([createdAt])
}

model DeadLetterEvent {
  id            String   @id @default(uuid())
  eventId       String   @unique
  event         Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  failureReason String
  attempts      Int      @default(0)
  payload       Json
  resolved      Boolean  @default(false)
  frozenAt      DateTime @default(now())

  @@map("dlq_events")
  @@index([resolved])
}
```
- The `map: "events_fingerprint_unique"` makes `psql \d events` show `CONSTRAINT events_fingerprint_unique UNIQUE (fingerprint)` — exactly success criterion #3.
- `routing_rules` is intentionally absent (Phase 4).

**`packages/db/package.json`:**
```jsonc
{
  "name": "@omnisync/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "build": "prisma generate && tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@prisma/client": "^7.x", "@omnisync/types": "workspace:*" },
  "devDependencies": { "prisma": "^7.x" }
}
```

**`packages/db/src/index.ts`** — single shared PrismaClient singleton, re-export enums/types:
```ts
import { PrismaClient } from "../generated/client/index.js"; // ⚠ VERIFY generated path
export * from "../generated/client/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```
Singleton prevents connection-pool exhaustion under Next.js dev HMR + multiple workers (PITFALLS).

**Migration command (Phase 1 acceptance):** `pnpm --filter @omnisync/db exec prisma migrate dev --name init`. Requires `DATABASE_URL` + `DIRECT_URL` set; both point at the docker Postgres locally.

---

## 3. `packages/types` = `@omnisync/types` (Zod 4)

Per STACK.md, Zod 4 imported via `zod/v4` subpath. Holds shared schemas + inferred types so db and apps share one source of truth.

```ts
// packages/types/src/event.ts
import { z } from "zod/v4";              // ⚠ VERIFY zod v4 import subpath for installed version

export const EventSource = z.enum(["SHOPEE", "TOKOPEDIA", "META_ADS", "CRM"]);
export const InboundEvent = z.object({
  source: EventSource,
  eventType: z.string().min(1),
  externalId: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type InboundEvent = z.infer<typeof InboundEvent>;
```
`package.json` mirrors db's ESM `exports`/`build`(`tsc`)/`typecheck`. **No dependency on `@omnisync/db`** (db depends on types, not vice-versa) — prevents the circular dep called out in success criterion #4.

---

## 4. BullMQ 5.77 queue connection module (QUE-01, connection-only)

This phase establishes the queue + locked config; producers/consumers come later.

```ts
// packages/db or a packages/queue — Claude's discretion (CONTEXT D-13 note). Recommend packages/queue.
import { Queue } from "bullmq";          // ^5.77
import IORedis from "ioredis";

export const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,            // REQUIRED by BullMQ workers
});

// Locked config from CONTEXT D-10 (free-tier Upstash command-quota viability)
export const QUEUE_NAME = "events";
export const queueOptions = {
  // worker-side options surfaced here as shared constants:
  guardInterval: 30_000,
  stalledInterval: 300_000,
  drainDelay: 30,
} as const;

export const eventsQueue = new Queue(QUEUE_NAME, { connection });
```
- `maxRetriesPerRequest: null` is mandatory for BullMQ (it throws otherwise). 
- The interval constants are consumed by `Worker` in Phase 3; defining them here locks them before integration-test timing forms (PITFALLS/SUMMARY guidance).

---

## 5. Zod-validated env loader + `.env.example`

Shared, fail-fast. Recommend a small `packages/config` (or co-locate in `packages/types`) — must be shared, not per-app (CONTEXT D-13).

```ts
// packages/config/src/env.ts
import { z } from "zod/v4";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export const env = (() => {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment:", z.treeifyError(parsed.error)); // ⚠ VERIFY zod4 error API
    process.exit(1);                     // fail fast at startup
  }
  return parsed.data;
})();
```

**`.env.example`** (committed):
```
NODE_ENV=development
# Local docker Postgres — pooled + direct both point here in dev
DATABASE_URL=postgresql://omnisync:omnisync@localhost:5432/omnisync?schema=public
DIRECT_URL=postgresql://omnisync:omnisync@localhost:5432/omnisync?schema=public
REDIS_URL=redis://localhost:6379
```

---

## 6. docker-compose (Postgres 16 + Redis 7 noeviction) + startup assertion

**`docker-compose.yml`:**
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: omnisync
      POSTGRES_PASSWORD: omnisync
      POSTGRES_DB: omnisync
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U omnisync"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7
    command: ["redis-server", "--maxmemory-policy", "noeviction"]
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

**noeviction startup assertion** (success criterion #1) — a script the worker/api run on boot OR a standalone check used by CI/compose:
```ts
// asserts Redis is configured noeviction; exits non-zero otherwise
import IORedis from "ioredis";
const r = new IORedis(process.env.REDIS_URL!);
const [, policy] = await r.config("GET", "maxmemory-policy");
if (policy !== "noeviction") {
  console.error(`FATAL: Redis maxmemory-policy is "${policy}", expected "noeviction"`);
  process.exit(1);
}
await r.quit();
```
Wire this as a `pnpm assert:redis` script and call it from app boot and/or a compose `depends_on` helper.

---

## 7. Biome config (`biome.json`)

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",  // ⚠ VERIFY installed Biome 2 schema ver
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignore": ["**/dist", "**/.next", "**/generated"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double" } }
}
```
Run via `biome check .` (lint+format check) in CI; `biome check --write .` to fix. Turborepo `lint` task wraps it.

---

## 8. Multi-stage Dockerfiles (api, worker) + compose wiring (OPS-02)

Use Turborepo prune for small images. **`apps/api/Dockerfile`** (worker analogous, swap filter):
```dockerfile
# 1) prune workspace to just what api needs
FROM node:22-slim AS prune
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @omnisync/api --docker   # ⚠ VERIFY turbo prune flags for v2

# 2) install + build
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm --filter @omnisync/api build

# 3) runtime
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app .
CMD ["node", "apps/api/dist/index.js"]
```
**Compose wiring (local, OPS-02)** — add to `docker-compose.yml`:
```yaml
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    ports: ["3001:3001"]
  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    env_file: .env
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
```
For Phase 1 the api/worker `index.ts` may just import shared packages, run the redis assertion, log "ready", and stay alive (worker) / start a bare server (api). No business logic.

---

## 9. Next.js dashboard stub (`apps/dashboard`)

Bare App Router app that builds in the monorepo and can import `@omnisync/types`:
- `apps/dashboard/package.json`: `next@^15`/`react@^19` (⚠ VERIFY current), `"@omnisync/types": "workspace:*"`, scripts `build: next build`, `dev: next dev`, `typecheck: tsc --noEmit`.
- `app/page.tsx` renders a placeholder; optionally import a type from `@omnisync/types` to prove cross-package resolution at build time.
- `next.config.js`: `transpilePackages: ["@omnisync/types"]` so Next compiles the workspace TS package.
- Turborepo `build` output includes `.next/**` (already in turbo.json).

---

## 10. GitHub Actions CI skeleton (`.github/workflows/ci.yml`)

```yaml
name: CI
on: { push: {}, pull_request: {} }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # reads packageManager from package.json
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @omnisync/db generate   # prisma client needed for typecheck
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm lint                              # biome check
```
Strict ≥80% coverage gate is deferred to Phase 6 (no test job yet). CI must be green on push (success criterion #5).

---

## Validation Architecture

Nyquist mapping — each Phase 1 success criterion + requirement → an automatable check the executor/verifier can run. (Source for `01-VALIDATION.md`.)

| # | Criterion / Req | Validation (automatable) | Type |
|---|------------------|---------------------------|------|
| SC1 | docker compose up → Redis noeviction | `docker compose up -d` then the assert script: `redis-cli -u $REDIS_URL config get maxmemory-policy` returns `noeviction` (assert script exits 0); wrong policy exits 1 | Integration / script |
| SC2 | `pnpm -r build` compiles all | CI step `pnpm build` (turbo) exits 0 with no TS errors across all packages+apps | Build |
| SC3 | Prisma migrate + unique constraint | `prisma migrate dev` exits 0; `psql -c "\d events"` output contains `events_fingerprint_unique` and `UNIQUE`; or query `pg_indexes`/`information_schema.table_constraints` for the constraint name | DB assertion |
| SC4 | Shared packages importable, no cycles | An app build that imports `@omnisync/db` + `@omnisync/types` succeeds; `madge --circular` (or turbo graph) reports no cycles between packages | Build / static |
| SC5 | CI green type-check on push | GitHub Actions `verify` job concludes success; `gh run list` shows latest run `success` | CI |
| QUE-01 | BullMQ queue connection established | A script importing the queue module connects to Redis and instantiates `Queue("events")` without throwing; `eventsQueue.name === "events"` and config constants equal 30000/300000/30 | Unit/integration |
| OPS-02 | api+worker Docker via compose | `docker compose build api worker` exits 0; `docker compose up` brings both to a "ready" log line and they stay up (worker) / serve (api) | Integration |

Each is a concrete command/grep — no subjective criteria. The planner should turn SC1/SC3/QUE-01/OPS-02 into explicit acceptance-criteria commands inside tasks.

---

## Open questions / flags for the executor

1. **Prisma 7 generator name + generated client import path** (`prisma-client` vs `prisma-client-js`, `output`) — ⚠ verify against the installed Prisma 7. This affects `packages/db/src/index.ts` import path. Run `npx prisma -v` and check `prisma generate` output dir.
2. **Zod 4 import subpath** (`zod/v4` vs `zod`) and error-formatting API (`z.treeifyError` vs `error.format()`) — ⚠ verify against installed Zod 4.
3. **Biome 2 schema URL / config keys** (`files.ignore` vs `files.includes`) — ⚠ verify against installed Biome 2.
4. **Turborepo 2** `tasks` key and `turbo prune --docker` flags — ⚠ verify against installed Turbo 2.
5. **Env loader placement** — `packages/config` (recommended) vs inside `packages/types`. Either is fine; must be shared.
6. Local dev uses docker Postgres for BOTH `DATABASE_URL` and `DIRECT_URL`; the split only matters in Phase 6 (Neon). Keep both vars present now so nothing changes later.

## Sources
- Project research (already verified 2026): `.planning/research/STACK.md` (versions, BullMQ tuning, Neon directUrl), `ARCHITECTURE.md` (schema, topology, fingerprint), `PITFALLS.md` (noeviction, ESM trap, two-URL, singleton), `SUMMARY.md`.
- Standard current patterns for pnpm+Turborepo ESM monorepos, Prisma two-URL, BullMQ connection, Biome, GitHub Actions. Version-sensitive syntax flagged ⚠ VERIFY for executor confirmation.

---
*Phase: 01-foundation-local-infra*
*Research completed: 2026-06-02*
