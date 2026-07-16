---
phase: 1
slug: foundation-local-infra
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 1 is foundation/infra — verifications are **build + CLI + integration assertions**, not unit tests.
> No unit-test framework is introduced this phase (Vitest arrives in Phase 6).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None yet — build + CLI/SQL assertions (Vitest deferred to Phase 6) |
| **Config file** | none — no unit framework this phase |
| **Quick run command** | `pnpm typecheck` |
| **Full suite command** | `pnpm build && docker compose up -d && pnpm assert:redis && pnpm --filter @omnisync/db exec prisma migrate deploy` |
| **Estimated runtime** | ~90 seconds (incl. container start) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm typecheck`
- **After every plan wave:** Run `pnpm build` (turbo, all packages+apps)
- **Before `/gsd:verify-work`:** Full suite command green (build + compose + redis assert + migrate)
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

Task IDs bind during planning (Step 8). Each row is a concrete, automatable check from `01-RESEARCH.md` § Validation Architecture.

| Task ID | Plan | Wave | Requirement / Criterion | Test Type | Automated Command | File Exists | Status |
|---------|------|------|--------------------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | SC2 build compiles | build | `pnpm build` exits 0 | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | Lint/format wired | lint | `pnpm lint` (biome check) exits 0 | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | SC3 unique constraint | db assertion | `prisma migrate deploy` then `psql -c "\d events"` output contains `events_fingerprint_unique` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | QUE-01 queue connection | integration | script: instantiate `Queue("events")`, assert name + config (30000/300000/30), no throw | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | SC4 shared imports, no cycles | build/static | app build importing `@omnisync/db`+`@omnisync/types` exits 0; no circular package deps | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | SC1 Redis noeviction | integration | `pnpm assert:redis` → `config get maxmemory-policy` == `noeviction`, exit 0 | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | OPS-02 api+worker via compose | integration | `docker compose build api worker` exits 0; `docker compose up` → both reach "ready" and stay up | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | SC5 CI green | ci | GitHub Actions `verify` job concludes `success` on push | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/assert-redis.ts` (or `pnpm assert:redis`) — Redis `noeviction` assertion used by SC1
- [ ] `docker-compose.yml` — Postgres 16 + Redis 7 (noeviction) for DB/queue assertions

*No unit-test framework introduced this phase — Phase 1 requirements are covered by build + CLI/SQL/integration assertions. Vitest infrastructure lands in Phase 6.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | All Phase 1 criteria are scriptable (build, psql, redis-cli, docker compose, gh run) | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have an automated verify command or Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (assert script + compose)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter (by Nyquist auditor after plans bind task IDs)

**Approval:** pending
