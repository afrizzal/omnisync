---
phase: 6
slug: testing-ci-cd-deployment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (`apps/api`, `apps/worker`); Playwright 1.61.0 (`e2e/`) |
| **Config file** | `apps/api/vitest.config.ts`, `apps/worker/vitest.config.ts`, `e2e/playwright.config.ts` (new) |
| **Quick run command** | `pnpm --filter @omnisync/worker test` |
| **Full suite command** | `pnpm test -- --coverage` |
| **E2E command** | `npx playwright test` (requires compose stack running) |
| **Estimated runtime** | ~60 seconds (unit/integration); ~120 seconds (E2E with compose startup) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @omnisync/worker test` (or api as appropriate — no coverage, fast)
- **After every plan wave:** Run `pnpm test -- --coverage` (full coverage gate)
- **Before `/gsd:verify-work`:** Full suite green + `npx playwright test` green (requires compose stack up)
- **Max feedback latency:** 60 seconds (unit/integration); 120 seconds (E2E)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 0 | TST-02 | integration (Testcontainers) | `pnpm --filter @omnisync/worker test` | ❌ W0 gap | ⬜ pending |
| 6-01-02 | 01 | 0 | TST-04 | E2E (Playwright) | `npx playwright test` | ❌ W0 gap | ⬜ pending |
| 6-01-03 | 01 | 0 | OPS-01 | CI (GitHub Actions) | Manual: merge to master | ❌ W0 gap | ⬜ pending |
| 6-01-04 | 01 | 0 | OPS-04 | manual smoke | `tsx scripts/loadtest.ts` | ❌ W0 gap | ⬜ pending |
| 6-01-05 | 01 | 0 | OPS-03 | manual smoke | `bash scripts/demo.sh` | ❌ W0 gap | ⬜ pending |
| 6-02-01 | 02 | 1 | TST-02 | integration | `pnpm --filter @omnisync/worker test` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 1 | TST-04 | E2E | `npx playwright test` | ❌ W0 | ⬜ pending |
| 6-04-01 | 04 | 1 | OPS-01 | CI | Manual: PR build check | ❌ W0 | ⬜ pending |
| 6-05-01 | 05 | 2 | OPS-04 | manual smoke | `tsx scripts/loadtest.ts` | ❌ W0 | ⬜ pending |
| 6-06-01 | 06 | 2 | OPS-03 | manual smoke | `bash scripts/demo.sh && docker compose up` | ❌ W0 | ⬜ pending |
| 6-07-01 | 07 | 2 | TST-01 | coverage gate | `pnpm test -- --coverage` | ✅ thresholds set | ⬜ pending |
| 6-07-02 | 07 | 2 | TST-03 | integration | `pnpm --filter @omnisync/worker test` | ✅ `idempotency.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `pnpm add -D testcontainers @testcontainers/postgresql --filter @omnisync/worker` — Testcontainers for TST-02
- [ ] `pnpm add -D @playwright/test --workspace-root` — Playwright for TST-04
- [ ] `pnpm add autocannon @types/autocannon --workspace-root` — autocannon for OPS-04
- [ ] `apps/worker/tests/integration/durability.test.ts` — stub file for TST-02 Testcontainers kill-PG test
- [ ] `e2e/playwright.config.ts` — Playwright config (baseURL, retries, workers: 1 in CI)
- [ ] `e2e/dlq-requeue.spec.ts` — stub for TST-04 DLQ re-queue E2E flow
- [ ] `scripts/loadtest.ts` — stub for OPS-04 autocannon script
- [ ] `scripts/demo.sh` — OPS-03 one-command demo entrypoint
- [ ] Verify `apps/dashboard/Dockerfile` exists (needed for Playwright E2E compose stack)
- [ ] Verify `apps/worker/tests/integration/idempotency.test.ts` and `concurrency.test.ts` use correct 5-arg `buildProcessor` signature (crmClient, crmPolicy, ttlMs stubs) — fix if broken

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GHCR images pushed on master merge | OPS-01 | GitHub Actions CI job — cannot automate locally | Merge a branch to master; check GitHub Actions workflow run; verify `ghcr.io/afrizzal/omnisync-api`, `omnisync-worker`, `omnisync-mock-crm` appear under Packages |
| Recorded demo walkthrough in README | OPS-03 | Requires screen capture tooling + human judgment on demo quality | Record demo showing (1) load-test driving `/demo` chart, (2) 50→1 dedup result, (3) circuit breaker opening/recovering, (4) kill-PG durability; verify GIF/video asset in README |
| `pnpm demo` / `bash scripts/demo.sh` one-command repro | OPS-03 | Requires Docker daemon + env setup | Run `docker compose up -d`, then `pnpm demo`; assert full pipeline produces events in DB and dashboard shows activity |
| Branch-protection "required check" toggle | OPS-01 | GitHub repo setting (not code) | Navigate to GitHub repo Settings → Branches → Add rule: require CI to pass; document as manual step in plan |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
