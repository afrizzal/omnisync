# Phase 4: Resilience & Dynamic Routing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 04-resilience-dynamic-routing
**Areas discussed:** Circuit breaker library, Mock CRM design, Retry profile, Routing rules model

---

## Circuit Breaker Library

| Option | Description | Selected |
|--------|-------------|----------|
| cockatiel | TypeScript-first, composable policy API. CLAUDE.md stack doc explicitly recommends for mock-CRM guard. | ✓ |
| opossum | Named in ROADMAP.md / REQUIREMENTS.md. Well-known Node.js ecosystem. STATE.md flagged v9 API shape as blocker. | |
| You decide | Claude picks based on portfolio defensibility. | |

**User's choice:** cockatiel (overrides opossum naming in roadmap docs)

---

## Circuit Breaker Policy Composition

| Option | Description | Selected |
|--------|-------------|----------|
| Layered: Retry wraps CircuitBreaker | Composable policies — Retry handles transient errors, CircuitBreaker skips retries when open. Shows composability narrative. | ✓ |
| CircuitBreaker only | BullMQ job retries handle retry; cockatiel only provides the breaker. Simpler but loses composability story. | |
| You decide | Claude picks composition. | |

**User's choice:** Layered (Retry wraps CircuitBreaker)

---

## Circuit Breaker Parameters

**User's free-text input (follow-up after policy choice):**

- Breaker type: `ConsecutiveBreaker(5)` — opens after 5 consecutive failures. Easier to explain and demo than `SamplingBreaker` (rate-based) which needs traffic volume to trigger.
- `halfOpenAfter`: 10–15 seconds, configurable via env var. Short enough for live demo.
- All parameters into env config with those defaults — consistent with existing Zod env validation pattern.

---

## Mock CRM Design

| Option | Description | Selected |
|--------|-------------|----------|
| Separate HTTP service | `apps/mock-crm` Fastify app. Real HTTP call from worker. Configurable failure rate. Stronger demo story. | ✓ |
| In-process async function | Mock function injected via DI. No network call. Simpler, easier to test, less compelling demo. | |
| You decide | Claude picks most convincing circuit breaker story. | |

**User's choice:** Separate HTTP service

**Notes from user:**
1. Worker depends on `CrmClient` interface (DI) — HTTP impl in prod, fake in-process for unit tests. Gets both demo story and testability.
2. Runtime failure control via `POST /admin/failure-mode { mode: "fail" | "slow" | "ok", rate }` — env var alone requires restart, breaks demo. `slow` mode needed to demo Timeout policy.
3. `apps/mock-crm` in docker-compose only — not a third Render service (free-tier budget).

---

## Retry Profile — Config Location

| Option | Description | Selected |
|--------|-------------|----------|
| Queue-level defaultJobOptions | Set in `createEventsQueue()`. All jobs inherit. Consistent with existing removeOnComplete/removeOnFail. | ✓ |
| Per-enqueue in API route | Pass attempts + backoff on each `queue.add()`. Flexible but couples API to retry policy. | |
| You decide | Claude keeps queue package as single source of truth. | |

**User's choice:** Queue-level defaultJobOptions

**Notes from user:**
1. "Retry policy is a property of the pipeline, not the caller" — API route must not know about backoff.
2. BullMQ has no built-in jitter → use `backoff: { type: 'custom' }`, define strategy in `packages/queue`, import in worker.
3. Full jitter formula: `delay = random(0, min(cap, base * 2^attempt))` — AWS Architecture Blog "Full Jitter" pattern.
4. Env defaults: `attempts: 5`, base `1s`, cap `30s`. With `halfOpenAfter` 10–15s, final attempts fall after breaker can half-open — clean demo cycle.

---

## Routing Rules Scope

| Option | Description | Selected |
|--------|-------------|----------|
| E.164 phone normalization only | One concrete, demonstrable rule type. Extensibility proven by architecture, not rule count. | ✓ |
| E.164 + field rename/drop | Two rule types. More variety, moderate extra complexity. | |
| You decide | Claude picks scope without feature-creep. | |

**User's choice:** E.164 only

**Notes from user:**
- CLAUDE.md constraint: "favor demonstrable reliability over feature breadth."
- Senior reviewer cares about extensible architecture, not rule catalog.
- Extensibility visible via: Zod discriminated union schema + dispatch table execution (not if/else). README explicitly names field rename/drop as extension point.

---

## Routing Rules Reload Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Polling (lazy TTL cache) | Cache rules + timestamp. Reload on job process if stale beyond TTL. No background timer. | ✓ |
| Redis pub/sub invalidation | Subscribe to Redis channel on rule change. Lower latency but more complexity. | |
| You decide | Claude picks most credible without over-engineering. | |

**User's choice:** Polling — with important refinement: **lazy TTL cache, not background setInterval**

**Notes from user:** Reload only happens when there's actual work (a job arrives). No timer running in the background.

---

## Claude's Discretion

- Exact `routing_rules` schema columns
- `CrmClient` interface method names and HTTP shape
- Whether re-queue endpoint is on `/admin` or `/api` router
- Test infrastructure for cockatiel policy (mock timers vs real wait)
- `bull-board` — deferred

## Deferred Ideas

- Bulk re-queue UI trigger → Phase 5 dashboard
- Kill-Postgres integration test (TST-02) → Phase 6
- Playwright E2E for DLQ re-queue (TST-04) → Phase 6
- Upstash command count recheck with retry overhead → researcher task
