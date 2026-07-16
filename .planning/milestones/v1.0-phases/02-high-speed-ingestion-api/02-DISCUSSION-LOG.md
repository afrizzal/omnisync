# Phase 2: High-Speed Ingestion API - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 02-high-speed-ingestion-api
**Areas discussed:** Webhook secret management, 422 error response shape, Tests in Phase 2, /healthz endpoint

---

## Webhook Secret Management

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source secrets (Recommended) | WEBHOOK_SECRET_SHOPEE, WEBHOOK_SECRET_TOKOPEDIA, WEBHOOK_SECRET_META_ADS, WEBHOOK_SECRET_CRM — validated fail-fast at startup | ✓ |
| Single global secret | One WEBHOOK_SECRET env var for all sources | |
| You decide | Claude picks | |

**User's choice:** Per-source secrets — all four env vars required, Zod-validated at startup. Unknown source or missing secret → 401, no leak of source validity, never 500.

---

## Signature Header Format

| Option | Description | Selected |
|--------|-------------|----------|
| X-Webhook-Signature: sha256=<hex> (Recommended) | GitHub-style, widely recognized | ✓ |
| X-Omnisync-Signature: <hex> | Custom header, raw hex | |
| You decide | Claude picks | |

**User's choice:** `X-Webhook-Signature: sha256=<hex>`. HMAC-SHA256 over raw body bytes (not parsed JSON). Compare with `crypto.timingSafeEqual`. Malformed/missing header or prefix → 401.

---

## 422 Error Response Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Field-level errors (Recommended) | { error: 'VALIDATION_ERROR', issues: [{field, message}] } via z.flattenError() | ✓ |
| Single message only | { error: 'VALIDATION_ERROR', message: 'Invalid payload' } | |
| You decide | Claude picks | |

**User's choice:** `{ error: 'VALIDATION_ERROR', issues: [{field, message}] }` via `z.flattenError()`. Never leak raw Zod internals or stack traces.

---

## Error Envelope Consistency

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — consistent envelope (Recommended) | All errors use { error, message }; 422 adds issues[] | ✓ |
| No — each status its own shape | 401 minimal, 422 full Zod | |
| You decide | Claude picks | |

**User's choice:** Shared envelope. Base: `{ error: 'ERROR_CODE', message: string }`. Implement once via `fastify.setErrorHandler()` (DRY, covers 401/404/422/500). Error codes machine-readable, message human-readable.

---

## Tests in Phase 2

| Option | Description | Selected |
|--------|-------------|----------|
| Unit tests only | HMAC verify + fingerprint hashing | |
| Unit + light route tests (Recommended) | Unit + app.inject() route tests, zero real infra, mocked queue/redis | ✓ |
| Defer all to Phase 6 | No tests in Phase 2 | |

**User's choice:** Unit + route inject() tests for all 4 SCs. `buildApp({ queue, redis })` factory pattern. BullMQ and Redis NX gate mocked. Deferred to Phase 6: coverage gate, TST-02, TST-03.

---

## /healthz Endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Include now (Recommended) | GET /healthz → { status: 'ok', uptime } | ✓ |
| Defer to Phase 6 | Skip, add with deployment | |

**User's choice:** Include in Phase 2. Liveness only — no Redis/DB probe. `/readyz` (readiness) deferred to Phase 6.

---

## Claude's Discretion

- Fastify plugin file layout (plugins/, routes/, lib/ directory structure)
- TSX devDependency version, vitest config file location
- rawBody capture implementation (addContentTypeParser vs preParsing hook)
- PORT / HOST env var naming

## Deferred Ideas

- GET /readyz readiness endpoint — Phase 6
- Mock webhook senders (demo script) — Phase 6
- bull-board queue browser — Phase 3 or Phase 6
