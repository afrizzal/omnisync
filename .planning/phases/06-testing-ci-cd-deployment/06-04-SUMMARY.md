---
phase: 06-testing-ci-cd-deployment
plan: 04
subsystem: infra
tags: [github-actions, docker, ghcr, ci-cd, build-push]

requires:
  - phase: 06-01
    provides: Dashboard Dockerfile and stub stubs verified; Wave 0 foundation confirmed

provides:
  - docker job in CI that builds api/worker/mock-crm images on every push/PR
  - GHCR push gated to master branch only (PRs build-only)
  - docker job gated behind verify job (broken code never produces a published image)

affects: [06-05, 06-06, deploy, demo]

tech-stack:
  added:
    - docker/setup-buildx-action@v3
    - docker/login-action@v3
    - docker/build-push-action@v6
  patterns:
    - "PR build-only / master push-only pattern using push: ${{ github.ref == 'refs/heads/master' }}"
    - "GHA layer cache via type=gha with mode=max for faster subsequent builds"
    - "needs: verify gate prevents publishing images from broken commits"

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "docker/build-push-action@v6 push conditional on github.ref == 'refs/heads/master' — PRs validate Dockerfiles without publishing throwaway images"
  - "Login step guarded by the same if: condition — avoids GITHUB_TOKEN permission errors on fork PRs"
  - "GHA cache (type=gha,mode=max) chosen over registry cache — free, zero-config for GitHub-hosted runners"

patterns-established:
  - "GHCR tag pattern: ghcr.io/${{ github.repository_owner }}/omnisync-<name>:latest and :<sha>"

requirements-completed: [OPS-01]

duration: 10min
completed: 2026-06-21
---

# Phase 06 Plan 04: Docker Build+Push CI Job (OPS-01) Summary

**Docker build+push job added to GitHub Actions: builds api/worker/mock-crm images on every push/PR, pushes to GHCR on master only, gated behind the verify job.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-21T02:30:00Z
- **Completed:** 2026-06-21T02:40:00Z
- **Tasks:** 1 of 2 complete (Task 2 is a human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Extended `.github/workflows/ci.yml` with a `docker` job as a sibling of `verify` under `jobs:`
- Three build+push steps cover api, worker, and mock-crm using `docker/build-push-action@v6`
- Push logic is conditional: `push: ${{ github.ref == 'refs/heads/master' }}` — PRs remain build-only
- GHCR login is also conditional (`if: github.ref == 'refs/heads/master'`) to avoid permission errors on fork PRs
- GHA layer cache (`type=gha,mode=max`) wired to each build step for fast subsequent CI runs

## Task Commits

1. **Task 1: Add docker build+push job to ci.yml (OPS-01)** - `8108289` (feat)

**Plan metadata commit:** pending (after Task 2 human-verify approved)

## Files Created/Modified

- `.github/workflows/ci.yml` — appended 60-line `docker` job after `verify` job; `on:` triggers and `verify` job unchanged

## Decisions Made

- `docker/build-push-action@v6` push is conditional on master ref — same pattern used by the RESEARCH.md Pattern 5 reference; avoids separate `if:` guards per step
- Login step guarded identically — prevents `GITHUB_TOKEN` permission errors when Actions runs on fork PRs where `packages: write` may be unavailable
- `${{ github.repository_owner }}` used for GHCR owner — resolves to `afrizzal`, portable if repo is transferred

## Deviations from Plan

None — plan executed exactly as written. The job YAML in the plan action block was used verbatim.

## Issues Encountered

None.

## User Setup Required

Per plan `user_setup` — these are manual steps required after the first master-merge push triggers the docker job:

1. **Set package visibility to Public**: GitHub repo -> Packages -> omnisync-api/omnisync-worker/omnisync-mock-crm -> Package settings -> Change visibility to Public
2. **Enable branch protection**: GitHub repo -> Settings -> Branches -> Add rule -> Require status checks -> require the `verify` check to pass before merge (D-11)

These cannot be automated — require GitHub dashboard access.

## Known Stubs

None. This plan adds CI YAML only; no data-rendering code was modified.

## Next Phase Readiness

- OPS-01 satisfied once Task 2 human-verify is approved (post-merge GHCR images visible)
- Plan 06-05 (performance/load test) can proceed independently — does not depend on GHCR images

---

## Self-Check: PASSED

- `.github/workflows/ci.yml` — FOUND (verified with node inline check: all required strings present)
- Commit `8108289` — FOUND (git log confirms)

---

*Phase: 06-testing-ci-cd-deployment*
*Completed: 2026-06-21*
