---
phase: 2
slug: high-speed-ingestion-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.8 |
| **Config file** | `apps/api/vitest.config.ts` — does NOT exist yet (Wave 0 creates it) |
| **Quick run command** | `pnpm --filter @omnisync/api exec vitest run` |
| **Full suite command** | `pnpm --filter @omnisync/api exec vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @omnisync/api exec vitest run`
- **After every plan wave:** Run `pnpm --filter @omnisync/api exec vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | ING-01..IDM-01 | setup | `pnpm --filter @omnisync/api exec vitest run` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | ING-04 | unit | `pnpm --filter @omnisync/api exec vitest run tests/lib/fingerprint.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | ING-02 | unit | `pnpm --filter @omnisync/api exec vitest run tests/lib/hmac.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | ING-01 | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | ING-02 | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 2 | ING-03 | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-04 | 03 | 2 | ING-05 | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-05 | 03 | 2 | IDM-01 | integration (inject) | `pnpm --filter @omnisync/api exec vitest run tests/routes/ingest.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/vitest.config.ts` — vitest config with setupFiles pointing to vitest.setup.ts
- [ ] `apps/api/vitest.setup.ts` — env var stubs for DATABASE_URL, DIRECT_URL, REDIS_URL, and all four WEBHOOK_SECRET_* vars
- [ ] `apps/api/tests/lib/fingerprint.test.ts` — unit tests for ING-04 (stability across identical re-deliveries)
- [ ] `apps/api/tests/lib/hmac.test.ts` — unit tests for ING-02 pure function (verifySignature)
- [ ] `apps/api/tests/routes/ingest.test.ts` — route integration tests for ING-01, ING-02, ING-03, ING-05, IDM-01
- [ ] `apps/api/tests/routes/health.test.ts` — smoke test for D-07 /healthz
- [ ] `apps/api/src/types/fastify.d.ts` — module augmentation: `request.rawBody?: Buffer`
- [ ] Add `vitest` and `@vitest/coverage-v8` to `apps/api/package.json` devDependencies
- [ ] Add `"test": "vitest run"` script to `apps/api/package.json`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HTTP 202 response latency under load | ING-01 | "Low single-digit ms" is measured under local load — not expressible in unit tests | Run `pnpm --filter @omnisync/api dev` then `curl -w "%{time_total}" -X POST http://localhost:3001/ingest/SHOPEE ...` and confirm <5ms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
