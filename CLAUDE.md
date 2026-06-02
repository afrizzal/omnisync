<!-- GSD:project-start source:PROJECT.md -->
## Project

**OmniSync**

OmniSync is a **distributed, event-driven Customer Data Platform (CDP)** that ingests high-volume webhook events from multiple sales & marketing channels (e-commerce marketplaces, ad platforms, CRM) asynchronously, then normalizes, deduplicates, and routes them to a central store — with strong delivery guarantees even when downstream systems fail.

It is built as a **portfolio project** to prove production-grade distributed-systems engineering: decoupled ingestion, background worker queues, idempotency, automated resilience patterns (retry/backoff, circuit breaker, Dead-Letter Queue), observability, and a rigorous automated test suite. The target audience is technical recruiters and senior/lead engineers evaluating the author for **Senior Backend / Distributed Systems / Lead Full-Stack** roles.

**Core Value:** **No accepted event is ever silently lost.** Once OmniSync acknowledges a webhook (HTTP 202), that event is durably queued and processed *at-least-once and idempotently* — surviving worker crashes, database outages, and flaky downstream APIs, with a Dead-Letter Queue as the final safety net and a one-click path back to reprocessing.

If everything else is stripped away, this guarantee — and the ability to *demonstrate* it live under simulated failure — is what must work.

### Constraints

- **Tech stack**: Node.js v20+ / TypeScript v5, Fastify (ingestion API), Redis v7 + BullMQ (queue), PostgreSQL v15+ + Prisma (store), Zod (validation), Vitest + Playwright (tests), Next.js (dashboard), Docker — chosen for a high-throughput, in-demand distributed-systems stack that maps to target roles.
- **Budget**: Near-zero / free-tier only during the job-hunt period — every infra choice must fit free tiers.
- **Quality bar**: ≥80% test coverage and green CI on every push — the testing rigor is itself a portfolio deliverable.
- **Purpose**: This is a *showcase* of resilience and distributed design; when tradeoffs arise, favor demonstrable reliability and a clean, explainable architecture over feature breadth.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS | Runtime | v22 is current LTS (released April 2024, Active LTS Oct 2024). Fastify v5 requires v20+; v22 gives longer runway and better performance. Use v22 in Docker, lock via `.nvmrc`. |
| TypeScript | 5.x (≥5.1) | Type safety | Required by Prisma v7 (min 5.1). v5 strict mode catches distributed-systems bugs (nullability, discriminated unions) at compile time rather than runtime. |
| Fastify | 5.8.x | HTTP ingestion API | v5 (current stable) is 5-10% faster than v4, drops Node.js <20, ships with full TypeScript types. The deliberate choice over Express for low-overhead, high-throughput webhook ingestion — explicitly defensible in senior interviews. |
| BullMQ | 5.77.x | Distributed job queue | Current stable. Uses Redis Streams/Sorted Sets for durable queues. Native TypeScript, active development (weekly releases). The standard for Node.js durable background jobs with at-least-once delivery, retries, DLQ, and rate limiting built in. |
| ioredis | 5.8.x | Redis client (for BullMQ) | BullMQ's required Redis client. Full TypeScript declarations built in (no `@types/ioredis` needed in v5+). Supports TLS for Upstash. |
| PostgreSQL | 15+ | Event store | Rock-solid, widely-deployed, required for idempotency key storage, DLQ records, and normalized event tables. |
| Prisma ORM | 7.7.x | Database ORM + migrations | v7 ships Rust-free (smaller binary, faster cold start), stable ESM, TypeScript-native. Use with `directUrl` for migrations and pooler URL for runtime. |
| Zod | 4.x (≥4.4) | Schema validation | v4 is 14× faster than v3 with 57% smaller bundle. Ships as `zod/v4` subpath alongside v3 — can migrate incrementally. Native `.toJSONSchema()` eliminates extra conversion libraries. |
| Next.js | 15.x (or 16.x) | Dashboard UI | v15 stable with React 19, Turbopack, App Router. The candidate already knows Next.js well; it shows full-stack capability without diluting backend focus. |
| Docker | 25+ | Local dev + CI | Multi-stage Dockerfile for ingestion API, worker, and dashboard. `docker-compose` for local Redis + Postgres. Required for reproducible CI and deployment. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cockatiel` | latest | Circuit breaker + retry policies | Use over `opossum` for this project: TypeScript-first, composable policy API (layer Retry + CircuitBreaker + Timeout declaratively). Ideal for the mock-CRM downstream sync guard. |
| `pino` | built into Fastify | Structured JSON logging | Fastify's native logger. Zero additional setup. Use `pino-pretty` in development only — never in production containers. |
| `@fastify/sensible` | latest | HTTP error helpers | Adds `reply.badRequest()`, `reply.notFound()` etc. Standard Fastify plugin for clean error responses. |
| `@fastify/helmet` | latest | Security headers | One-line hardening for the HTTP API. Required even on a portfolio project to demonstrate security hygiene. |
| `crypto` (Node built-in) | — | Idempotency fingerprinting | SHA-256 HMAC of webhook payload for deduplication key. No extra dependency. |
| `dotenv` / `@t3-oss/env-core` | latest | Environment variable validation | Validate all env vars at startup with Zod schemas — fail fast on misconfiguration rather than at runtime. |
| `vitest` | 4.x | Unit + integration tests | Current stable (surpassed v3 in 2025, now at v4.1.x). Vite-native, ESM-first, fast. Use for unit tests (validators, transformers, fingerprint logic) and integration tests (worker + DB). |
| `@vitest/coverage-v8` | same as vitest | Code coverage | V8-native coverage. Target ≥80% line coverage as per project constraint. |
| `@playwright/test` | 1.57.x | E2E dashboard tests | Microsoft-maintained, cross-browser. Use for dashboard smoke tests: DLQ list renders, re-queue button works, live metrics update. |
| `testcontainers` | latest | Integration test infrastructure | Spins up real Postgres + Redis containers in tests. Enables the "kill Postgres mid-process" integration test that proves queue durability. Critical for the portfolio's testing story. |
| `bull-board` | latest | Dev-time queue UI | `@bull-board/fastify` adapter mounts a job browser on the Fastify app. Useful for live-demo visualization alongside Next.js dashboard. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | TypeScript execution for scripts/dev | Faster than `ts-node`. Use for local dev runner and one-off scripts. |
| `eslint` + `@typescript-eslint` | Linting | ESLint v9 flat config. Catches distributed-systems antipatterns (unhandled promises, missing await). |
| `prettier` | Formatting | Standard. Integrate with pre-commit via `lint-staged`. |
| `husky` | Pre-commit hooks | Run type-check + lint before every commit. Keeps CI green. |
| GitHub Actions | CI/CD | Type-check → lint → test → Docker build on every push. Free for public repos. |
## Hosting: Resolved Recommendation
### The Three-Service Breakdown
| Service | What It Is | Hosting Recommendation | Cost |
|---------|-----------|------------------------|------|
| Fastify Ingestion API | Stateless HTTP, handles webhook bursts | Render Free Web Service | $0 |
| BullMQ Worker | Always-on, long-running Node.js process | Render Free Web Service (separate service) | $0 |
| Redis | BullMQ backing store | Self-hosted on the worker service OR Upstash (with caveats — see below) | $0 |
| PostgreSQL | Event store | Neon Free Tier | $0 |
### Prescriptive Recommendation: Render (Free) + Neon (Free) + Upstash (Free, with config)
| Platform | Verdict | Reason |
|----------|---------|--------|
| **GCP Cloud Run** | DO NOT USE for worker | Scales to zero after inactivity. A BullMQ worker that sleeps means queued jobs pile up unprocessed and the "always-on guarantee" narrative collapses. Even with `min-instances=1`, the free monthly allowance (180,000 vCPU-seconds) runs out quickly for an always-on instance. |
| **Railway** | Paid only, not free | Railway has no permanent free tier since 2023. The Hobby plan is $5/month base + usage. A Node.js API + worker + Postgres on Railway realistically costs $6-$12/month. Not zero-cost. |
| **Fly.io** | Paid only after trial | No permanent free tier. Requires credit card. Trial is 2 CPU-hours or 7 days. Cheapest always-on machine is ~$2/month per service — adds up fast with 2-3 services. |
| **Render** | RECOMMENDED | 750 free instance-hours per workspace per month. 720 hours = one full month. A single free service running 24/7 fits within 750 hours. **Critical: deploy API and worker as two separate free web services** — each gets its own 750-hour budget within the workspace. Spin-down after 15 minutes of inactivity is a real limitation for the API, but the **worker must be kept alive via a self-ping or UptimeRobot** (free, 5-minute intervals). |
## Redis: Free-Tier Viability vs BullMQ
### Upstash Free Tier Reality Check
- Stalled job checks (`stalledInterval`, default 30s)
- Delayed job scheduler checks (`guardInterval`, default 5s)
- Drain delay heartbeat when queue is empty (`drainDelay`, default 5s)
## PostgreSQL: Neon vs Supabase
| Criterion | Neon | Supabase | Winner |
|-----------|------|----------|--------|
| Storage | 0.5 GB | 500 MB | Tie |
| Connection pooling | PgBouncer built-in, 10,000 pooled connections | PgBouncer built-in, 200 direct connection ceiling | Neon |
| Auto-suspend | 5 min inactivity (cannot disable on free tier) | 1 week inactivity pause | Neon (shorter resume cycle) |
| Cold start penalty | 1.8s median, 3.1s worst case | Similar on free tier | Tie |
| Prisma compatibility | Official Prisma docs + driver adapter | Official Prisma docs | Tie |
| Prisma migration support | Use `directUrl` for migrate, pooler URL for runtime | Same pattern | Tie |
| Extra features in free | Branching (useful for test isolation) | Auth, Storage, Edge Functions | Neon (branching useful for CI) |
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| BullMQ | Kafka/Redpanda | Only if you need true multi-consumer fan-out, replay from offset, or >10k events/sec — not a portfolio constraint, explicitly out of scope |
| BullMQ | `pg-boss` (Postgres-backed queue) | If you want to eliminate Redis entirely and use Postgres as the queue — simpler infra, but loses the Redis performance story and BullMQ's richer resilience API |
| Fastify | Express | Only if team familiarity with Express outweighs performance — for a portfolio demonstrating deliberate choices, Fastify is the better answer |
| Zod v4 | Valibot | Valibot is smaller but ecosystem support (Fastify, Prisma, tRPC integrations) lags Zod. Zod v4's 14× perf gain eliminates the main reason to switch |
| Prisma v7 | Drizzle ORM | Drizzle has better raw-SQL control and smaller bundle. Choose Drizzle if you want to show SQL fluency over ORM abstraction. Prisma is better here because v7's type-safety + migration story is the portfolio-safe default |
| cockatiel | opossum | opossum is the older standard and still valid. cockatiel is TypeScript-first and more composable. For a TypeScript-native project, cockatiel reads more cleanly |
| Neon | Supabase | Supabase is better if you also need Auth, Storage, or Realtime subscriptions in a future phase |
| Render | Fly.io | Fly.io is better for multi-region edge deployment and Docker-native workflows — but requires a credit card and has no free tier |
| Vitest | Jest | Jest has no native ESM support and requires Babel transform. Vitest is the 2025 standard for Node.js ESM + TypeScript projects |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| GCP Cloud Run for the BullMQ worker | Scale-to-zero breaks the always-on worker guarantee. Even min-instances=1 consumes free quota faster than a portfolio budget allows | Render Free Web Service + UptimeRobot ping |
| Upstash Redis at default BullMQ settings | Idle polling exceeds 500k/month free tier (~720k commands/month at defaults) | Upstash + tuned `stalledInterval`, `guardInterval`, `drainDelay` — or in-container Redis as fallback |
| Supabase for this project | Auto-pause after 1 week of inactivity is a live-demo killer. The 200-connection ceiling is lower than Neon's pooled 10,000 | Neon Free Tier |
| Railway for zero-cost deployment | No permanent free tier. $5/month minimum even before usage charges. Costs accumulate with 2 services + DB | Render Free |
| Fly.io for zero-cost deployment | No free tier. Requires credit card. Trial lasts 2 CPU-hours or 7 days | Render Free |
| `bull` (legacy) | The original Bull library is in maintenance mode. BullMQ is its spiritual successor with better TypeScript support and Redis Streams | BullMQ |
| Express.js for the ingestion API | Lower throughput, more boilerplate, weaker TypeScript inference. Misses the opportunity to explain the Fastify choice in interviews | Fastify v5 |
| `ts-node` in production or Docker | Slow startup, not suitable for production containers | Compile with `tsc` or `esbuild`, run plain Node.js |
| Zod v3 for new code | v4 is 14× faster and the ecosystem has moved. Use v4 subpath import (`zod/v4`) for new schemas | Zod v4 |
| Prisma v6 for new greenfield work | v7 removes the Rust binary engine (faster cold starts, smaller Docker images), is ESM-native, and is the active development line | Prisma v7 |
## Stack Patterns by Variant
- Validate webhook signature (HMAC-SHA256) before any processing
- Generate idempotency key (SHA-256 of channel + payload hash) in the handler
- Enqueue with BullMQ `Queue.add()`, set `jobId` to the idempotency key (BullMQ deduplicates by jobId)
- Return HTTP 202 immediately after successful enqueue
- All validation via Zod schemas typed against Fastify's `TypeBoxTypeProvider` or `ZodTypeProvider`
- One worker process, configurable concurrency (`concurrency: 5` is a safe default)
- Use `Worker` from BullMQ with `autorun: true`
- Wrap downstream calls (mock CRM sync) with `cockatiel` circuit breaker
- On exhausted retries, BullMQ moves job to the failed set — expose this as the DLQ
- Keep `/healthz` endpoint alive (UptimeRobot target)
- `docker-compose` with `redis:7-alpine` and `postgres:15-alpine` as services
- `tsx watch src/worker.ts` for hot-reload during development
- Upstash is only for deployed preview; local always uses containerized Redis
- `services:` block with Redis and Postgres containers for integration tests
- `testcontainers` as alternative if you want DB lifecycle in test code
- Run `vitest run --coverage`, fail if coverage < 80%
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `bullmq@5.x` | `ioredis@5.x` | BullMQ 5 requires ioredis 5. Do not mix with ioredis 4. |
| `prisma@7.x` | `typescript@>=5.1`, `node@>=18.18` | v7 is ESM-native. If using CommonJS project layout, need `"type": "module"` or `.mts` extensions |
| `fastify@5.x` | `node@>=20` | v5 dropped Node.js 18 support. Pin to v5 on Node.js 22. |
| `zod@4.x` | `typescript@>=5.x` | Import from `zod/v4` subpath. Existing v3 imports continue to work from `zod` root during migration |
| `vitest@4.x` | `vite@>=5` | Vitest v4 requires Vite 5+. Does not require Vite in non-browser tests, but version alignment matters if using `@vitest/browser` |
| `next@15.x` / `next@16.x` | `react@19`, `node@>=18.18` | Both versions are stable. Use 15.x if you want the widest ecosystem compatibility; 16.x for latest features |
## Hosting Architecture Summary
## Sources
- [BullMQ npm](https://www.npmjs.com/package/bullmq) — current version 5.77.6 (verified)
- [Upstash Redis new pricing blog](https://upstash.com/blog/redis-new-pricing) — 500k commands/month free tier (March 2025)
- [Upstash BullMQ integration docs](https://upstash.com/docs/redis/integrations/bullmq) — explicit idle-polling warning
- [Fastify v5 release](https://openjsf.org/blog/fastifys-growth-and-success) — stable, Node.js 20+ only
- [Fastify npm](https://www.npmjs.com/package/fastify) — v5.8.5 current
- [Prisma ORM 7.0 announcement](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) — Rust-free, ESM-native (November 2025)
- [Prisma v7 upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) — migration steps
- [Prisma + Neon official docs](https://www.prisma.io/docs/orm/v6/overview/databases/neon) — pooler + directUrl pattern
- [Neon free tier plans](https://neon.com/docs/introduction/plans) — 100 CU-hours, auto-suspend 5 min, cannot disable free
- [Neon connection pooling docs](https://neon.com/docs/connect/connection-pooling) — PgBouncer transaction mode, prepared statement caveat
- [Zod v4 release](https://zod.dev/v4) — v4.4.3, 14× faster, `zod/v4` subpath
- [Vitest releases](https://github.com/vitest-dev/vitest/releases) — v4.1.7 current stable
- [Render free tier docs](https://render.com/docs/free) — 750 instance-hours/month, spin-down after 15 min
- [Render background workers docs](https://render.com/docs/background-workers) — background worker type is paid only (confirmed)
- [Railway pricing](https://docs.railway.com/pricing) — no permanent free tier, $5/month minimum
- [Fly.io pricing](https://fly.io/pricing/) — no permanent free tier, credit card required
- [GCP Cloud Run pricing](https://cloud.google.com/run/pricing) — free quota insufficient for always-on worker
- [BullMQ v5 queue markers](https://bullmq.io/news/231204/better-queue-markers/) — reduced Redis chatter in v5
- [cockatiel npm](https://www.npmjs.com/package/cockatiel) — TypeScript-first resilience library
- [ioredis npm](https://www.npmjs.com/package/ioredis) — v5.8.2 current, built-in TypeScript types
- [Next.js 15 blog](https://nextjs.org/blog/next-15) — React 19, Turbopack stable
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
