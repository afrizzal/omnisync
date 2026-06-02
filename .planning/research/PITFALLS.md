# Pitfalls Research

**Domain:** Distributed webhook-ingestion / queue-worker / Customer Data Platform (CDP)
**Researched:** 2026-06-01
**Confidence:** HIGH (BullMQ official docs + Redis docs verified), MEDIUM (free-tier limits from provider docs), LOW (flagged inline)

---

## Critical Pitfalls

### Pitfall 1: Redis Eviction Policy Not Set to `noeviction` — Silent Job Loss

**What goes wrong:**
When Redis runs out of memory and `maxmemory-policy` is anything other than `noeviction`, Redis silently evicts keys. Queue metadata, job payloads, and lock keys disappear without error. From the application's perspective, jobs simply vanish — no exception, no DLQ entry, no log. The queue appears healthy; data is gone.

**Why it happens:**
Default Redis and most managed Redis providers ship with an LRU eviction policy (e.g., `volatile-lru` or `allkeys-lru`). Developers assume "Redis will just work". Upstash free tier disables eviction by default but rejects writes once the 256 MB cap is hit, which is a different failure mode (OOM error on enqueue, not silent loss) — still breaks ingest under load.

**How to avoid:**
- Self-hosted Redis: set `maxmemory-policy noeviction` in `redis.conf` and verify on startup.
- Docker Compose: pass `--maxmemory-policy noeviction` as a command argument.
- Upstash: confirm eviction is disabled (it is by default) AND monitor the 256 MB / 500K commands-per-month free-tier cap. A single BullMQ worker with default polling (~every 1 second = ~86K commands/day) can exhaust 500K commands in 6 days. Switch to event-driven blocking (`BRPOP`/streams) or upgrade to a paid plan before demo day.
- Add a startup health check: `CONFIG GET maxmemory-policy` → assert value equals `noeviction` before the worker starts accepting jobs.

**Warning signs:**
- Queue length drops without corresponding processed-job count increase.
- Missing idempotency records for events you know were ingested.
- Redis `INFO memory` shows `used_memory` approaching `maxmemory`.
- Upstash dashboard shows command count approaching monthly limit mid-month.

**Phase to address:** Queue & Worker setup phase (before any resilience work). Validate with a Redis config assertion test.

---

### Pitfall 2: Stalled Jobs Due to Lock Expiry — Phantom Exactly-Once Assumption

**What goes wrong:**
BullMQ's documentation uses language like "attempts to deliver every message exactly one time" — this is aspirational, not a guarantee. The real semantic is **at-least-once**. When a worker's Node.js event loop is blocked (CPU-intensive normalization, synchronous Prisma migration, large JSON parse), it cannot renew its job lock within `lockDuration` (default 30 seconds). BullMQ detects the stall and re-queues the job for another worker. If the original worker recovers and completes, the same job is processed twice — both workers think they own it.

**Why it happens:**
Developers read "exactly once" in the BullMQ docs and skip implementing idempotency, treating the queue as a safety guarantee rather than a delivery mechanism. Stall is triggered specifically by: CPU-bound work blocking the event loop, external I/O calls without timeouts, unresolved Promises, or worker restart during processing.

**How to avoid:**
- Set `lockDuration` to at least 2× your p99 job processing time.
- Call `job.extendLock(duration)` inside long-running jobs.
- Never block the event loop: use `setImmediate`/`Promise.resolve()` checkpoints inside loops, or offload CPU work to worker threads.
- Treat every job processor as **idempotent by design** — the lock is a performance optimization, not an exactly-once guarantee.
- Set `maxStalledCount: 1` (default 2) for the demo environment to move poison-stalling jobs to failed faster.

**Warning signs:**
- BullMQ event `stalled` fires on the queue.
- Worker logs show "job completed" but the job re-appears in active state moments later.
- Duplicate database rows despite idempotency key logic (means idempotency is also broken — see Pitfall 3).

**Phase to address:** Worker implementation phase. Must be paired with Pitfall 3 (idempotency) — both must be addressed together.

---

### Pitfall 3: Weak Idempotency — Check-Then-Act Race Condition

**What goes wrong:**
The naive pattern is: `SELECT COUNT FROM events WHERE fingerprint = $1` → if zero, `INSERT`. Under concurrent workers or duplicate webhook delivery, two workers can both read zero, both pass the check, and both insert — producing duplicate events in the database. The problem is compounded when the fingerprint is weak (e.g., derived only from payload fields that change between retries like `timestamp` or `retry_count`).

**Why it happens:**
Developers reach for Redis `SET NX` as a deduplication cache and call it done. Two problems: (1) Redis `SET NX` is eventually consistent across worker restarts — the key can be evicted (see Pitfall 1), meaning the fingerprint cache disappears and the event is reprocessed. (2) `SET NX` + separate DB insert is still two operations — if the process crashes between them, the cache entry exists but the DB record does not, causing the event to be silently dropped on the next retry.

**How to avoid:**
- **Primary guard: PostgreSQL unique constraint on `fingerprint` column** + `INSERT ... ON CONFLICT (fingerprint) DO NOTHING`. This is atomic — whoever inserts first wins; all others get a silent no-op. The check and insert are a single operation.
- **Fingerprint construction:** Hash over stable, source-controlled fields only: `sha256(source_channel + event_type + source_event_id)`. Never include timestamps, retry counts, or mutable fields.
- **TTL awareness:** Keep idempotency records for at least the source's retry window (webhook senders typically retry for 24–72 hours). Do not prune records younger than 72 hours.
- Redis `SET NX` is acceptable as a fast-path cache **only** if the PostgreSQL constraint is the authoritative guard. Redis cache miss → Postgres atomic insert is the fallback; never rely on Redis alone.
- Test with concurrent load: fire 50 identical webhooks simultaneously and assert exactly 1 DB row.

**Warning signs:**
- `events` table row count diverges from `processed_jobs` counter.
- Downstream mock CRM receives duplicate sync calls for the same event.
- Integration test passes with serial requests but fails under `Promise.all([...same event × N])`.

**Phase to address:** Core data model phase (schema design) — the unique constraint must exist before any worker code is written. Do not retrofit.

---

### Pitfall 4: No Graceful Shutdown — Jobs Orphaned on Worker Restart

**What goes wrong:**
A `SIGTERM` kills the worker mid-job. The job has been dequeued and locked, but no result is written. BullMQ detects a stall after `lockDuration` elapses (up to 30 seconds of delay). During that window, the job is in limbo. On free-tier hosting, containers restart frequently (deploy, scaling events, cold-start cycling). Without graceful shutdown, every deploy risks orphaned jobs that re-queue and process twice — attacking idempotency guarantees.

**Why it happens:**
Workers are treated like stateless HTTP handlers. They aren't. A queue worker has in-flight state (the job currently being processed) that must be drained before the process exits.

**How to avoid:**
- Listen for `SIGTERM` / `SIGINT`: call `await worker.close()` which waits for in-flight jobs to complete.
- Set a drain timeout (e.g., 30 seconds) so deploys don't hang indefinitely.
- In Docker: set `STOPSIGNAL SIGTERM` and `stop_grace_period: 35s` (slightly more than drain timeout).
- Log when shutdown starts and completes — visible in CI/CD pipeline and demo.

**Warning signs:**
- Stalled job count spikes on every deployment.
- Worker process exits with code 0 but active jobs are still listed in BullMQ dashboard.
- `worker.close()` not called before `process.exit()` anywhere in code.

**Phase to address:** Worker implementation phase. Add a shutdown test: send a SIGTERM mid-job and assert the job completes (or re-queues cleanly) with no duplicate.

---

### Pitfall 5: Retry Without Jitter — Thundering Herd Crushes Recovery

**What goes wrong:**
When Postgres goes down and all in-flight jobs fail simultaneously, BullMQ schedules retries at the same backoff interval (e.g., all retry in exactly 5 seconds). They all hit the database at the same time during recovery, overwhelming the recovering instance and triggering another failure wave. The queue then oscillates between short bursts and total failure — the "thundering herd."

**Why it happens:**
Backoff is configured as a fixed delay (`attempts: 5, backoff: { type: 'fixed', delay: 5000 }`). No randomness added. All jobs have identical retry schedules because they all failed within the same second.

**How to avoid:**
- Use `type: 'exponential'` backoff in BullMQ job options. BullMQ's exponential type adds some spread, but add application-level jitter on top.
- Formula: `delay = Math.min(baseDelay * 2^attempt, maxDelay) + Math.random() * jitterWindow`.
- Cap maximum delay at 30–60 seconds for the demo (prevents jobs being invisible for too long in live demos).
- Cap `attempts` at 5–7 for transient errors. Never set `attempts: 0` (unlimited) — poison messages will retry forever (see Pitfall 6).

**Warning signs:**
- Monitoring shows retry spikes that are perfectly synchronized (all retrying at :05, :10, :20 past the minute).
- Database CPU spikes in 30-second bursts rather than smooth load.
- Queue processed-per-second oscillates between 0 and spike rather than smooth curve.

**Phase to address:** Resilience phase. Test with: kill Postgres → wait 10 seconds → restart Postgres → measure how smoothly the queue recovers.

---

### Pitfall 6: Infinite Retry / Poison Messages Never Reaching DLQ

**What goes wrong:**
A job with a schema mismatch, corrupt payload, or logic bug fails on every attempt. If `attempts` is set high (or 0/unlimited), the job retries indefinitely, consuming worker capacity, spamming logs, and masking real failures. The job never reaches the DLQ, so the operator never sees it in the dashboard. In a portfolio demo, this looks like the system is "stuck" — queue depth grows, throughput drops.

**Why it happens:**
Developers set high retry counts for availability ("we don't want to lose jobs") without distinguishing between *transient* errors (network blip, DB timeout) and *permanent* errors (malformed payload, business rule violation). All failures look the same in code.

**How to avoid:**
- Categorize errors explicitly in the job processor:
  - `TransientError` → throw, let BullMQ retry with backoff.
  - `PermanentError` (validation failure, schema mismatch) → `job.moveToFailed(error, token)` immediately, skip retries.
- Set `attempts: 5` maximum for transient errors. After exhausting retries, BullMQ automatically moves the job to the failed set (your DLQ).
- Test: enqueue a job with a deliberately malformed payload and assert it appears in the failed set within N seconds, not after N × max_attempts seconds.

**Warning signs:**
- A single job's `attemptsMade` counter climbing above 3 for a payload that has never changed.
- Worker logs showing the same `job.id` failing with the same error repeatedly.
- DLQ empty while queue is stuck — means jobs are retrying but never graduating to failed.

**Phase to address:** Resilience phase (retry logic) + Worker implementation (error classification).

---

### Pitfall 7: Circuit Breaker Applied to Wrong Dependency — Guarding Own Database

**What goes wrong:**
The circuit breaker is wrapped around the PostgreSQL write inside the worker. When Postgres goes down, the breaker opens and stops all DB writes — but it also stops the worker from *acknowledging* jobs, causing them all to stall. When the breaker half-opens, it lets one job through, which fails, causing the breaker to re-open immediately (flapping). The system never recovers without manual intervention.

**Why it happens:**
Postgres is the most visible failure point so developers wrap it with a circuit breaker. But Postgres is an *internal* dependency — if it's down, you want to *retry* (with backoff), not open a circuit breaker. Circuit breakers are designed to protect against external services that you do not control and that may be persistently degraded.

**How to avoid:**
- Apply the circuit breaker to the **mock external CRM sync** call — the call that fires after the event is stored. This is the correct external dependency.
- For Postgres: use retry-with-backoff, not circuit breaker. Postgres outages are expected to be transient; the queue absorbs the backpressure.
- Flap prevention: set a minimum `resetTimeout` (half-open probe interval) of at least 10–15 seconds. In the half-open state, allow only 1 probe request before deciding to reopen or close.
- Use opossum v9 (Node 20+ compatible, released June 2025) — the most actively maintained circuit breaker library for Node.js.
- Test half-open recovery: open the breaker, wait for `resetTimeout`, assert one probe goes through, then assert full traffic resumes after success.

**Warning signs:**
- Circuit breaker opens on database errors (should only open on external sync calls).
- Breaker opens and re-opens repeatedly within the same 30-second window (flapping).
- Worker queue stalls completely when breaker is open (instead of just skipping sync calls).

**Phase to address:** Resilience phase. Circuit breaker implementation must come after DLQ is working (so failed sync calls have a landing zone).

---

### Pitfall 8: DLQ with No Context, No Monitoring, No Re-Queue Path

**What goes wrong:**
The DLQ is implemented as a second BullMQ queue called `failed-events` (or just the default BullMQ failed set). Jobs arrive with only an error message. The dashboard shows "17 failed jobs" but the operator cannot tell: Which source sent them? Which normalization step failed? What was the original payload? There is no alert when jobs land in the DLQ. Re-queuing is done by hand in the Redis CLI. Under the live demo scenario, the operator panics and the demo narrative breaks.

**Why it happens:**
DLQ is treated as a bin, not a workflow step. It is added at the end of development and never tested under real failure conditions. BullMQ does not have a built-in DLQ — the failed set IS the DLQ — and developers do not add the metadata needed to make it useful.

**How to avoid:**
- When moving a job to failed, preserve: original payload, error message + stack trace, attempt count, failure timestamp, source channel, trace/correlation ID.
- Add a `failedReason` structured field to the job data (not just BullMQ's default `failedReason` string — write a JSON object).
- Dashboard: show DLQ list with full error detail, expandable payload, and a one-click "re-queue" button that calls `job.retry()`.
- Alert: emit a metric/log on every DLQ landing. In CI, assert that a forced-failure job appears in the DLQ within 5 seconds.
- Re-queue must be idempotent: re-queuing an already-processed job (e.g., if re-queue was clicked twice) must not double-process (relies on Pitfall 3 being fixed).
- Test the full path: inject failure → job lands in DLQ → click re-queue in dashboard → assert event appears in DB exactly once.

**Warning signs:**
- DLQ entries lack original payload or structured error info.
- No metric/log emitted when a job enters the DLQ.
- Re-queue button in dashboard does not exist or is not tested.
- Manual re-queue creates a second DB row (idempotency guard not covering re-queued jobs).

**Phase to address:** Resilience phase + Dashboard phase. DLQ UI is not cosmetic — it is part of the demo's core narrative.

---

### Pitfall 9: The "0% Data Loss" Claim — Delivery-Guarantee Dishonesty

**What goes wrong:**
The portfolio README or demo script claims "zero data loss." A senior interviewer asks: "What happens if Redis crashes between the Fastify 202 response and the job being written to Redis?" or "What happens if your worker processes a job, writes to Postgres, but crashes before acknowledging — does BullMQ retry? Does that create a duplicate?" The candidate freezes or gives an inconsistent answer. Credibility collapses.

**The precise failure modes that CAN still lose data (or cause duplicates):**

1. **Redis crash after HTTP 202, before job persisted:** The event is acknowledged to the sender but never queued. The job is gone unless the sender retries. Mitigation: Redis AOF persistence (`appendonly yes`) makes this window milliseconds, not minutes. On Upstash, persistence is managed.
2. **Worker completes job, writes to Postgres, but crashes before calling `job.moveToCompleted`:** BullMQ will stall and re-queue the job. The job processes twice. Mitigation: idempotency guard (Pitfall 3) absorbs the duplicate.
3. **External sync call succeeds, but worker crashes before the job is completed:** The mock CRM receives the event, but BullMQ re-queues. On retry, the circuit breaker may stop the duplicate sync — but only if it tracks per-event state, not just aggregate failure rate. Mitigation: make the mock CRM endpoint idempotent too.
4. **DLQ job expires without being re-queued:** In BullMQ, failed jobs in the failed set persist in Redis as long as Redis data persists. But if Redis is wiped (free-tier data loss, instance replacement), DLQ jobs are lost. Mitigation: periodically archive DLQ entries to Postgres.

**Correct framing (use this in interviews):**
> "OmniSync provides **at-least-once delivery with idempotent processing**. Once a webhook is acknowledged with HTTP 202, the event is durably queued in Redis with AOF persistence. The worker processes it at-least-once and uses a PostgreSQL unique constraint as the idempotency guard, so duplicates are absorbed. Truly zero data loss would require two-phase commit across the HTTP acknowledgement and the Redis write — which is theoretically impossible without the sender retrying on timeout. What OmniSync eliminates is **silent loss**: every failure is either retried with backoff, caught by the DLQ, or surfaced as an observable error."

**Warning signs:**
- README says "zero data loss" without qualification.
- Demo script does not address the "what if Redis dies between 202 and enqueue?" question.
- No Redis AOF persistence configured.
- DLQ entries not archived to Postgres (all resilience state lives only in Redis).

**Phase to address:** Documentation / demo prep phase. Also: Redis persistence config in infrastructure phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Redis-only idempotency (no Postgres constraint) | Faster to implement | Cache eviction → silent duplicate processing; breaks demo's core claim | Never — Postgres constraint is 5 lines of SQL |
| `attempts: 0` (unlimited retries) | No job ever "lost" to retry exhaustion | Poison messages fill queue forever; DLQ never receives entries; worker throughput collapses | Never |
| Skipping graceful shutdown | Simpler worker code | Every deploy creates stalled jobs; idempotency pressure on every restart | Never in a reliability-showcase project |
| Mock external CRM as a no-op (no failure simulation) | Simpler local dev | Circuit breaker has no real failure to guard; demo narrative collapses | MVP only, must be replaced before demo |
| Hardcoded retry config (no per-error-type distinction) | Simpler code | Permanent errors retry endlessly; DLQ receives no entries | MVP acceptable if error classification is added in resilience phase |
| DLQ as Redis failed set only (no Postgres archival) | No extra schema | Free-tier Redis reset → all DLQ history gone; can't reconstruct failure audit | Acceptable until infrastructure phase; must archive before demo |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Upstash Redis + BullMQ | Default BullMQ polling (~1 req/second) exhausts 500K/month free-tier commands in ~6 days | Use blocking commands (`BRPOP`) or reduce `drainDelay`; monitor command count daily |
| Neon / Supabase Postgres + Prisma | Opening one PrismaClient per worker instance or per job; free tier has ~97 connection limit on smallest compute | Singleton PrismaClient per process; use Prisma connection pool URL (via Supabase's Supavisor or Neon's PgBouncer) |
| Cloud Run / serverless + BullMQ worker | Scale-to-zero kills the persistent worker; queue backs up indefinitely while worker is cold | Do not run BullMQ workers on serverless; use Railway background worker service or Render Worker (paid) or a single Fly.io VM |
| Docker + Redis `maxmemory-policy` | Host Redis uses default eviction; Docker Compose doesn't set it | Add `command: redis-server --maxmemory-policy noeviction` in `docker-compose.yml` |
| Fastify + raw `req.body` for HMAC verification | Body parser consumes the raw bytes before signature verification; HMAC fails | Use `addContentTypeParser` with raw buffer; verify HMAC before parsing JSON |
| Prisma + long-running transactions | Transaction holds a connection for the full normalization duration; under concurrent load, connection pool exhausts | Keep transactions short (insert + idempotency check only); normalization logic outside the transaction |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous JSON schema validation (Zod) inside the BullMQ processor | Worker throughput drops under load; Node event loop blocked | Validate at ingestion (Fastify route); pass pre-validated payload to queue | At ~500 events/sec |
| One Redis connection per BullMQ Queue instance | Redis connection count grows linearly with queues × workers; free-tier Upstash connection limit hit | Share one IORedis connection across all BullMQ instances or use `connection` option to pass shared client | At 5+ queue types × 3 workers |
| No `concurrency` setting on BullMQ Worker | Worker processes 1 job at a time; throughput bottlenecked by single job latency | Set `concurrency: 5–20` based on I/O-bound work; measure with load test | Always — latency × 1 limits throughput |
| SELECT-then-INSERT idempotency check (not atomic) | Duplicate rows under concurrent load; only catches 1-at-a-time duplicates | Use `INSERT ... ON CONFLICT DO NOTHING` (atomic) | At any concurrency > 1 |
| Unbounded `failedJobsHistoryCount` in BullMQ | Redis memory grows indefinitely with DLQ entries | Set `failedJobsHistoryCount: 1000` and archive old entries to Postgres | At ~10K failed jobs |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| String equality (`===`) for HMAC signature comparison | Timing attack: attacker can guess signature byte-by-byte | Use `crypto.timingSafeEqual()` in Node.js — mandatory, not optional |
| No replay attack window on webhook signatures | Attacker replays a valid signed request days later | Reject requests with `timestamp` header older than 5 minutes; combine with idempotency fingerprint |
| Storing mock webhook secrets in `.env` committed to git | Secret exposure in public portfolio repo | Use `.env.example` with placeholder values; real secrets in `.env` (gitignored); use Docker secrets or platform env vars |
| Job data stored in Redis contains raw PII from webhook payload | Free-tier Redis may be multi-tenant on some providers | Strip or hash PII fields before enqueuing; store only normalized, non-sensitive fields |
| No rate limiting on ingestion endpoint | Attacker floods ingestion endpoint, exhausting Upstash command quota | Add `@fastify/rate-limit` on the ingestion route; return 429 after threshold |

---

## "Looks Done But Isn't" Checklist

- [ ] **Idempotency:** Redis deduplication exists but Postgres unique constraint is missing — verify with `\d events` in psql showing `UNIQUE (fingerprint)`.
- [ ] **Stall handling:** Worker has retry config but no graceful shutdown — verify `worker.close()` is called in SIGTERM handler.
- [ ] **Circuit breaker:** Breaker wraps Postgres writes (wrong) instead of external sync calls — verify by reading the code path: circuit breaker should only wrap the mock CRM client.
- [ ] **DLQ:** Failed jobs land in BullMQ failed set but no metric is emitted and no dashboard entry appears — verify by forcing a failure and watching the dashboard.
- [ ] **Re-queue:** Dashboard "re-queue" button calls `job.retry()` but re-queued job creates a duplicate DB row — verify with: force fail → re-queue → assert `SELECT COUNT(*) = 1`.
- [ ] **Redis eviction:** `noeviction` documented but not actually set — verify with `redis-cli CONFIG GET maxmemory-policy` returning `noeviction`.
- [ ] **Backoff jitter:** BullMQ `type: 'exponential'` set but no jitter — verify retry timestamps in logs are not synchronized.
- [ ] **Delivery-guarantee framing:** README says "0% data loss" without qualification — verify README uses the "at-least-once + idempotent" framing.
- [ ] **Upstash quota:** Command quota not monitored — verify Upstash dashboard shows daily command count well below 16,700/day limit.
- [ ] **Load test:** System described as "high throughput" but no load test exists — verify `k6` or Autocannon script in repo that proves the throughput claim.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Redis evicted jobs (wrong eviction policy discovered late) | HIGH | Set `noeviction`; replay events from source sender logs or webhook delivery logs; accept gap for events with no sender log |
| Duplicate rows from broken idempotency | MEDIUM | Identify duplicates by fingerprint; delete all but the first `created_at`; add unique constraint; re-run missed downstream syncs |
| Poison messages stuck in retry loop | LOW | Identify by `attemptsMade` > 3 with identical error; call `job.moveToFailed()` manually; move to DLQ; investigate root cause |
| DLQ jobs lost due to Redis wipe | HIGH | Restore from Postgres archival (if implemented); otherwise reconstruct from source sender retry logs; gap is permanent if neither exists |
| Circuit breaker stuck open (flapping) | LOW | Manually call `breaker.close()` via an admin endpoint; fix underlying dependency; increase `resetTimeout` to prevent re-flap |
| Thundering herd on DB recovery | MEDIUM | Temporarily reduce worker `concurrency` setting; increase backoff `delay`; bring DB to steady state; restore concurrency gradually |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Redis eviction → job loss | Infrastructure / Queue setup | Startup assertion: `CONFIG GET maxmemory-policy === noeviction`; integration test: fill Redis memory and assert queue survives |
| Stalled jobs → double processing | Worker implementation | Integration test: block event loop intentionally for >lockDuration; assert job re-queues and processes exactly once (idempotency absorbs it) |
| Check-then-act race → duplicates | Data model (schema) phase | Concurrent load test: 50 identical webhooks simultaneously → assert 1 DB row |
| No graceful shutdown → orphaned jobs | Worker implementation | Test: send SIGTERM mid-job; assert job completes or re-queues cleanly; no duplicate in DB |
| Retry without jitter → thundering herd | Resilience phase (retry config) | Kill Postgres; watch retry timing in logs; assert retries are spread across a window, not synchronized |
| Infinite retry / no DLQ graduation | Resilience phase | Force permanent error; assert job appears in failed set within 5 × backoff, not sooner |
| Circuit breaker on wrong dependency | Resilience phase | Code review gate: breaker wraps only mock CRM calls; kill Postgres and assert breaker does NOT open |
| DLQ without context or monitoring | Resilience + Dashboard phase | Force failure; assert DLQ entry has structured JSON with trace ID, original payload, error detail |
| "0% data loss" framing | Documentation / demo prep | README review: must use "at-least-once + idempotent" language; demo script must have prepared answer for "what if Redis crashes?" |
| Upstash quota exhaustion | Infrastructure phase | Monitor command count after 24 hours of load test; must be < 16,700/day on free tier |
| Connection pool exhaustion | Infrastructure / Worker phase | Load test: run 20 concurrent workers; assert no "Max client connections" errors in Postgres logs |
| Scale-to-zero kills worker | Hosting decision phase | Verify chosen hosting platform supports always-on background workers; Cloud Run is explicitly incompatible |

---

## Sources

- [BullMQ Stalled Jobs — Official Docs](https://docs.bullmq.io/guide/workers/stalled-jobs) — HIGH confidence
- [BullMQ Going to Production — Official Docs](https://docs.bullmq.io/guide/going-to-production) — HIGH confidence (noeviction requirement, graceful shutdown, reconnection config)
- [BullMQ Important Notes — Official Docs](https://docs.bullmq.io/bull/important-notes) — HIGH confidence
- [BullMQ eviction policy Issue #2737](https://github.com/taskforcesh/bullmq/issues/2737) — HIGH confidence (community-confirmed bug report)
- [OneUptime: How to Handle Stalled Jobs in BullMQ](https://oneuptime.com/blog/post/2026-01-21-bullmq-stalled-jobs/view) — MEDIUM confidence (verified against official docs)
- [OneUptime: How to Handle Worker Crashes in BullMQ](https://oneuptime.com/blog/post/2026-01-21-bullmq-worker-crashes-recovery/view) — MEDIUM confidence
- [Sequin Blog: No Such Thing as Exactly-Once Delivery](https://blog.sequinstream.com/at-most-once-at-least-once-and-exactly-once-delivery/) — HIGH confidence (mathematically correct, widely cited)
- [System Design Classroom: Dead Letter Queues Are Not Your Safety Net](https://newsletter.systemdesignclassroom.com/p/dead-letter-queues-are-not-your-safety-net) — MEDIUM confidence
- [Hookdeck: How to Implement Webhook Idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) — MEDIUM confidence
- [Svix: Idempotency and Deduplication](https://www.svix.com/resources/webhook-university/reliability/idempotency-and-deduplication/) — MEDIUM confidence
- [BullMQ Delivery Clarification Discussion #2223](https://github.com/taskforcesh/bullmq/discussions/2223) — HIGH confidence
- [Redis Eviction Policy — Official Redis Docs](https://redis.io/docs/latest/operate/rs/databases/memory-performance/eviction-policy/) — HIGH confidence
- [Upstash Redis Pricing and Limits](https://upstash.com/docs/redis/overall/pricing) — HIGH confidence (500K commands/month, 256 MB free tier)
- [Opossum: Node.js Circuit Breaker](https://github.com/nodeshift/opossum) — HIGH confidence (v9 released June 2025, Node 20+ only)
- [Redis Labs: Managing Connection Surges and Reconnect Storms](https://support.redislabs.com/hc/en-us/articles/29905470061202-Managing-Connection-Surges-and-Reconnect-Storms) — MEDIUM confidence
- [Render vs Railway Free Tier Comparison 2025](https://www.freetiers.com/blog/render-vs-railway-comparison) — MEDIUM confidence (always-on worker hosting)
- [Neon Connection Pooling — Official Docs](https://neon.com/docs/connect/connection-pooling) — HIGH confidence
- [Prisma + Supabase — Official Docs](https://www.prisma.io/docs/guides/supabase-accelerate) — HIGH confidence

---
*Pitfalls research for: Distributed webhook-ingestion / queue-worker / CDP (OmniSync)*
*Researched: 2026-06-01*
