# Feature Research

**Domain:** Distributed event-driven webhook ingestion / Customer Data Platform (CDP)
**Researched:** 2026-06-01
**Confidence:** HIGH (resilience patterns, BullMQ DLQ, observability); MEDIUM (dynamic routing, circuit breaker placement); HIGH (engineering standards via interview research)

---

## Framing: "Table Stakes" for This Portfolio

This is not a commercial product. "Table stakes" means what a senior/distributed-systems interviewer expects to see to treat the system as credible. "Differentiators" are features that move the conversation from "competent implementation" to "impressive architectural thinking." Anti-features are scope-creep traps that dilute the infrastructure narrative.

---

## Table Stakes

Features the showcase MUST have for a technical interviewer to take it seriously. Missing any one of these renders the portfolio unconvincing for senior distributed-systems roles.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Webhook ingestion endpoint (Fastify)** — validates signature, generates fingerprint, enqueues raw payload, returns HTTP 202 | Every production event-ingestion system does this. Interviewers will ask "what happens under a traffic spike?" — the fast ACK proves you understand the accept-then-queue contract. | MEDIUM | Target: <5 ms P99 to ACK. Use raw body buffer for HMAC recomputation before JSON parsing. |
| **HMAC signature validation with constant-time compare** | Naive `===` comparison leaks timing information. Constant-time is the first thing a security-aware interviewer checks. Also blocks replay attacks. | LOW | Include timestamp window check (±300s). Use Node.js `crypto.timingSafeEqual`. |
| **Idempotency fingerprinting + deduplication store** | Network unreliability guarantees duplicate deliveries. At-least-once without idempotency is just "eventually corrupted." | MEDIUM | Hash of (source + event_type + provider_event_id). Store in Redis with TTL >= provider retry window (Stripe: 3 days; generic: 24 h). DB unique constraint as durable fallback. |
| **Asynchronous BullMQ queue backed by Redis** | The decoupling of ingestion from processing is the central distributed-systems claim. Without a real queue, there is nothing to showcase. | MEDIUM | Queue: raw payload + fingerprint + source metadata. Worker must be separately deployed (always-on, not serverless). |
| **Distributed worker pool — normalize, validate schema, persist to PostgreSQL** | Proves the queue-to-consumer contract. Zod schema validation at worker level catches malformed payloads the ingestion layer fast-ACKed. | MEDIUM | Worker concurrency configurable via env var. Prisma upsert with fingerprint as idempotency key. |
| **Idempotent processing (dedup at worker level)** | Idempotency is not just an ingestion concern. Workers must be safe to re-run on the same event without double-writes. Required for correct DLQ re-queue behavior. | LOW | Prisma upsert ON CONFLICT DO NOTHING keyed on fingerprint. Log dedup events (these are observable signals). |
| **Retry with jittered exponential backoff** | Retry without jitter causes thundering-herd: 1000 events all fail at T+0, all retry at T+5s, all fail again together. Jitter is the fix. Interviewers probe this explicitly. | LOW | BullMQ native: `attempts: N, backoff: { type: 'exponential', delay: 1000 }` plus custom jitter in job processor (full-jitter: `rand(0, computed_delay)`). Classify errors: transient (retry) vs permanent (skip to DLQ). |
| **Dead-Letter Queue (DLQ) — capture exhausted retries with full error trace** | DLQ is the "no silent loss" guarantee made concrete. Without it, exhausted retries vanish. Interviewers ask "what happens to events that keep failing?" | MEDIUM | BullMQ has no built-in DLQ — implement via worker `failed` event listener: after `maxAttempts`, move job to a dedicated `dlq` queue with original data + error + stack + attempt count + timestamps. Alert when DLQ depth >10 or oldest item >1 h. |
| **DLQ re-queue (one-click + programmatic)** | DLQ is useless without a recovery path. One-click re-queue is the live-demo moment: "I broke Postgres, events piled up in DLQ, I fixed it, I re-queued, zero data lost." | MEDIUM | Re-queue path must go through deduplication check so re-queued events are idempotent. Expose as REST endpoint consumed by the dashboard. |
| **Structured logs with correlation IDs** | Observability is a table-stakes expectation for any production system. "How do you debug a failed event in prod?" — structured logs with event ID threading is the answer. | LOW | Use `pino` (Fastify-native). Log event_id, source, fingerprint, worker_id, attempt_num, duration_ms, outcome at every stage. |
| **GitHub Actions CI/CD (type-check + test + Docker build on push)** | CI/CD is explicitly what distinguishes "junior project" from "production-grade portfolio." Every senior job posting lists it. | LOW | Matrix: lint → type-check → unit tests → integration tests → Docker build. Fail fast. Cache node_modules and Docker layers. |
| **Dockerized multi-stage build** | Reproducibility is a prerequisite for "production-grade." Interviewers want `docker compose up` to work on their machine. | LOW | Stage 1: build. Stage 2: production image (no devDeps, no src). docker-compose.yml spins up Redis, Postgres, ingestion-api, worker, dashboard. |
| **Automated test suite ≥80% line coverage (Vitest unit + integration)** | Test coverage is stated explicitly in the project scope and is itself a deliverable. It proves rigor. | HIGH | Unit: pure functions (fingerprinting, backoff calculator, schema validators). Integration: real Redis + Postgres via Testcontainers. |
| **Integration test: kill Postgres mid-process, verify no data loss from queue** | This is the signature "distributed systems" demo test. It proves the queue-first guarantee is not theoretical. | HIGH | Pattern: start worker, begin processing batch, pause Postgres container (`docker pause`), verify events remain in BullMQ, resume Postgres, verify events eventually persist with correct data. Use Testcontainers for lifecycle control. |

---

## Differentiators

Features that elevate the project from "correctly implemented" to "architecturally impressive." Each one is a talking point in an interview.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Circuit breaker (Opossum) guarding mock downstream CRM sync** | Proves understanding of cascading failure prevention. The pattern is most credible on an *external* dependency, not the system's own DB. "When our CRM is down, we open the circuit, stop hammering it, and wait for half-open probe." | HIGH | Use `opossum` (de-facto Node.js standard, maintained by nodeshift/Node.js Foundation). Configure: `errorThresholdPercentage: 50`, `timeout: 3000`, `resetTimeout: 30000`. Expose state (CLOSED/OPEN/HALF-OPEN) as a metric. A mock CRM that returns 500s on demand makes the live demo compelling. |
| **Dynamic event-routing/transformation rules — configurable without redeploying** | Shows awareness of operational pain: every rule change requiring a deploy is a friction point. Storing rules in DB/Redis and reloading on-the-fly is how real platforms (Hookdeck, Segment) work. | HIGH | Store routing rules (source → destination mapping) and transform rules (field normalizers: E.164 phone, ISO-8601 date) in PostgreSQL. Worker loads rules at startup + polls for changes (or Redis pub/sub invalidation). No code deploy needed to add a new normalization rule. |
| **Next.js DLQ dashboard with live metrics** | Strong live-demo artifact. Lets an interviewer actually watch events flow, fail, and recover in real time. Also demonstrates full-stack depth without abandoning the infrastructure narrative. | HIGH | Three views: (1) Live throughput chart (processed/failed per second via SSE or polling). (2) DLQ list: event_id, source, error message, stack trace, attempt count, age, one-click re-queue button. (3) Circuit breaker state indicator per downstream. |
| **Load-test visualization (k6 or autocannon → dashboard live)** | Turns a terminal command into a visually compelling demo. Recruiters without deep infrastructure backgrounds can see the system under stress. | MEDIUM | Run `autocannon -c 100 -d 30 http://localhost:3000/ingest/webhook` during demo. Dashboard shows throughput climbing, queue depth responding, retries and DLQ items appearing. |
| **OpenTelemetry integration with BullMQ telemetry adapter** | BullMQ v5.71 (March 2026) ships with native OpenTelemetry support. Using it demonstrates knowledge of current observability standards rather than ad-hoc logging. | MEDIUM | Instrument with `@opentelemetry/sdk-node`. BullMQ gauges: `bullmq.queue.jobs.state` with states (waiting, active, completed, failed, delayed). Export to local Prometheus + Grafana in docker-compose, or to Axiom/Grafana Cloud on free tier. |
| **Error classification at retry layer** | Not all failures are the same. 400 (validation error) should go straight to DLQ; 503 (transient) should retry; 500 with idempotency collision should be silently dropped. Demonstrating this shows understanding of failure taxonomy. | MEDIUM | Create `ErrorClass` enum: `TRANSIENT`, `PERMANENT`, `IDEMPOTENT_DUPLICATE`. Worker catch block inspects error type and routes accordingly. Log class as structured field. |
| **Queue-depth backpressure awareness** | Prevents a spike from growing queue depth unboundedly. Shows understanding of flow control. | MEDIUM | Worker reads queue depth before accepting new concurrency slots. If `waiting > threshold`, reduce concurrency or emit a backpressure metric. Not a hard gate — an observable signal. |
| **Playwright E2E tests covering DLQ dashboard flows** | End-to-end tests on the dashboard prove the UI contract, not just the API. Required by project spec; distinguishes the portfolio. | MEDIUM | Test paths: load DLQ list, inspect error detail, click re-queue, verify event disappears from DLQ list. Mock API with MSW or hit real local stack. |

---

## Anti-Features

Things to explicitly NOT build. Each one is a trap that wastes time or dilutes the infrastructure narrative.

| Anti-Feature | Why Requested | Why Problematic | What to Build Instead |
|--------------|---------------|-----------------|-----------------------|
| **Real marketplace/CRM integrations (Shopee, Tokopedia, Meta Ads, Dynamics 365)** | Sounds more "real" and impressive to non-technical audiences. | Requires real credentials, real data, real rate limits. Adds enormous coordination cost with zero resilience-showcase benefit. The resilience story is equally demonstrable with a controllable mock. | Mock webhook sender script that generates realistic payloads at configurable rates. Mock downstream CRM endpoint that returns 500s on demand (circuit breaker trigger). |
| **Kafka / Redpanda** | Kafka is the "serious" distributed queue. Choosing Redis/BullMQ looks less impressive to those who've only heard of Kafka. | At portfolio scale, Kafka adds operational overhead, free-tier cost, and complexity without changing the resilience narrative. Redis + BullMQ is faster to demonstrate, cheaper to run, and is the right tool for this scale. The choice is *defensible and deliberate* — explain it in the README. | BullMQ on Redis. Prepare a one-paragraph "why not Kafka" that shows architectural judgment: cost/scale tradeoff, TTL-based eviction, BullMQ DLQ semantics. |
| **Multi-tenancy + user accounts + billing** | Makes the project feel "more like a real product." | Completely orthogonal to the resilience/infrastructure narrative. Adds auth complexity, data isolation concerns, and UI work that dilutes the portfolio's single clear message. | A single-tenant system with optional HTTP Basic Auth on the dashboard (minimal protection, not RBAC). |
| **AI/ML anomaly detection on event stream** | Trending feature; seems like an easy differentiator. | Contradicts the deliberate positioning of OmniSync as an *infrastructure* showcase (distinct from existing AI projects in portfolio). Would blur the "golden triangle" narrative. | Structured metrics + alerting thresholds. If anomaly detection is needed later, it belongs in a separate project. |
| **Real-time WebSocket push from server to dashboard** | More impressive than polling. | Adds complexity (connection management, heartbeat, reconnect) for marginal demo value. SSE (Server-Sent Events) achieves the same visual effect with HTTP/1.1, no extra infrastructure. | Use Next.js Route Handler streaming SSE or 3-second polling for dashboard live updates. Simpler to implement, simpler to explain. |
| **Full RBAC / JWT auth on dashboard** | Security completeness seems important. | Not the focus of this project. Time spent on auth middleware is time not spent on resilience patterns. The portfolio selling point is the distributed backend, not the auth layer. | HTTP Basic Auth (single hardcoded credential) or no auth for local/demo mode. Document explicitly that auth is intentionally minimal per project scope. |
| **Event replay / full audit log at application level** | Sounds like a good reliability feature. | Overlaps with DLQ + re-queue, which already provides the recovery story. Full audit logging bloats the data model and is not the central claim. | DLQ captures failed events with full context. Postgres events table (immutable, append-only) provides audit trail for successfully processed events. That's sufficient. |

---

## Feature Dependencies

```
[Idempotency Fingerprinting]
    └──requires──> [Signature Validation]  (signature verified before fingerprint is trusted)
    └──feeds──> [Deduplication Store (Redis)]
                    └──feeds──> [Idempotent Worker Processing]
                                    └──enables──> [DLQ Re-queue Safety]

[BullMQ Queue]
    └──requires──> [Redis]
    └──enables──> [Retry w/ Jitter]
    └──enables──> [DLQ Capture]
                    └──enables──> [DLQ Re-queue]
                                    └──consumed-by──> [Next.js Dashboard]

[Worker Pool]
    └──requires──> [BullMQ Queue]
    └──requires──> [PostgreSQL + Prisma]
    └──optionally-calls──> [Mock CRM Downstream]
                               └──protected-by──> [Circuit Breaker (Opossum)]
                                                       └──exposes-state-to──> [Observability / Dashboard]

[Dynamic Routing Rules]
    └──requires──> [PostgreSQL] (rule storage)
    └──requires──> [Worker Pool] (rule application)

[Next.js Dashboard]
    └──requires──> [DLQ Re-queue API]
    └──requires──> [Observability Metrics API]
    └──optionally-uses──> [Circuit Breaker State API]
    └──tested-by──> [Playwright E2E]

[Integration Test: Kill Postgres]
    └──requires──> [BullMQ Queue] (must be durable independently of Postgres)
    └──requires──> [Testcontainers] (lifecycle control)
    └──requires──> [Idempotent Processing] (re-processing after recovery must be safe)

[CI/CD Pipeline]
    └──requires──> [Docker multi-stage build]
    └──requires──> [Vitest unit + integration tests]
    └──requires──> [Playwright E2E tests]
```

### Dependency Notes

- **Signature validation before fingerprint:** The fingerprint is generated from the validated raw body. If signature validation fails, the request is rejected before fingerprinting — saves dedup store writes on invalid requests.
- **Idempotent processing enables safe DLQ re-queue:** Without idempotency at the worker level, re-queuing DLQ items risks double-writes. Idempotency must be implemented before the DLQ re-queue feature is production-safe.
- **Circuit breaker requires mock CRM downstream:** The circuit breaker's value is only observable if there is a flaky downstream to trip it. The mock CRM must be in place (and controllable via an admin endpoint) before the circuit breaker feature has demo value.
- **Dynamic routing requires PostgreSQL schema:** Rule definitions live in the database. The Prisma schema and migration for routing rules must exist before the worker can load and apply them.
- **Kill-Postgres integration test requires BullMQ to be independent of Postgres:** This test exists to prove the queue's durability guarantee. If workers crash when Postgres is unavailable (rather than retrying), the test fails — meaning the worker must handle DB unavailability gracefully before this test is written.

---

## MVP Definition

For this portfolio, "MVP" = the minimum set that can demonstrate the core guarantee live in an interview. The full spec is the target, but this ordering gives a working demo as early as possible.

### Phase 1 — Core Pipeline (demonstrate the guarantee)

- [x] Fastify ingestion endpoint with signature validation + fingerprinting + fast ACK
- [x] BullMQ queue on Redis
- [x] Worker pool: normalize, validate schema (Zod), persist to PostgreSQL (Prisma)
- [x] Idempotent processing (upsert on fingerprint)
- [x] Retry with jittered exponential backoff
- [x] Dead-Letter Queue (BullMQ listener + separate queue)
- [x] Structured logs (pino) with correlation IDs

Rationale: these seven items are the minimum to say "no event is silently lost" and mean it.

### Phase 2 — Observability + Dashboard (make it visible)

- [x] Metrics API (queue depth, throughput, retry counts, DLQ count)
- [x] DLQ re-queue REST endpoint
- [x] Next.js dashboard: live throughput, DLQ list with error detail, one-click re-queue
- [x] Load-test script (autocannon) and live-demo visualization

Rationale: the pipeline works in Phase 1 but is invisible. Phase 2 makes it demoable.

### Phase 3 — Advanced Resilience + Engineering Standards (full spec)

- [x] Circuit breaker (Opossum) guarding mock CRM downstream
- [x] Dynamic routing/transformation rules (DB-stored, no redeploy)
- [x] OpenTelemetry integration (BullMQ telemetry adapter)
- [x] Vitest unit + integration tests, ≥80% coverage
- [x] Integration test: kill Postgres mid-process
- [x] Playwright E2E tests on dashboard
- [x] GitHub Actions CI/CD pipeline
- [x] Docker multi-stage build + docker-compose.yml

Rationale: completes the full spec, adds the "engineering standards" layer that turns the demo into a hiring signal.

---

## Feature Prioritization Matrix

| Feature | Interview Value | Implementation Cost | Priority |
|---------|----------------|---------------------|----------|
| Fast ACK ingestion endpoint | HIGH | MEDIUM | P1 |
| HMAC signature validation | HIGH | LOW | P1 |
| Idempotency fingerprinting + Redis dedup | HIGH | MEDIUM | P1 |
| BullMQ queue + worker pool | HIGH | MEDIUM | P1 |
| Idempotent processing (Prisma upsert) | HIGH | LOW | P1 |
| Retry with jittered exponential backoff | HIGH | LOW | P1 |
| DLQ capture with full error trace | HIGH | MEDIUM | P1 |
| Structured logs (pino) | HIGH | LOW | P1 |
| DLQ re-queue REST endpoint | HIGH | LOW | P1 |
| Next.js DLQ dashboard | HIGH | HIGH | P1 |
| Integration test: kill Postgres mid-process | HIGH | HIGH | P1 |
| GitHub Actions CI/CD | HIGH | LOW | P1 |
| Docker multi-stage + docker-compose | HIGH | LOW | P1 |
| ≥80% test coverage (Vitest) | HIGH | HIGH | P1 |
| Circuit breaker (Opossum + mock CRM) | HIGH | HIGH | P2 |
| Dynamic routing/transformation rules | MEDIUM | HIGH | P2 |
| OpenTelemetry + BullMQ telemetry | MEDIUM | MEDIUM | P2 |
| Load-test visualization (autocannon) | MEDIUM | LOW | P2 |
| Error classification (TRANSIENT/PERMANENT) | MEDIUM | LOW | P2 |
| Playwright E2E on dashboard | MEDIUM | MEDIUM | P2 |
| Queue-depth backpressure awareness | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have — portfolio is not credible without it
- P2: Should have — adds depth and differentiates from similar projects
- P3: Nice to have — polish, defer if time-constrained

---

## Resilience Pattern Reference

Concrete expected behavior for each pattern — use as implementation spec and interview talking points.

### Retry with Jittered Exponential Backoff

**Expected behavior:**
1. Job processor throws an error.
2. BullMQ increments `attemptsMade`. If `attemptsMade < maxAttempts`, job is re-queued with a computed delay.
3. Delay formula: `base_delay * (2 ^ attemptsMade)` = exponential component. Apply full jitter: `actual_delay = rand(0, exponential_delay)`.
4. After `maxAttempts` exhausted, job transitions to BullMQ `failed` state.
5. Worker `failed` event listener moves job to DLQ.

**Why jitter:** Without it, N concurrent failures all retry at the same computed time, amplifying the failure at the downstream. Jitter spreads retries across the backoff window, turning a synchronized thundering herd into a smooth recovery curve.

**Error classification:** HTTP 4xx (permanent) → skip retries, go directly to DLQ. HTTP 5xx / timeout (transient) → retry with backoff. Idempotency collision → silently drop (already processed).

### Dead-Letter Queue (DLQ)

**Expected behavior:**
1. Job exhausts `maxAttempts` in BullMQ → enters `failed` state.
2. Worker `failed` event fires with the job object (data + error + stacktrace + attemptsMade + timestamps).
3. A DLQ manager adds the job to a dedicated `dlq` BullMQ queue (or a separate Redis key) with: original payload, source, fingerprint, error message, stack, attempt count, original enqueue time, DLQ arrival time.
4. DLQ is not processed automatically. It is a staging area for operator review.
5. Operator (via dashboard or API) inspects the job, fixes the underlying issue, calls the re-queue endpoint.
6. Re-queue endpoint pushes the event back to the main queue with `attempts` reset. Because worker processing is idempotent, re-queuing is safe regardless of prior partial processing.
7. On re-queue success, job is removed from DLQ.

**Alert thresholds:** DLQ depth >10 → emit alert metric. Oldest unreviewed DLQ item >1h → emit alert metric.

### Circuit Breaker (Opossum)

**Context:** Applied at the worker layer, guarding the outbound call to the mock CRM downstream sync. Not applied to the system's own PostgreSQL (circuit breakers on your own DB add complexity without proportional benefit at portfolio scale).

**Expected behavior (three states):**
1. **CLOSED (normal):** All CRM sync calls flow through. Opossum tracks success/failure ratio.
2. **OPEN (tripped):** After `errorThresholdPercentage` (e.g., 50%) of calls fail within the rolling window, circuit opens. All subsequent CRM sync calls immediately throw an `OpenCircuitError` without hitting the CRM. Events are held in queue or diverted to DLQ (decision: hold in queue by returning a transient error, so they retry after the circuit resets).
3. **HALF-OPEN (probing):** After `resetTimeout` (e.g., 30s), one probe call is allowed through. If it succeeds, circuit closes. If it fails, circuit re-opens and `resetTimeout` restarts.

**Opossum config:**
```typescript
const breaker = new CircuitBreaker(crmSyncFn, {
  timeout: 3000,                  // call timeout
  errorThresholdPercentage: 50,   // trip after 50% failure rate
  resetTimeout: 30_000,           // half-open probe after 30s
  volumeThreshold: 5,             // minimum calls before threshold applies
});
```

**Observable signals:** Expose `breaker.stats` (fires, successes, failures, fallbacks, opened, closed) as metrics visible in the dashboard. The circuit breaker state indicator on the dashboard (green/red/amber) is the live-demo moment.

---

## Engineering Standards as Features

These are not "soft requirements" — they are portfolio deliverables with the same weight as the resilience patterns.

| Standard | What It Proves | Implementation Notes |
|----------|---------------|----------------------|
| ≥80% line coverage | Rigor. You do not ship untested code. | Vitest `--coverage` with `c8`. Unit: fingerprinting, backoff, schema validators. Integration: end-to-end queue flow with real Redis + Postgres (Testcontainers). |
| Integration test: kill Postgres | The queue guarantee is real, not theoretical | `docker pause postgres` via Testcontainers API mid-batch. Assert events remain in BullMQ (not lost). Unpause Postgres. Assert eventual persistence. Retry logic must handle the gap. |
| Green CI on every push | Operational discipline. You treat tests as gates, not suggestions. | GitHub Actions. Matrix: `type-check → lint → test:unit → test:integration → docker:build`. Fail on first error. Cache aggressively. |
| Docker multi-stage build | Reproducibility. "Works on my machine" is not acceptable. | Stage 1: `node:20-alpine` + all deps + `tsc` build. Stage 2: `node:20-alpine` + production only. `docker-compose.yml` wires Redis, Postgres, api, worker, dashboard with health checks and depends_on. |
| Playwright E2E | Dashboard is tested, not assumed | Covers: navigate to DLQ, expand error detail, click re-queue, verify item disappears. Run against local docker-compose stack. |

---

## Sources

Research grounded in the following current sources (2025-2026):

- [Hookdeck Webhook Infrastructure Guide](https://hookdeck.com/webhooks/guides/webhook-infrastructure-guide) — production webhook patterns, fast ACK, idempotency, DLQ
- [BullMQ Dead Letter Queue implementation (oneuptime, Jan 2026)](https://oneuptime.com/blog/post/2026-01-21-bullmq-dead-letter-queue/view) — DLQ implementation pattern in BullMQ
- [BullMQ Retry with Exponential Backoff (oneuptime, Jan 2026)](https://oneuptime.com/blog/post/2026-01-21-bullmq-retry-exponential-backoff/view) — retry configuration
- [Webhook Reliability 2026: Idempotency & Retry Reference](https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026) — fingerprinting, jitter strategies, DLQ retention, portfolio credibility markers
- [Node.js Circuit Breaker (Opossum) in Production (DEV, 2026)](https://dev.to/axiom_agent/nodejs-circuit-breaker-pattern-in-production-opossum-fallbacks-and-resilience-engineering-1mj4) — Opossum as de-facto standard
- [BullMQ Observability / Metrics](https://docs.bullmq.io/guide/telemetry/metrics) — native OpenTelemetry gauge support, job state metrics
- [Node.js Observability Stack 2026 (DEV)](https://dev.to/axiom_agent/the-nodejs-observability-stack-in-2026-opentelemetry-prometheus-and-distributed-tracing-229b) — OTel + Prometheus pattern
- [Background Job Retry Policy Checklist (momentslog.com)](https://www.momentslog.com/development/background-job-retry-policy-checklist-how-to-prevent-queues-from-amplifying-production-failures) — production retry policy metrics
- [Integration Testing Node.js + Postgres + Vitest (Testcontainers)](https://nikolamilovic.com/posts/integration-testing-node-postgres-vitest-testcontainers/) — kill-Postgres test pattern
- [Dead Letter Queue Patterns at Scale (codelit.io)](https://codelit.io/blog/dead-letter-queue-patterns) — DLQ architecture for distributed systems
- [Webhook Security Best Practices 2026 (hooque.io)](https://hooque.io/guides/webhook-security/) — timing-safe compare, replay protection

---

*Feature research for: OmniSync — distributed event-driven webhook ingestion / CDP*
*Researched: 2026-06-01*
