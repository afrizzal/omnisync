---
phase: quick-260610-sw5
plan: 01
subsystem: testing, ci, infra
tags: [vitest, coverage, ci, biome, zod, gitignore, turbo]

requires:
  - phase: 02-high-speed-ingestion-api
    provides: "25 api tests across 4 test files (hmac, fingerprint, health, ingest)"

provides:
  - "turbo test task with ^build dependency"
  - "root pnpm test script with arg-passthrough (turbo run test --)"
  - "vitest v8 coverage block with lines:80 threshold, excluding src/index.ts and src/types/**"
  - "CI step: Test (with coverage gate) running pnpm test -- --coverage after Build"
  - ".claude/ gitignored (agent worktree dirs invisible to git)"
  - "coverage/ gitignored (generated output never committed)"
  - "ROADMAP: Phase 2 marked complete 2026-06-09, progress row 3/3"
  - "STATE: percent:33, progress bar Phase 2 of 6, current focus Phase 03"
  - "Zod v4 non-deprecated APIs: z.iso.datetime({ offset: true }), z.url() x3"
  - "biome lint fully green (coverage/ excluded, FIXABLE issues auto-applied)"

affects: [phase-03-worker-core, phase-06-testing-ci]

tech-stack:
  added: []
  patterns:
    - "turbo test task uses ^build dep so workspace package dist/ is always fresh before tests run"
    - "root test script: turbo run test -- (trailing -- enables pnpm test -- --coverage passthrough)"
    - "vitest coverage: v8 provider, src/** include, exclude entrypoints and .d.ts, lines:80 threshold"
    - "z.iso.datetime({ offset: true }) for timestamp fields that accept timezone offsets"
    - "z.url() (top-level, not z.string().url()) for URL env vars in Zod v4"

key-files:
  created: []
  modified:
    - turbo.json
    - package.json
    - apps/api/vitest.config.ts
    - .github/workflows/ci.yml
    - .gitignore
    - biome.json
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - packages/types/src/event.ts
    - packages/config/src/env.ts

key-decisions:
  - "turbo test task has no outputs (tests produce no cacheable build artifact)"
  - "root test script is turbo run test -- (not turbo run test) to enable pnpm test -- --coverage arg passthrough"
  - "src/index.ts excluded from coverage: wiring entrypoint opens real Redis/queue connections at import — Phase-6 integration/E2E territory, not unit-testable in isolation"
  - "src/types/** excluded from coverage: declaration-only .d.ts files with no executable lines"
  - "lines threshold set to 80 (actual 98.07%) — never commit a threshold that fails"
  - "z.iso.datetime({ offset: true }) offset flag is deliberate: buildFingerprint normalizes occurredAt via new Date().toISOString(), so offset variants canonicalize to the same fingerprint; default datetime() rejects offsets making that normalization unreachable"
  - "coverage/ added to .gitignore and biome excludes: generated output must not be committed or linted"

patterns-established:
  - "Pattern: always run pnpm --filter test:coverage to observe actual coverage before setting thresholds"
  - "Pattern: biome.json files.includes exclusion for **/coverage alongside **/dist and **/.next"

requirements-completed: [OPS-01]

duration: 25min
completed: 2026-06-10
---

# Quick Task 260610-sw5: Housekeeping — CI Test + Coverage Gate, .gitignore, Planning Drift, Zod v4

**CI coverage gate enforced (98% actual vs 80% threshold), .claude/ and coverage/ gitignored, Phase 2 ROADMAP/STATE drift corrected to 33%, and z.string().datetime()/z.string().url() deprecated Zod v4 APIs replaced with z.iso.datetime({ offset:true })/z.url()**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-10T20:50:00Z
- **Completed:** 2026-06-10T21:15:00Z
- **Tasks:** 3 (plus pre-existing lint auto-fix as deviation)
- **Files modified:** 13

## Accomplishments

- Wired turbo `test` task + root `test` script so `pnpm test -- --coverage` works end-to-end in CI and locally
- All 25 api tests pass under v8 coverage: 98.07% lines, 83.33% branches, 92.85% functions, 96.49% statements — all above the 80% gate
- CI YAML now blocks on coverage threshold after every push (step inserted after Build, before Lint)
- `.claude/` gitignored: `git check-ignore .claude/worktrees` exits 0
- ROADMAP Phase 2 marked `[x]` with `(completed 2026-06-09)`; progress table `3/3 | Complete | 2026-06-09`
- STATE `percent: 33`, progress bar `[██░░░░] Phase 2 of 6 complete (33%)`, current focus `Phase 03 — Worker Core & Idempotent Persistence`
- Deprecated Zod v4 chains removed: `z.iso.datetime({ offset: true })` and `z.url()` now used across types and config packages

## Measured Coverage (actuals before threshold was set)

| Metric | Actual | Threshold set |
|--------|--------|---------------|
| Lines | 98.07% (51/52) | 80 |
| Statements | 96.49% (55/57) | — |
| Branches | 83.33% (20/24) | — |
| Functions | 92.85% (13/14) | — |

Only `lines` threshold is enforced (plan requirement). Actuals provide 18+ percentage points of headroom.

## Coverage Exclusions Rationale

- **`src/index.ts`**: Wiring entrypoint that opens real Redis and BullMQ queue connections at import-time. Unit test infrastructure cannot mock these at the module boundary without major test architecture changes. This file is exercised by Phase-6 integration/E2E tests that use real infrastructure.
- **`src/types/**`**: Declaration-only `.d.ts` files. No executable lines; including them would inflate the denominator without any meaningful coverage signal.

## z.iso.datetime({ offset: true }) Rationale

The `offset: true` flag is deliberate and end-to-end-coherent:

1. A prior fix (commit `eb6a4d9`) makes `buildFingerprint` normalize `occurredAt` via `new Date(occurredAt).toISOString()` before hashing, so offset variants like `2026-06-10T10:00:00+07:00` canonicalize to `2026-06-10T03:00:00.000Z` — producing the same fingerprint as a UTC input for the same instant.
2. The default `z.string().datetime()` (and `z.iso.datetime()` without `offset: true`) **rejects** timezone offsets at the API boundary. This would make the normalization code in `buildFingerprint` unreachable for offset inputs — an end-to-end coherence bug.
3. Accepting offsets here and canonicalizing downstream is the correct behavior for a high-volume event pipeline that receives webhooks from multi-timezone sources.

## git check-ignore Confirmation

`git check-ignore .claude/worktrees` exits 0 — the local agent scratch directory is invisible to git.

## Task Commits

1. **Task 1: Wire CI test + coverage gate** - `937827f` (ci)
2. **Task 2: Ignore .claude/** - `97f9f72` (chore)
3. **Task 2: Fix ROADMAP/STATE phase-2 drift** - `0b2a533` (docs)
4. **Task 3: Migrate deprecated Zod v4 APIs** - `35acf4b` (refactor)

## Files Created/Modified

- `turbo.json` - Added `test` task with `dependsOn: ["^build"]`
- `package.json` - Added `"test": "turbo run test --"` root script
- `apps/api/vitest.config.ts` - Added v8 coverage block, lines:80 threshold, exclusions
- `.github/workflows/ci.yml` - Added "Test (with coverage gate)" step after Build
- `.gitignore` - Added `.claude/` and `coverage/` ignore rules
- `biome.json` - Added `!**/coverage` exclusion to prevent linting generated coverage files
- `.planning/ROADMAP.md` - Phase 2 marked complete, progress table updated
- `.planning/STATE.md` - percent:33, Phase 2 of 6 complete, current focus Phase 03
- `packages/types/src/event.ts` - `z.iso.datetime({ offset: true })` for occurredAt
- `packages/config/src/env.ts` - `z.url()` x3 for DATABASE_URL, DIRECT_URL, REDIS_URL
- `apps/api/src/app.ts` - Biome format fix (organizeImports)
- `apps/api/src/index.ts` - Biome fix (useLiteralKeys)
- `apps/api/src/plugins/errorHandler.ts` - Biome format fix
- `apps/api/src/routes/ingest.ts` - Biome format fix
- `apps/api/tests/**` - Biome format fixes (organizeImports, useTemplate, useLiteralKeys)
- `apps/api/vitest.setup.ts` - Biome fix (useLiteralKeys)

## Decisions Made

- `turbo run test --` (trailing `--`) is the correct root script form for `pnpm test -- --coverage` to work: pnpm appends user-supplied args after the `--`, and turbo treats everything after its own `--` as pass-through args to underlying tasks.
- `lines: 80` only threshold (not all four) per plan spec. Actual coverage is 98%+ so threshold is conservative.
- `coverage/` added to both `.gitignore` and `biome.json` exclusions: generated files must not be committed or linted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Add coverage/ to gitignore and biome excludes**
- **Found during:** Task 3 (post-test lint verification)
- **Issue:** Running `pnpm --filter @omnisync/api test:coverage` generates `apps/api/coverage/` containing JavaScript files. `biome check .` then linted those generated files (125 errors from coverage JS). Without excluding coverage/, the lint gate would always fail after a test run.
- **Fix:** Added `coverage/` to `.gitignore` and `!**/coverage` to `biome.json` files.includes exclusions.
- **Files modified:** `.gitignore`, `biome.json`
- **Verification:** `pnpm lint` exits 0 after coverage directory is generated
- **Committed in:** `35acf4b` (Task 3 commit)

**2. [Rule 1 - Bug] Auto-apply all FIXABLE biome lint/format errors**
- **Found during:** Task 3 lint gate
- **Issue:** Pre-existing FIXABLE lint errors across `apps/api/src/`, `apps/api/tests/`, and `apps/api/vitest.setup.ts` (useLiteralKeys, useTemplate, organizeImports, format). The main repo's `master` branch had 193 biome errors. These were all auto-fixable and blocked the lint gate green requirement.
- **Fix:** `pnpm format` + `biome check --write --unsafe .` auto-applied all FIXABLE issues. One remaining non-FIXABLE warning (`noNonNullAssertion` in `packages/queue/src/index.ts`) is a warning (not error) and exits 0.
- **Files modified:** `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/errorHandler.ts`, `apps/api/src/routes/ingest.ts`, `apps/api/tests/lib/fingerprint.test.ts`, `apps/api/tests/lib/hmac.test.ts`, `apps/api/tests/routes/health.test.ts`, `apps/api/tests/routes/ingest.test.ts`, `apps/api/vitest.setup.ts`
- **Verification:** `pnpm lint` exits 0 with only 1 warning (noNonNullAssertion, not error)
- **Committed in:** `35acf4b` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical config, 1 pre-existing bug cleared to meet gate)
**Impact on plan:** Both fixes necessary to satisfy the lint gate in the verification criteria. No scope creep.

## Issues Encountered

- Worktree branch had only the initial commit; required `git merge master` to bring all repo files into the worktree before execution. Standard worktree initialization behavior.
- `pnpm test -- --coverage` initially failed because turbo treated `--coverage` as its own flag. Fixed by using `"test": "turbo run test --"` (trailing `--`) in root package.json so turbo forwards subsequent args to underlying tasks.

## User Setup Required

None - no external service configuration required. CI gate is automatic on next push.

## Next Phase Readiness

- CI now enforces ≥80% line coverage on every push — the portfolio's quality-bar requirement is live
- Phase 3 (Worker Core) can begin immediately; the turbo `test` task will pick up worker tests as they are written
- The `.claude/` and `coverage/` gitignore rules prevent future accidental commits of generated artifacts
- Zod schemas are on the current v4 API — no deprecated warnings in any upcoming Phase 3 work

---
*Phase: quick-260610-sw5*
*Completed: 2026-06-10*
