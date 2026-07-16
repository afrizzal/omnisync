---
phase: 6
slug: testing-ci-cd-deployment
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| 6-01-01 | 01 | 0 | TST-02 | integration (Testcontainers) | `pnpm --filter @omnisync/worker test` | ✅ | ✅ green |
| 6-01-02 | 01 | 0 | TST-04 | E2E (Playwright) | `npx playwright test` | ✅ | ✅ green |
| 6-01-03 | 01 | 0 | OPS-01 | CI (GitHub Actions) | Manual: merge to master | ✅ | ✅ green |
| 6-01-04 | 01 | 0 | OPS-04 | manual smoke | `tsx scripts/loadtest.ts` | ✅ | ✅ green |
| 6-01-05 | 01 | 0 | OPS-03 | manual smoke | `bash scripts/demo.sh` | ✅ | ✅ green |
| 6-02-01 | 02 | 1 | TST-02 | integration | `pnpm --filter @omnisync/worker test` | ✅ | ✅ green |
| 6-03-01 | 03 | 1 | TST-04 | E2E | `npx playwright test` | ✅ | ✅ green |
| 6-04-01 | 04 | 1 | OPS-01 | CI | Manual: PR build check | ✅ | ✅ green |
| 6-05-01 | 05 | 2 | OPS-04 | manual smoke | `tsx scripts/loadtest.ts` | ✅ | ✅ green |
| 6-06-01 | 06 | 2 | OPS-03 | manual smoke | `bash scripts/demo.sh && docker compose up` | ✅ | ✅ green |
| 6-07-01 | 07 | 2 | TST-01 | coverage gate | `pnpm test -- --coverage` | ✅ thresholds set | ✅ green |
| 6-07-02 | 07 | 2 | TST-03 | integration | `pnpm --filter @omnisync/worker test` | ✅ `idempotency.test.ts` | ✅ green |

*Status: ✅ green · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `pnpm add -D testcontainers @testcontainers/postgresql --filter @omnisync/worker` — Testcontainers for TST-02
- [x] `pnpm add -D @playwright/test --workspace-root` — Playwright for TST-04
- [x] `pnpm add autocannon @types/autocannon --workspace-root` — autocannon for OPS-04
- [x] `apps/worker/tests/integration/durability.test.ts` — stub file for TST-02 Testcontainers kill-PG test
- [x] `e2e/playwright.config.ts` — Playwright config (baseURL, retries, workers: 1 in CI)
- [x] `e2e/dlq-requeue.spec.ts` — stub for TST-04 DLQ re-queue E2E flow
- [x] `scripts/loadtest.ts` — stub for OPS-04 autocannon script
- [x] `scripts/demo.sh` — OPS-03 one-command demo entrypoint
- [x] Verify `apps/dashboard/Dockerfile` exists (needed for Playwright E2E compose stack)
- [x] Verify `apps/worker/tests/integration/idempotency.test.ts` and `concurrency.test.ts` use correct 5-arg `buildProcessor` signature (crmClient, crmPolicy, ttlMs stubs) — fix if broken

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved retroactively 2026-07-16 during v1.0 milestone audit — all mapped commands green in CI run 29515250970 (verify + docker + e2e all success; first fully-green run). Wave 0 artifacts verified real by gsd-integration-checker + gsd-verifier (06-VERIFICATION.md).
