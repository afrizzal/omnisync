# Requirements: OmniSync

**Defined:** 2026-06-02
**Core Value:** No accepted event is ever silently lost — once acknowledged (HTTP 202), an event is durably queued and processed at-least-once and idempotently, surviving worker crashes, DB outages, and flaky downstream APIs, with a DLQ as the final safety net.

## v1 Requirements

Full-spec scope (MVP + advanced). Each maps to a roadmap phase.

### Ingestion

- [x] **ING-01**: System accepts webhook events via HTTP POST and returns 202 Accepted in low single-digit milliseconds, before any processing
- [x] **ING-02**: System validates a webhook HMAC/signature and rejects events with an invalid signature
- [x] **ING-03**: System validates payload shape with Zod and rejects malformed events with a structured 4xx error
- [x] **ING-04**: System computes a deterministic idempotency fingerprint (SHA-256 of source + event_type + external_id + occurred_at) for every accepted event
- [x] **ING-05**: System enqueues the validated payload and never persists/processes it synchronously on the request path

### Queue & Workers

- [x] **QUE-01**: Ingestion and processing are decoupled through a Redis-backed BullMQ queue
- [x] **QUE-02**: A separate, always-on worker process (distinct from the API process) consumes events from the queue
- [x] **QUE-03**: Workers process events concurrently with a configurable concurrency limit
- [x] **QUE-04**: Worker normalizes each event into a canonical schema before persistence

### Idempotency

- [x] **IDM-01**: A fast Redis `SET NX` in-flight gate prevents duplicate enqueue of concurrent identical events
- [x] **IDM-02**: A PostgreSQL `UNIQUE(fingerprint)` constraint with `INSERT … ON CONFLICT DO NOTHING` guarantees each event is stored at most once
- [x] **IDM-03**: Re-delivering or re-queuing the same event never creates a duplicate stored record

### Resilience

- [x] **RES-01**: Transient processing failures are retried automatically with jittered exponential backoff up to a max attempt count
- [x] **RES-02**: Events that exhaust retries are moved to a Dead-Letter Queue with the full error trace and original payload
- [x] **RES-03**: DLQ entries are mirrored to a durable PostgreSQL table so DLQ history survives Redis loss
- [x] **RES-04**: A circuit breaker (opossum) wraps the external downstream (mock CRM) sync and opens when its failure rate exceeds a threshold within a time window
- [x] **RES-05**: While the breaker is open, affected events route to retry/DLQ instead of hammering the failing downstream; the breaker recovers via half-open probing
- [x] **RES-06**: An operator can re-queue DLQ items individually and in bulk after a fault is resolved, and reprocessing is idempotent
- [x] **RES-07**: Killing PostgreSQL mid-processing preserves in-flight events in the queue with zero events dropped

### Routing & Transformation

- [x] **RTE-01**: Operators can define event routing/transformation rules (e.g. normalize phone numbers to E.164) stored in the database
- [x] **RTE-02**: Rule changes take effect without redeploying the worker (reloaded/invalidated at runtime)

### Observability

- [ ] **OBS-01**: System emits structured logs for each event lifecycle transition (received, processing, completed, failed, DLQ)
- [ ] **OBS-02**: System exposes metrics for throughput, queue latency, retry counts, and error distribution (OpenTelemetry / BullMQ job-state gauge)

### Dashboard

- [x] **DSH-01**: Dashboard shows live queue and throughput metrics
- [x] **DSH-02**: Dashboard lists failed / DLQ jobs with error detail
- [ ] **DSH-03**: Dashboard provides a one-click re-queue action for a DLQ job
- [ ] **DSH-04**: Dashboard visualizes a live load test (events processed vs. failed over time)

### Testing & Quality

- [ ] **TST-01**: Unit + integration test suite (Vitest) achieves ≥80% line coverage, enforced as a CI gate
- [ ] **TST-02**: Integration test proves queue durability when PostgreSQL is killed mid-process (Testcontainers)
- [ ] **TST-03**: Integration test proves concurrent duplicate webhooks result in exactly one stored record
- [ ] **TST-04**: Playwright E2E test covers the DLQ dashboard re-queue flow

### Ops & Delivery

- [ ] **OPS-01**: GitHub Actions CI runs type-check, tests, and Docker build on every push
- [x] **OPS-02**: API and worker each build as a multi-stage Docker image and run together via docker-compose locally
- [ ] **OPS-03**: The system is deployed to a free-tier host with the always-on worker kept alive and reachable for a live demo
- [ ] **OPS-04**: A load-test/demo script blasts a high volume of synthetic multi-channel events to drive the demo scenario

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Access Control

- **AUTH-01**: Dashboard requires authenticated login
- **AUTH-02**: Role-based access control for operator vs. viewer actions

### Connectors & Intelligence

- **CONN-01**: Replace mock senders with real production connectors (Shopee/Tokopedia/Meta/Dynamics)
- **INTL-01**: Anomaly detection on the inbound event stream
- **SCAL-01**: Horizontal worker autoscaling beyond the demo (and/or multi-region)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real marketplace/CRM integrations (live creds) | Mocks fully demonstrate the resilience story; no real credentials; near-zero cost |
| Kafka / Redpanda / dedicated stream engine | Redis + BullMQ is sufficient at portfolio scale; Kafka adds cost/ops weight without changing the narrative |
| Multi-tenancy & billing | Not part of the infrastructure/resilience story this project exists to prove |
| AI / ML anomaly detection (v1) | Deliberately excluded; AI is already proven by Miracle Intelligence — this is an infra showcase |
| Full auth/RBAC (v1) | Deferred to v2; not the showcase focus |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUE-01 | Phase 1 | Complete |
| OPS-02 | Phase 1 | Complete |
| ING-01 | Phase 2 | Complete |
| ING-02 | Phase 2 | Complete |
| ING-03 | Phase 2 | Complete |
| ING-04 | Phase 2 | Complete |
| ING-05 | Phase 2 | Complete |
| IDM-01 | Phase 2 | Complete |
| QUE-02 | Phase 3 | Complete |
| QUE-03 | Phase 3 | Complete |
| QUE-04 | Phase 3 | Complete |
| IDM-02 | Phase 3 | Complete |
| IDM-03 | Phase 3 | Complete |
| RES-01 | Phase 4 | Complete |
| RES-02 | Phase 4 | Complete |
| RES-03 | Phase 4 | Complete |
| RES-04 | Phase 4 | Complete |
| RES-05 | Phase 4 | Complete |
| RES-06 | Phase 4 | Complete |
| RES-07 | Phase 4 | Complete |
| RTE-01 | Phase 4 | Complete |
| RTE-02 | Phase 4 | Complete |
| OBS-01 | Phase 5 | Pending |
| OBS-02 | Phase 5 | Pending |
| DSH-01 | Phase 5 | Complete |
| DSH-02 | Phase 5 | Complete |
| DSH-03 | Phase 5 | Pending |
| DSH-04 | Phase 5 | Pending |
| TST-01 | Phase 6 | Pending |
| TST-02 | Phase 6 | Pending |
| TST-03 | Phase 6 | Pending |
| TST-04 | Phase 6 | Pending |
| OPS-01 | Phase 6 | Pending |
| OPS-03 | Phase 6 | Pending |
| OPS-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-06-02*
*Last updated: 2026-06-02 — traceability populated after roadmap creation*
