---
phase: 06-testing-ci-cd-deployment
plan: 03
subsystem: infra
tags: [autocannon, loadtest, hmac, demo, docker-compose, bash, ops]

requires:
  - phase: 06-01
    provides: autocannon/tsx deps installed, loadtest.ts and demo.sh stubs created, WEBHOOK_SECRET_* seeded in .env.example

provides:
  - OPS-04: scripts/loadtest.ts — autocannon multi-channel blaster with real per-source HMAC signatures through /ingest
  - OPS-03: scripts/demo.sh — one-command docker compose up + health-wait + load test entrypoint
  - pnpm demo script in root package.json

affects: [06-02, 06-04, 06-05, 06-06]

tech-stack:
  added: []
  patterns:
    - "autocannon setupRequest callback for per-request unique externalId + fresh HMAC (prevents fingerprint dedup collapse)"
    - "set -a; source .env; set +a pattern for exporting all .env vars to child processes in bash scripts"
    - "timeout + curl polling loop for compose service health-wait in shell scripts"

key-files:
  created: []
  modified:
    - scripts/loadtest.ts
    - scripts/demo.sh
    - package.json

key-decisions:
  - "meta_ads used as URL path segment (server uppercases to META_ADS matching SECRET_BY_SOURCE key) — not 'meta'"
  - "setupRequest generates unique externalId = load-${Date.now()}-${random} per request so events are not all deduped to one fingerprint"
  - "Non-2xx responses surface as a warning (not exit 1) since 401/422 indicate signing/secret bugs worth knowing about, not transport failure"
  - "demo.sh sources .env with set -a / set +a before docker compose up so WEBHOOK_SECRET_* are visible to host-run tsx scripts/loadtest.ts"
  - "demo.sh guards on missing .env before any docker/network operations to fail fast with actionable message"

requirements-completed: [OPS-04, OPS-03]

duration: 7min
completed: 2026-06-21
---

# Phase 06 Plan 03: Load Test + Demo Entrypoint Summary

**autocannon multi-channel blaster (shopee/tokopedia/meta_ads/crm) signing each request with real per-source HMAC via x-webhook-signature, plus one-command pnpm demo entrypoint wiring docker compose + health-wait + load test**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-21T02:34:12Z
- **Completed:** 2026-06-21T02:41:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- OPS-04: `scripts/loadtest.ts` replaced stub with a real autocannon blaster covering all four webhook sources, each using its own WEBHOOK_SECRET_* for HMAC signing via `x-webhook-signature`, with `setupRequest` generating a unique `externalId` per request to avoid BullMQ fingerprint dedup collapse — exercises the genuine `/ingest` validation path end-to-end
- OPS-03: `scripts/demo.sh` replaced stub with full one-command entrypoint: .env guard → `source .env` → `docker compose up --build -d` → health-wait on :3001 and :3000 → `tsx scripts/loadtest.ts` → post-demo instructions
- Root `package.json` gains `"demo": "bash scripts/demo.sh"` — reviewers can `pnpm demo` with zero additional setup beyond Docker + .env

## Task Commits

Each task was committed atomically:

1. **Task 1: OPS-04 autocannon multi-channel load test** - `43cc211` (feat)
2. **Task 2: OPS-03 demo entrypoint + pnpm demo script** - `9e260c6` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `scripts/loadtest.ts` — autocannon blaster; four sources with per-source HMAC, setupRequest per-request unique body, configurable via env vars, non-2xx warning, exit 1 only on transport errors
- `scripts/demo.sh` — one-command demo: .env export, compose up, healthz+dashboard poll, load test, post-demo instructions; executable bit set via git update-index
- `package.json` — added `"demo": "bash scripts/demo.sh"` to scripts block

## Decisions Made

- `meta_ads` is the correct URL path segment (server uppercases to `META_ADS` to match `SECRET_BY_SOURCE` key in `secrets.ts`) — confirmed by reading source; plan interfaces noted this correctly
- `setupRequest` pattern chosen over static request body to ensure each request generates a fresh `externalId` and timestamp, preventing all load-test events from sharing the same fingerprint and being deduplicated to a single DB row
- `set -a; source .env; set +a` used in demo.sh so all `.env` variables (including `WEBHOOK_SECRET_*`) are exported as environment variables for the child `tsx scripts/loadtest.ts` process

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Worktree was on initial commit (`80b410a`) without source files — merged from master before beginning work. Standard worktree startup procedure; no code impact.
- Biome binary not accessible directly from worktree (node_modules not installed there); used tsc directly to confirm `scripts/loadtest.ts` type-checks clean, and confirmed file follows project formatting patterns. Full `pnpm typecheck` passes via turbo.

## User Setup Required

None - no external service configuration required. `cp .env.example .env && pnpm demo` is sufficient for a reviewer with Docker installed.

## Next Phase Readiness

- OPS-04 load test is ready to drive the `/demo` dashboard chart live in Phase 06-04+
- OPS-03 demo entrypoint is the reproducible headline demo for recruiters
- Phase 06-04 (GitHub Actions CI) can reference `pnpm demo` for integration testing step
- Remaining Phase 06 plans (02: Testcontainers integration tests, 04: CI, 05: Playwright E2E, 06: deployment) are unblocked

---
*Phase: 06-testing-ci-cd-deployment*
*Completed: 2026-06-21*
