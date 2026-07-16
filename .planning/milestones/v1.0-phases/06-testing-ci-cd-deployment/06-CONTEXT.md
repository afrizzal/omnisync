# Phase 6: Testing, CI/CD & Deployment - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The finale. Lock the quality bar and make OmniSync demonstrable — **no new product capabilities**, only proving and packaging what Phases 1–5 built. This phase delivers:

- **TST-01** — ≥80% line coverage enforced as a CI gate (already true for `apps/api` + `apps/worker`; this phase confirms/holds it, not rebuilds it)
- **TST-02** — the signature deliverable: a **Testcontainers** integration test proving in-flight events survive a Postgres outage (paused mid-processing) with zero events dropped from the queue
- **TST-03** — concurrent duplicate webhooks → exactly one stored row, as a named CI-gated test (substantively already exists in `apps/worker/tests/integration/idempotency.test.ts`)
- **TST-04** — Playwright E2E covering the DLQ dashboard re-queue flow, headless in CI, against the docker-compose stack
- **OPS-01** — extend the existing CI to build the multi-stage Docker images and **push them to GHCR** on merge to master
- **OPS-03** (reframed — see D-01) — a **one-command reproducible full-stack demo** (`docker compose up`) + a **recorded walkthrough**, not a live public deploy
- **OPS-04** — a **standalone autocannon load-test/demo script** that blasts multi-channel synthetic events at the ingestion API and drives the `/demo` dashboard chart

Requirements: **TST-01, TST-02, TST-03, TST-04, OPS-01, OPS-03, OPS-04**

This phase does NOT add new resilience, routing, or dashboard features. It does NOT deploy to a live public host (deliberately deferred — see Deferred Ideas).

</domain>

<decisions>
## Implementation Decisions

### Deployment & Live-Demo Topology (OPS-03) — the headline call

- **D-01 (SCOPE REFRAME):** **No live public deploy.** Research confirmed there is **no free tier in 2026 that runs an always-on background worker** (Render workers = paid $7/mo each; Fly.io free tier dead, ~$2–5/mo pay-as-you-go; Railway $1/mo credit insufficient; Koyeb free tier *cannot run worker services* and scales to zero). The only $0 always-on path is self-hosting on an Oracle Cloud Always Free ARM VM, which carries setup effort and free-capacity flakiness. Given the near-zero-cost job-hunt constraint, OPS-03 is reframed: **success = a one-command reproducible full-stack demo + a recorded walkthrough + published deploy-ready images**, NOT a reachable public URL.
- **D-02:** The demo runs the **entire stack via `docker compose up`** — api, worker, postgres, redis, **and mock-crm**. Because mock-crm runs locally, the **live circuit-breaker demo works** (toggle `POST /admin/failure-mode` on mock-crm, watch the breaker open → half-open → closed). This is the key reason the local demo loses nothing important versus a PaaS deploy (where mock-crm would not be deployed — Phase 4 D-09).
- **D-03:** A **recorded demo (video/GIF) goes in the README** regardless — it must show, in order: (1) load-test driving the `/demo` chart, (2) the 50→1 concurrent-dedup result, (3) the circuit breaker opening/recovering under mock-crm failure, (4) the kill-Postgres durability scenario (pause PG, events stay queued, unpause, they drain). This recorded artifact is the durable "demonstrate it live under failure" proof from PROJECT.md.
- **D-04:** Provide a **single demo entrypoint** (e.g. `pnpm demo` / a `Makefile` target / `scripts/demo.sh`) that brings up compose and runs the load-test, so a reviewer reproduces the headline scenario in one command. Exact orchestration is Claude's discretion.
- **ROADMAP impact:** Phase 6 **SC-5** ("always-on worker reachable at a public URL …") must be **reworded at transition** to the reframed definition above. SC-1..SC-4 stand unchanged. The planner should plan to the reframed SC-5, not the original wording.

### Kill-Postgres Durability Test (TST-02 / SC-1)

- **D-05:** Use **Testcontainers** (`@testcontainers/postgresql`, and Redis as needed) — spin an **ephemeral Postgres container inside the test**, start processing, `container.pause()` it mid-flight, assert in-flight events remain in the BullMQ queue (zero dropped), `unpause()`, then assert they drain to exactly the expected rows. Chosen over reusing the CI service-container / compose Postgres because the kill-test must **isolate** the DB it pauses (pausing the shared CI Postgres would disturb other parallel integration tests) and because Testcontainers is the roadmap's named approach and the strongest portfolio signal.
- **D-06:** Testcontainers requires a Docker daemon — present on GitHub Actions `ubuntu-latest`. The **existing CI service containers (postgres:16/redis:7) stay** for the other integration tests; only the TST-02 kill-test owns its own ephemeral container(s). Researcher must confirm Testcontainers + the existing service-container setup coexist cleanly on the runner.
- **D-07:** The behavior under test (RES-07) is already implemented and was verified 9/9 in Phase 4 (incl. the unit test `processor.test.ts` Test 4: "Postgres failure does NOT open the CRM breaker"). TST-02 is the **formal integration proof**, not new product behavior.

### CI/CD Scope (OPS-01)

- **D-08:** CI **already** runs typecheck → build → test (`pnpm test -- --coverage`, 80% line gate) → lint on every push *and* PR against postgres:16 + redis:7 service containers (`.github/workflows/ci.yml`). This phase **adds a Docker step**, it does not rebuild the pipeline.
- **D-09:** **Build + push to GHCR.** On **merge to master**, build the multi-stage `api`, `worker`, and `mock-crm` images and push to GitHub Container Registry tagged `latest` + commit SHA. On **PRs**, build-only (no push). Gives a real "deploy-ready images" CD story without a host and makes the one-command demo pullable. Use the standard `docker/build-push-action` + `GITHUB_TOKEN` with `packages: write` permission.
- **D-10:** Keep the **80% line coverage gate on `apps/api` + `apps/worker` only** — do NOT add a hard gate to `packages/db` / `packages/queue` (honors Phase 3 03-CONTEXT decision: those are infra packages, tested but not gated). TST-03's `idempotency.test.ts` already runs under the worker gate.
- **D-11:** "Blocks merges that fall below threshold" (SC-4) is satisfied by the CI gate failing the run; the **GitHub branch-protection toggle** that makes it *required* is a repo setting the **user** flips (note in plan as a manual step, not code).

### E2E + Load-Test Harness (TST-04 + OPS-04)

- **D-12:** **Playwright E2E runs against the docker-compose full stack** (dashboard + api + worker + postgres + redis + mock-crm), headless, in a dedicated CI job. The flow: seed a DLQ entry deterministically → load `/dlq` → click Re-queue → assert the event appears in `events` exactly once. Deterministic seeding mechanism (drive mock-crm into `fail` mode and fire an event, vs. direct admin/DB seed) is Claude's discretion for the planner.
- **D-13:** **OPS-04 = a standalone `scripts/loadtest.ts` (tsx) using `autocannon`** — blasts **multi-channel synthetic events** (Shopee/Tokopedia/Meta/CRM shapes, each with a valid HMAC signature) at `POST /ingest/:source` at **configurable RPS + duration**, targeting a configurable base URL (local now, any host later). Its traffic drives the `/demo` dashboard chart live. Chosen over k6 (no extra non-Node binary for a reviewer to install), over a custom fetch-loop (autocannon gives real throughput/latency numbers for free), and over reusing the Phase-5 `/api/demo/start` route (OPS-04 implies an **external** blaster you can point at a target — the server-side route stays as the dashboard's in-app trigger).
- **D-14:** The synthetic event generator should produce **per-source valid signatures** using the same `WEBHOOK_SECRET_*` scheme the ingestion API validates — so the load-test exercises the real HMAC path, not a bypass.

### Claude's Discretion
- Demo orchestration entrypoint shape (`pnpm demo` vs Makefile vs shell script)
- Testcontainers test file location + whether Redis is also containerized or reused
- Playwright DLQ-seeding mechanism + config (projects, retries, CI reporter)
- autocannon script flags/defaults (RPS, duration, connections, source mix ratios)
- Exact GHCR image naming/tagging convention and Actions job structure (matrix vs sequential)
- Recorded-demo capture tooling and where the asset lives in the repo

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 requirements & success criteria
- `.planning/REQUIREMENTS.md` — TST-01..04, OPS-01/03/04 definitions
- `.planning/ROADMAP.md` §"Phase 6" — SC-1..SC-5 (note SC-5 reframed per D-01; plan to the reframed definition)

### Existing infra this phase extends (read before implementing)
- `.github/workflows/ci.yml` — current pipeline (typecheck/build/test+coverage/lint, postgres:16 + redis:7 services); Phase 6 adds the Docker build+push step (D-09)
- `docker-compose.yml` — full local stack (api/worker/postgres/redis/mock-crm); basis of the one-command demo (D-02)
- `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/mock-crm/Dockerfile` — multi-stage images to build+push to GHCR
- `apps/api/vitest.config.ts`, `apps/worker/vitest.config.ts` — `thresholds: { lines: 80 }` already set (D-08/D-10)
- `apps/worker/tests/integration/idempotency.test.ts` — existing 50→1 dedup proof (TST-03)
- `apps/worker/tests/integration/concurrency.test.ts` — SC-4 pool-exhaustion test (pattern for the Testcontainers kill-test: uses `buildProcessor` directly against a real pool)
- `apps/worker/src/processor/event.processor.ts` — `buildProcessor(prisma, logger)`; RES-07 boundary (persist outside the breaker)
- `apps/api/src/routes/demo.ts` + `apps/api/src/app.ts` — Phase-5 `/api/demo/start` server-side trigger (stays; OPS-04 is the external client)
- `apps/mock-crm` (`POST /admin/failure-mode { mode, rate }`) — runtime failure toggle that powers the live breaker demo (D-02/D-03) and Playwright DLQ seeding (D-12)

### Prior phase context (locked decisions Phase 6 honors)
- `.planning/phases/04-resilience-dynamic-routing/04-CONTEXT.md` — D-09 (mock-crm compose-only), RES-07 behavior, cockatiel breaker demo mechanics
- `.planning/phases/03-worker-core-idempotent-persistence/03-CONTEXT.md` — packages/db has no coverage gate (D-10), buildProcessor/idempotency patterns
- `.planning/phases/05-dashboard-observability/05-CONTEXT.md` — dashboard pages the Playwright E2E targets (`/dlq` re-queue flow)

### Project-level research
- `.planning/research/STACK.md` — pinned versions (Vitest 4, Node 22, Prisma 7, BullMQ 5.77); confirm Testcontainers/Playwright/autocannon versions against it
- `.planning/research/PITFALLS.md` — at-least-once semantics, Redis eviction, race conditions (relevant to the kill-PG assertion design)

### External library docs (researcher must fetch current docs)
- **Testcontainers for Node** — `@testcontainers/postgresql`, `GenericContainer`, `.pause()/.unpause()`, daemon requirements on GitHub Actions
- **Playwright** — config, CI headless setup, webServer / external-stack wiring, deterministic seeding
- **autocannon** — programmatic API, custom request bodies/headers (per-source HMAC), RPS/duration/connections flags
- **GitHub Actions** — `docker/build-push-action`, `docker/login-action` to GHCR, `permissions: packages: write`, conditional push on `master`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`.github/workflows/ci.yml`** — extend, don't replace; add a Docker build+push job/step gated on `master`
- **Three multi-stage Dockerfiles** (api/worker/mock-crm) already build clean (verified Phase 1 OPS-02) — ready to push to GHCR
- **`docker-compose.yml`** full stack — the one-command demo substrate
- **`buildProcessor(prisma, logger)`** — drive the Testcontainers kill-test directly (bypasses BullMQ overhead, like `concurrency.test.ts`)
- **`idempotency.test.ts`** — already satisfies TST-03; reference/relabel rather than rewrite
- **`apps/mock-crm` `/admin/failure-mode`** — the lever for both the live breaker demo and Playwright DLQ seeding
- **`vitest.config.ts` 80% thresholds** — TST-01 gate already live; CI already runs `--coverage`

### Established Patterns
- Integration tests run against **real Postgres + Redis** (CI service containers locally on 5432/6379) — Testcontainers adds an *isolated* DB only for the kill-test
- DI factories (`buildApp`, `buildWorker`, `buildProcessor`) — testable seams already exist
- Conventional Commits `type(NN): summary` — Phase 6 scope is `(06)`
- ESM-native, `zod/v4` subpaths, Biome formatting, pnpm workspaces + Turborepo

### Integration Points
- CI workflow → new `docker/build-push-action` step → GHCR (`ghcr.io/afrizzal/omnisync-*`)
- Testcontainers kill-test → new file under `apps/worker/tests/integration/` (or a dedicated `tests/durability/`)
- Playwright → new `apps/dashboard` (or root) `e2e/` suite + CI job that `docker compose up`s the stack
- `scripts/loadtest.ts` → root `scripts/`, points at `INGEST_BASE_URL`, reuses `WEBHOOK_SECRET_*` signing

</code_context>

<specifics>
## Specific Ideas

- **"There is no free always-on-worker tier in 2026"** — the research finding that drove the D-01 reframe. Worth a one-line note in the README's deployment section (turns a constraint into a credible, informed engineering decision — good interview talking point).
- **The recorded demo is the durable proof** — even if a live URL existed it could be down when a recruiter clicks; a tight recorded walkthrough + `docker compose up` repro is the reliable artifact.
- **autocannon over k6** — stay in-Node so a reviewer runs the demo with `pnpm`, no extra toolchain.
- **Testcontainers `.pause()` for the kill-test** — pausing (not stopping) the container most faithfully simulates a DB that's unreachable but not gone; in-flight queue items must survive and drain on resume.
- **Multi-channel synthetic events with real signatures** — the load-test must go through the genuine HMAC + fingerprint path, not a test bypass, to be a credible demo.

</specifics>

<deferred>
## Deferred Ideas

- **Live public deploy** (Oracle Cloud Always Free $0 self-host, or Fly.io ~$2–5/mo) — explicitly deferred as an **optional post-Phase-6 stretch**. The published GHCR images + compose file make it a drop-in later if desired. Not in Phase 6 scope.
- **Branch-protection "required check" toggle** — a GitHub repo setting the user flips manually; noted in plan, not automated.
- **`bull-board` queue browser** — still deferred (confirmed since Phase 3/4).
- **Real connectors / auth / RBAC** — v2 (out of scope per PROJECT.md).
- **k6 load-testing suite** — considered and not chosen for OPS-04; could be a richer future addition.

### Reviewed Todos (not folded)
None — `todo match-phase 6` returned no matches.

</deferred>

---

*Phase: 06-testing-ci-cd-deployment*
*Context gathered: 2026-06-21*
