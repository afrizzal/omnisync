---
phase: 06-testing-ci-cd-deployment
plan: "05"
subsystem: testing
tags: [playwright, e2e, github-actions, docker-compose, dlq, ci]

requires:
  - phase: 06-01
    provides: "e2e/playwright.config.ts, e2e/dlq-requeue.spec.ts stub, dashboard Dockerfile, docker-compose dashboard service"
  - phase: 06-04
    provides: "ci.yml docker job — e2e appended as sibling, not replacement"
  - phase: 05-02
    provides: "DLQ page /dlq with 'Re-queue Job' button and 'Re-queued successfully.' feedback"
  - phase: 04-04
    provides: "requeueDlqEntry service that sets resolved=true on success"

provides:
  - "TST-04: Playwright E2E test that clicks Re-queue Job on a seeded DLQ entry and confirms it resolves out of the queue"
  - "e2e CI job: full docker compose stack -> seed DLQ -> playwright headless -> artifact upload -> teardown"

affects:
  - 06-06 (deployment/release plan — e2e CI is a gate for deploy confidence)

tech-stack:
  added: []
  patterns:
    - "External-stack Playwright: no webServer block; CI starts compose externally before running playwright test"
    - "Deterministic DLQ seeding: POST /admin/failure-mode rate=1 + signed shopee webhook -> retries exhaust -> dlq_events row"
    - "Poll-before-test: CI polls /api/dlq until entries.length >= 1 (timeout 120s) to prevent Playwright race condition"
    - "Post-requeue assertion via expect.poll on /api/dlq — no new API endpoint needed; resolved=true filters row from response"

key-files:
  created:
    - e2e/dlq-requeue.spec.ts
    - .planning/phases/06-testing-ci-cd-deployment/06-05-SUMMARY.md
  modified:
    - .github/workflows/ci.yml
    - package.json

key-decisions:
  - "Option A assertion (poll GET /api/dlq for fingerprint absence) chosen over Option B (direct DB query) — no new API endpoint needed; resolved=true already filters the row; proven by TST-03"
  - "DLQ seeding via mock-crm fail mode + real signed webhook over direct DB insert — proves the full ingestion->worker->DLQ path, not just the UI layer"
  - "CI polls /api/dlq with timeout 120s before playwright runs — prevents seeding race where Playwright loads /dlq before retries exhaust"
  - "HMAC signed using openssl dgst -hmac with printf (no trailing newline) — matches Node.js createHmac().update(body) exactly"

patterns-established:
  - "E2E test assumes seeded data exists (CI job seeds deterministically before Playwright); test does not perform seeding itself"
  - "Artifact upload (playwright-report/, test-results/, compose-logs.txt) always runs, teardown (compose down -v) always runs"

requirements-completed: [TST-04]

duration: 15min
completed: "2026-06-21"
---

# Phase 06 Plan 05: Playwright E2E DLQ Re-queue Test + CI Job Summary

**Headless Playwright E2E test proves the DLQ re-queue operator path end-to-end: seeded via mock-crm fail mode + signed webhook, verified via /api/dlq polling, integrated into a dedicated CI job over the full docker compose stack.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-21T03:10:00Z
- **Completed:** 2026-06-21T03:25:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced `test.skip` stub with a full Playwright spec driving the DLQ re-queue flow: loads `/dlq`, waits for a seeded row, captures fingerprint, clicks "Re-queue Job", asserts "Re-queued successfully." text, then polls `/api/dlq` until the fingerprint is absent
- Added an `e2e` CI job to `.github/workflows/ci.yml` that: starts the full docker compose stack, seeds a DLQ entry deterministically (mock-crm fail mode + HMAC-signed shopee webhook), polls `/api/dlq` until the entry appears, runs Playwright headlessly, uploads artifacts, and tears down — all gated on the `verify` job
- Added convenience `test:e2e` script to root `package.json`

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement e2e/dlq-requeue.spec.ts (TST-04 DLQ re-queue flow)** - `bf51707` (feat)
2. **Task 2: Add the e2e CI job (compose up -> seed DLQ -> Playwright -> teardown)** - `a41b87c` (feat)

**Plan metadata:** (docs commit — see final commit below)

## Files Created/Modified

- `e2e/dlq-requeue.spec.ts` - Real Playwright test: loads /dlq, clicks "Re-queue Job", asserts "Re-queued successfully." and polls /api/dlq until fingerprint absent
- `.github/workflows/ci.yml` - New `e2e` job appended: compose up -> seed -> poll DLQ -> playwright -> artifacts -> compose down
- `package.json` - Added `test:e2e` convenience script

## Decisions Made

- **Option A assertion (poll /api/dlq for fingerprint absence):** No new API endpoint needed. `requeueDlqEntry` already sets `resolved=true`, and `GET /api/dlq` already filters `resolved=false` rows. Confirmed behavior from TST-03 (IDM-02).
- **Deterministic DLQ seeding via ingestion path:** Seeding via POST /admin/failure-mode + real signed shopee webhook exercises the full ingestion->worker->retry->DLQ path rather than a direct DB insert shortcut — more valuable as a portfolio demo.
- **CI polls before Playwright:** The 120s poll on `/api/dlq` (3s intervals) prevents the Playwright test from running before retries exhaust (typically 15-40s). This is the key race condition (Pitfall 3 from RESEARCH.md).
- **HMAC via `openssl dgst -hmac` + `printf '%s'`:** Matches Node.js `createHmac("sha256", secret).update(body)` exactly. `printf '%s'` avoids trailing newline; `sed 's/^.* //'` strips the `(stdin)= ` prefix from openssl output.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Worktree branch was created from the initial commit (only `README.md`). Required merging `master` branch into the worktree branch before any work could begin, to bring in all project files and the Phase 6 stub files (e2e directory, playwright.config.ts, etc.).

## Known Stubs

None — no stubs in the delivered files. The test is fully implemented; it will only pass when run against a live compose stack with a seeded DLQ entry.

## Next Phase Readiness

- TST-04 E2E requirement complete; CI now validates the full DLQ re-queue operator path on every push
- Plan 06-06 (deployment/release) is the final plan — e2e CI green gate provides deploy confidence
- No blockers

---
*Phase: 06-testing-ci-cd-deployment*
*Completed: 2026-06-21*
