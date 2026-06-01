# Stack Research

**Domain:** Distributed event-driven webhook-ingestion + background-worker system (Node.js/TypeScript)
**Researched:** 2026-06-01
**Confidence:** MEDIUM-HIGH (versions verified via current npm/official sources; hosting costs from 2025-2026 provider pages)

---

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

---

## Hosting: Resolved Recommendation

This is the central tension for OmniSync. The key constraint: **the BullMQ worker must run continuously** — it cannot scale-to-zero without losing the "always listening" guarantee.

### The Three-Service Breakdown

| Service | What It Is | Hosting Recommendation | Cost |
|---------|-----------|------------------------|------|
| Fastify Ingestion API | Stateless HTTP, handles webhook bursts | Render Free Web Service | $0 |
| BullMQ Worker | Always-on, long-running Node.js process | Render Free Web Service (separate service) | $0 |
| Redis | BullMQ backing store | Self-hosted on the worker service OR Upstash (with caveats — see below) | $0 |
| PostgreSQL | Event store | Neon Free Tier | $0 |

### Prescriptive Recommendation: Render (Free) + Neon (Free) + Upstash (Free, with config)

**Render is the correct choice for both the API and the worker.** Here is why each alternative fails:

| Platform | Verdict | Reason |
|----------|---------|--------|
| **GCP Cloud Run** | DO NOT USE for worker | Scales to zero after inactivity. A BullMQ worker that sleeps means queued jobs pile up unprocessed and the "always-on guarantee" narrative collapses. Even with `min-instances=1`, the free monthly allowance (180,000 vCPU-seconds) runs out quickly for an always-on instance. |
| **Railway** | Paid only, not free | Railway has no permanent free tier since 2023. The Hobby plan is $5/month base + usage. A Node.js API + worker + Postgres on Railway realistically costs $6-$12/month. Not zero-cost. |
| **Fly.io** | Paid only after trial | No permanent free tier. Requires credit card. Trial is 2 CPU-hours or 7 days. Cheapest always-on machine is ~$2/month per service — adds up fast with 2-3 services. |
| **Render** | RECOMMENDED | 750 free instance-hours per workspace per month. 720 hours = one full month. A single free service running 24/7 fits within 750 hours. **Critical: deploy API and worker as two separate free web services** — each gets its own 750-hour budget within the workspace. Spin-down after 15 minutes of inactivity is a real limitation for the API, but the **worker must be kept alive via a self-ping or UptimeRobot** (free, 5-minute intervals). |

**Render Worker Limitation and Workaround:**
The "Background Worker" service type on Render is **paid-only**. The workaround is to deploy the worker as a **Free Web Service** that exposes a `/healthz` endpoint. UptimeRobot (free, up to 50 monitors) pings it every 5 minutes, preventing spin-down. The worker process itself runs indefinitely inside the container.

**GCP Cloud Run with min-instances note:** If you want to demonstrate GCP familiarity, Cloud Run *can* run the stateless Fastify API (it handles bursty webhook traffic perfectly). But the worker **must not** be on Cloud Run. A hybrid is viable: Render Free for the worker + Cloud Run for the API (within free quota). However, for simplicity and zero-config, **put both on Render Free**.

---

## Redis: Free-Tier Viability vs BullMQ

### Upstash Free Tier Reality Check

**Upstash Free Tier (as of March 2025 pricing update):** 500,000 commands/month, 256 MB storage.

**BullMQ command usage analysis:**

BullMQ uses Redis Streams, blocking commands (BZPOPMIN, XREAD), and Lua scripts. Even with an idle queue, the worker polls for:
- Stalled job checks (`stalledInterval`, default 30s)
- Delayed job scheduler checks (`guardInterval`, default 5s)
- Drain delay heartbeat when queue is empty (`drainDelay`, default 5s)

At default settings with one worker, an idle BullMQ queue generates approximately **~1,000 commands/hour** (guardInterval every 5s = 720 polls/hour + stall checks + heartbeats). That is **~720,000 commands/month** — **exceeds the 500k free tier**.

**With tuned settings, it becomes viable:**

```typescript
// Worker configuration for Upstash free-tier compatibility
const worker = new Worker(queueName, processor, {
  connection,
  stalledInterval: 300_000,  // check stalled every 5 min (default: 30s)
  guardInterval: 30_000,     // delayed job poll every 30s (default: 5s)
  drainDelay: 30,            // drain heartbeat every 30s (default: 5s)
});
```

With these settings: ~120 guardInterval polls/hour + ~12 stalledInterval checks/hour ≈ **~132 commands/hour baseline**. Plus ~15-20 commands per actual job processed. At ~100 jobs/day test load: ~4,000 job commands/day + ~3,168 idle commands/day ≈ **~220,000 commands/month** — fits within 500k.

**Important caveat from Upstash's own docs:** They explicitly warn that "BullMQ accesses Redis regularly even when idle" and recommend their Fixed plans over Pay-As-You-Go for BullMQ workloads. For a portfolio demo with controlled load, the free tier is viable **only with the tuned settings above**.

**Alternative — Self-hosted Redis on the Render worker container:**

If Upstash limits prove problematic, run Redis inside the same Render service as the worker using a process manager (supervisord or a Node.js child process). This eliminates command quota entirely. Downside: Redis data is not persisted across restarts (Render free tier containers restart on redeploy). For a portfolio demo this is acceptable — the queue durability story is demonstrated, not dependent on Redis disk persistence across deploys.

**Recommendation:** Start with Upstash Free + tuned BullMQ settings. If quota is exceeded during demo load tests, fall back to in-container Redis.

---

## PostgreSQL: Neon vs Supabase

**Recommendation: Neon Free Tier**

| Criterion | Neon | Supabase | Winner |
|-----------|------|----------|--------|
| Storage | 0.5 GB | 500 MB | Tie |
| Connection pooling | PgBouncer built-in, 10,000 pooled connections | PgBouncer built-in, 200 direct connection ceiling | Neon |
| Auto-suspend | 5 min inactivity (cannot disable on free tier) | 1 week inactivity pause | Neon (shorter resume cycle) |
| Cold start penalty | 1.8s median, 3.1s worst case | Similar on free tier | Tie |
| Prisma compatibility | Official Prisma docs + driver adapter | Official Prisma docs | Tie |
| Prisma migration support | Use `directUrl` for migrate, pooler URL for runtime | Same pattern | Tie |
| Extra features in free | Branching (useful for test isolation) | Auth, Storage, Edge Functions | Neon (branching useful for CI) |

**Neon gotchas to handle:**
1. **Auto-suspend cannot be disabled** on the free tier. Cold start adds 1.8–3.1s. Mitigate with a periodic keep-alive query from the worker (ping DB every 4 minutes when idle).
2. **Two connection strings required with Prisma:** `DATABASE_URL` must point to the Neon **pooler** endpoint (port 5432 with `-pooler` in hostname) for runtime queries. `DIRECT_URL` must point to the non-pooled endpoint for `prisma migrate`.
3. **Prepared statements:** PgBouncer in transaction mode (Neon's default) does not support protocol-level prepared statements via pgBouncer. Prisma handles this transparently — no action needed, but be aware if you use raw SQL with `pg` driver directly.
4. **100 compute-hours/month:** At 0.25 CU (the free tier default), 100 CU-hours = 400 actual compute hours (25% capacity). More than enough for a portfolio demo.

---

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

---

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

---

## Stack Patterns by Variant

**For the Ingestion API (Fastify service):**
- Validate webhook signature (HMAC-SHA256) before any processing
- Generate idempotency key (SHA-256 of channel + payload hash) in the handler
- Enqueue with BullMQ `Queue.add()`, set `jobId` to the idempotency key (BullMQ deduplicates by jobId)
- Return HTTP 202 immediately after successful enqueue
- All validation via Zod schemas typed against Fastify's `TypeBoxTypeProvider` or `ZodTypeProvider`

**For the Worker service:**
- One worker process, configurable concurrency (`concurrency: 5` is a safe default)
- Use `Worker` from BullMQ with `autorun: true`
- Wrap downstream calls (mock CRM sync) with `cockatiel` circuit breaker
- On exhausted retries, BullMQ moves job to the failed set — expose this as the DLQ
- Keep `/healthz` endpoint alive (UptimeRobot target)

**For local dev:**
- `docker-compose` with `redis:7-alpine` and `postgres:15-alpine` as services
- `tsx watch src/worker.ts` for hot-reload during development
- Upstash is only for deployed preview; local always uses containerized Redis

**For CI (GitHub Actions):**
- `services:` block with Redis and Postgres containers for integration tests
- `testcontainers` as alternative if you want DB lifecycle in test code
- Run `vitest run --coverage`, fail if coverage < 80%

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `bullmq@5.x` | `ioredis@5.x` | BullMQ 5 requires ioredis 5. Do not mix with ioredis 4. |
| `prisma@7.x` | `typescript@>=5.1`, `node@>=18.18` | v7 is ESM-native. If using CommonJS project layout, need `"type": "module"` or `.mts` extensions |
| `fastify@5.x` | `node@>=20` | v5 dropped Node.js 18 support. Pin to v5 on Node.js 22. |
| `zod@4.x` | `typescript@>=5.x` | Import from `zod/v4` subpath. Existing v3 imports continue to work from `zod` root during migration |
| `vitest@4.x` | `vite@>=5` | Vitest v4 requires Vite 5+. Does not require Vite in non-browser tests, but version alignment matters if using `@vitest/browser` |
| `next@15.x` / `next@16.x` | `react@19`, `node@>=18.18` | Both versions are stable. Use 15.x if you want the widest ecosystem compatibility; 16.x for latest features |

---

## Hosting Architecture Summary

```
[GitHub Actions CI]
        |
        v
  [Docker Build]
        |
   ┌────┴────────────────────┐
   |                         |
[Render Free]           [Render Free]
 Fastify API             BullMQ Worker
  (web service)          (web service)
  /healthz               /healthz ← UptimeRobot
        |                   |
        └──────┬────────────┘
               |
         [Upstash Redis Free]
         (TLS, 500k cmd/mo,
          tuned BullMQ config)
               |
         [Neon Free Tier]
         (PostgreSQL 15+,
          pooler + directUrl)
```

**Total recurring cost: $0/month** (within free tier limits during portfolio/job-hunt period)

---

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

---

*Stack research for: OmniSync — distributed event-driven CDP (webhook ingestion + worker)*
*Researched: 2026-06-01*
