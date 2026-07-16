---
phase: 5
slug: dashboard-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 |
| **Config file** | `apps/api/vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @omnisync/api test` |
| **Full suite command** | `pnpm --filter @omnisync/api test:coverage` |
| **Estimated runtime** | ~10 seconds (quick) / ~20 seconds (full with coverage) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @omnisync/api test`
- **After every plan wave:** Run `pnpm --filter @omnisync/api test:coverage`
- **Before `/gsd:verify-work`:** Full suite must be green + manual smoke test of three dashboard pages
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | OBS-02 | Unit | `pnpm --filter @omnisync/api test -- --run tests/routes/metrics.test.ts` | ❌ Wave 0 | ⬜ pending |
| 05-01-02 | 01 | 0 | DSH-02 (list) | Unit | `pnpm --filter @omnisync/api test -- --run tests/routes/dlq-list.test.ts` | ❌ Wave 0 | ⬜ pending |
| 05-01-03 | 01 | 0 | OBS-01 | Unit | `pnpm --filter @omnisync/api test -- --run tests/routes/ingest.test.ts` | ✅ (new assertion) | ⬜ pending |
| 05-02-xx | 02 | 1 | DSH-01 (scaffold) | Manual | Dashboard renders at `http://localhost:3000/dashboard` | N/A | ⬜ pending |
| 05-03-xx | 03 | 1 | DSH-01 | Manual | Metrics cards update every 3s without page reload | N/A | ⬜ pending |
| 05-04-xx | 04 | 1 | DSH-02/DSH-03 | Manual | DLQ table shows entries; Re-queue button triggers reprocessing | N/A | ⬜ pending |
| 05-05-xx | 05 | 1 | DSH-04 | Manual | Demo page chart appends data points on each poll | N/A | ⬜ pending |
| 05-06-xx | 06 | 1 | OBS-02 (bull-board) | Manual | `/admin/queues` shows live BullMQ job browser | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/tests/routes/metrics.test.ts` — covers OBS-02 (`GET /api/metrics` returns `{ queue, events, dlq, throughput }` JSON shape)
- [ ] `apps/api/tests/routes/dlq-list.test.ts` — covers `GET /api/dlq` list endpoint (returns `{ entries: [...] }` with correct fields)
- [ ] New assertion in `apps/api/tests/routes/ingest.test.ts` — covers OBS-01 (`[ingest] received` log emitted after enqueue)

*Existing infrastructure (vitest config, setup, env mocking) covers all wave 0 scaffolding needs — no new config files required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard metrics cards update live | DSH-01 | React polling UI — not covered by unit tests until Phase 6 Playwright | Run `docker compose up`, fire a webhook via curl, observe `/dashboard` cards update within 3s |
| DLQ Re-queue button triggers reprocessing | DSH-03 | UI interaction requiring DB state — Phase 6 Playwright covers this | Seed a DLQ entry, load `/dlq`, click Re-queue, verify row disappears / resolves |
| Demo page chart accumulates data points | DSH-04 | Live Recharts AreaChart — visual only | Start load test, open `/demo`, verify chart draws two area series over time |
| Bull-Board queue browser loads | OBS-02 | Third-party UI rendered by `@bull-board/fastify` — outside unit test scope | Navigate to `http://localhost:3001/admin/queues` and verify job list renders |
| System-aware dark/light theme | UX | CSS / class toggle — no unit test needed | Toggle OS theme preference, verify dashboard switches without flash |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
