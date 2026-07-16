# Phase 6: Testing, CI/CD & Deployment - Research

**Researched:** 2026-06-21
**Domain:** Testcontainers (Node.js), Playwright E2E, autocannon load testing, GitHub Actions Docker/GHCR, Vitest v4 coverage gating
**Confidence:** HIGH for most areas; MEDIUM for Testcontainers pause workaround (verified via source inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (SCOPE REFRAME):** No live public deploy. OPS-03 = one-command reproducible full-stack demo (`docker compose up`) + recorded walkthrough + published GHCR images. No reachable public URL.
- **D-02:** Demo runs the entire stack via `docker compose up` — api, worker, postgres, redis, and mock-crm. Circuit-breaker demo works because mock-crm runs locally.
- **D-03:** Recorded demo (video/GIF) goes in the README showing: (1) load-test driving `/demo` chart, (2) 50→1 concurrent-dedup result, (3) circuit breaker opening/recovering under mock-crm failure, (4) kill-Postgres durability scenario.
- **D-04:** Single demo entrypoint (e.g. `pnpm demo` / Makefile / shell script) that brings up compose and runs the load-test.
- **D-05:** Use Testcontainers (`@testcontainers/postgresql`) for the kill-PG test — `container.pause()` mid-flight, assert queue survives, `unpause()`, assert drain.
- **D-06:** CI service containers (postgres:16/redis:7) stay for other integration tests. Testcontainers only for TST-02 kill-test to isolate the paused DB from shared CI services.
- **D-07:** RES-07 behavior already implemented (Phase 4). TST-02 is the formal integration proof, not new product behavior.
- **D-08:** CI already runs typecheck→build→test+coverage→lint. This phase adds the Docker build+push step only.
- **D-09:** Build+push to GHCR on merge to master; build-only on PRs. Use `docker/build-push-action` + `GITHUB_TOKEN` with `packages: write`.
- **D-10:** 80% line coverage gate on `apps/api` + `apps/worker` ONLY — not `packages/`.
- **D-11:** GitHub branch-protection toggle is a manual repo setting (note in plan, not automated).
- **D-12:** Playwright E2E runs against docker-compose full stack. Flow: seed DLQ deterministically → load `/dlq` → click Re-queue → assert exactly one event row.
- **D-13:** OPS-04 = standalone `scripts/loadtest.ts` (tsx) using autocannon — multi-channel synthetic events (Shopee/Tokopedia/Meta/CRM shapes) at configurable RPS + duration, targeting configurable base URL.
- **D-14:** Synthetic events use `WEBHOOK_SECRET_*` scheme for real HMAC signatures — exercises the genuine validation path.

### Claude's Discretion
- Demo orchestration entrypoint shape (`pnpm demo` vs Makefile vs shell script)
- Testcontainers test file location + whether Redis is also containerized or reused
- Playwright DLQ-seeding mechanism + config (projects, retries, CI reporter)
- autocannon script flags/defaults (RPS, duration, connections, source mix ratios)
- Exact GHCR image naming/tagging convention and Actions job structure (matrix vs sequential)
- Recorded-demo capture tooling and where the asset lives in the repo

### Deferred Ideas (OUT OF SCOPE)
- Live public deploy (Oracle Cloud Always Free / Fly.io ~$2-5/mo)
- Branch-protection "required check" toggle (manual repo setting — note in plan only)
- `bull-board` queue browser
- Real connectors / auth / RBAC
- k6 load-testing suite
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TST-01 | Unit + integration test suite (Vitest) achieves ≥80% line coverage, enforced as a CI gate | Vitest v4 `thresholds: { lines: 80 }` already set in both vitest configs; `pnpm test -- --coverage` already in CI; confirmed non-zero exit on threshold miss |
| TST-02 | Integration test proves queue durability when PostgreSQL is killed mid-process (Testcontainers) | `@testcontainers/postgresql` v12; `pause()` is NOT on StartedTestContainer — use `container.stop({ timeout: 1 })` then `container.restart()` pattern or dockerode direct pause; documented below |
| TST-03 | Integration test proves concurrent duplicate webhooks result in exactly one stored record | Already exists: `apps/worker/tests/integration/idempotency.test.ts` — reference/relabel only |
| TST-04 | Playwright E2E test covers DLQ dashboard re-queue flow | `@playwright/test` v1.61.0; headless Chromium; docker compose full stack; seed via mock-crm fail mode; documented below |
| OPS-01 | GitHub Actions CI runs type-check, tests, and Docker build on every push | Extend existing ci.yml with docker build+push job; `docker/build-push-action@v6`; conditional push on master |
| OPS-03 | One-command reproducible full-stack demo + recorded walkthrough + published GHCR images | `docker compose up` already works; add `scripts/demo.sh` entrypoint; GHCR images via OPS-01 |
| OPS-04 | Load-test/demo script blasts multi-channel synthetic events with real HMAC signatures | `autocannon` v8.0.0 programmatic API; `scripts/loadtest.ts` via tsx; `requests[]` array for per-source signing |
</phase_requirements>

---

## Summary

Phase 6 is a finishing phase — no new product features, only formal proof and packaging of Phases 1–5. The critical technical investigation areas are: (1) the correct pattern for simulating a Postgres outage inside a Testcontainers test, (2) wiring a Playwright suite against the docker-compose stack in CI, (3) the autocannon programmatic API for per-request HMAC signing, and (4) the GitHub Actions GHCR push pipeline.

The most important finding is that **`@testcontainers/postgresql` v12 and the `testcontainers` core package v12 do NOT expose a `.pause()` method on `StartedTestContainer`**. The CONTEXT.md decision D-05 references `container.pause()`, but this method does not exist in the current Node.js Testcontainers API. The correct approach is to use the underlying `dockerode` client (already a transitive dependency of `testcontainers`) to issue a `docker pause` command by container ID, or to use `container.stop({ timeout: 1 })` + restart. The pause approach is strongly preferred because it preserves container state and allows `docker unpause` recovery, faithfully simulating an unreachable-but-not-destroyed DB.

The rest of the areas are straightforward: Playwright v1.61.0 works with an external stack via `baseURL`; autocannon v8 has a programmatic `requests[]` array for per-request customization; the GHCR push uses `docker/build-push-action@v6` with `push: ${{ github.ref == 'refs/heads/master' }}`.

**Primary recommendation:** Use `dockerode` (already a dep of testcontainers) to call `container.pause()` via the Docker API by container ID. This is the cleanest workaround for the missing `pause()` on `StartedTestContainer`.

---

## Standard Stack

### New Dependencies This Phase Adds

| Library | Version (verified) | Purpose | Why |
|---------|-------------------|---------|-----|
| `@testcontainers/postgresql` | 12.0.3 | Spin up ephemeral Postgres for TST-02 kill-test | The named approach in the roadmap; isolates the paused DB from shared CI services |
| `testcontainers` | 12.0.3 | Base container management + `GenericContainer` | Required by `@testcontainers/postgresql`; also provides `GenericContainer` for Redis if needed |
| `@playwright/test` | 1.61.0 | E2E DLQ re-queue flow (TST-04) | Current stable; Microsoft-maintained; ships with Chromium/Firefox/WebKit |
| `autocannon` | 8.0.0 | Load-test script (OPS-04) | Programmatic API; per-request body/headers via `requests[]`; pure Node.js — no extra binary |
| `@types/autocannon` | 7.12.7 | TypeScript types for autocannon | Required for `scripts/loadtest.ts` |
| `dockerode` | 5.0.0 | Low-level Docker API for container pause | Already a transitive dep of `testcontainers`; access by container ID for `.pause()/.unpause()` |

### Existing Stack (unchanged)

| Library | Version | Phase 6 Role |
|---------|---------|-------------|
| `vitest` + `@vitest/coverage-v8` | 4.1.8 (pinned) | TST-01 gate — already configured; threshold already at 80% |
| `docker/build-push-action` | v6 (GHA) | OPS-01 — GHCR push step |
| `docker/login-action` | v3 (GHA) | GHCR auth in CI |
| `docker/metadata-action` | v5 (GHA) | Tag generation (latest + SHA) |

**Installation (devDependencies, worker package — where Testcontainers tests live):**
```bash
pnpm add -D @testcontainers/postgresql testcontainers --filter @omnisync/worker
```

**Installation (root — where scripts/ and e2e/ live):**
```bash
pnpm add -D @playwright/test autocannon @types/autocannon --workspace-root
```

---

## Architecture Patterns

### Recommended Project Structure (new files this phase adds)

```
.github/
└── workflows/
    ├── ci.yml                          # extend with docker job (existing)
    └── (no new file — extend ci.yml)
apps/
├── worker/
│   └── tests/
│       └── integration/
│           ├── idempotency.test.ts     # TST-03 — already exists, relabel only
│           ├── concurrency.test.ts     # SC-4 — already exists
│           └── durability.test.ts     # TST-02 — NEW: Testcontainers kill-PG test
├── dashboard/
│   └── (no changes to app code)
e2e/                                    # NEW at repo root
├── playwright.config.ts               # baseURL, workers:1 in CI, retries, reporter
└── dlq-requeue.spec.ts                # TST-04 — DLQ re-queue flow
scripts/
├── assert-redis.ts                    # existing
├── loadtest.ts                        # OPS-04 — NEW: autocannon multi-channel blast
└── demo.sh                            # OPS-03 — NEW: one-command demo entrypoint
```

### Pattern 1: Testcontainers Kill-Postgres Test (TST-02)

**What:** Spin an ephemeral Postgres container, start in-flight processing, pause the container mid-flight via dockerode, assert queue jobs survive, unpause, assert all drain to DB.

**Critical finding:** `StartedTestContainer` in testcontainers-node v12 does NOT have a `.pause()` method. The workaround is to use `dockerode` (already a transitive dep) via the container ID to issue a Docker pause command directly.

**Pattern:**
```typescript
// Source: testcontainers-node docs (v12) + dockerode npm (v5.0.0)
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import Dockerode from "dockerode";
import { createPrismaClient } from "@omnisync/db";
import { buildProcessor } from "../../src/processor/event.processor.js";

const pg = await new PostgreSqlContainer("postgres:16")
  .withDatabase("omnisync_test")
  .withUsername("test")
  .withPassword("test")
  .start();

// Get the container ID to use with dockerode for pause/unpause
const containerId = pg.getId();
const docker = new Dockerode(); // connects to local Docker daemon (same daemon testcontainers uses)
const container = docker.getContainer(containerId);

const connectionUri = pg.getConnectionUri();
// Apply migrations, create prisma client pointed at pg.getConnectionUri()...

// Fire in-flight jobs
const processingPromises = events.map(e => processEvent(e));

// Mid-flight: pause the postgres container (equivalent to DB unreachable)
await container.pause();

// Assert: in-flight jobs are still in BullMQ queue (not dropped)
// Wait briefly for errors to surface
await new Promise(r => setTimeout(r, 500));
const queueCount = await queue.getWaitingCount() + await queue.getActiveCount() + await queue.getDelayedCount();
expect(queueCount).toBeGreaterThan(0);

// Unpause: DB comes back
await container.unpause();

// Assert: all jobs eventually drain to DB (poll with timeout)
await waitForJobsDrained(prisma, expectedCount, { timeoutMs: 30_000 });
expect(await prisma.event.count({ where: { ... } })).toBe(expectedCount);

await pg.stop();
```

**Dockerode on GitHub Actions:** Docker daemon is pre-installed on `ubuntu-latest`. Dockerode connects to the Unix socket at `/var/run/docker.sock` by default — this is the same socket testcontainers uses. No additional configuration needed.

**Redis for TST-02:** Two options. (A) Let the Testcontainers test use the CI service container Redis (port 6379) — simple but creates a shared-state dependency. (B) Spin a second Testcontainers container for Redis. **Recommendation:** Reuse the CI service Redis for the kill-test since isolation is only needed for Postgres (the thing being killed). Pass `REDIS_URL` from env, same as other integration tests.

### Pattern 2: Testcontainers + CI Service Containers Coexistence (D-06)

**What:** Both CI service containers (postgres:16 on port 5432, redis:7 on port 6379) and a Testcontainers Postgres container run simultaneously on the same Actions runner.

**Port allocation:** Testcontainers uses `get-port` (transitive dep) to find a free port automatically. The Testcontainers Postgres container will bind to a random host port (e.g., 54321) — never 5432. The `PostgreSqlContainer.getMappedPort(5432)` returns the actual mapped port. No conflict with the CI service container.

**Ryuk (resource reaper):** Testcontainers uses the Ryuk sidecar container on GitHub Actions by default. No action needed — works out of the box on `ubuntu-latest`. If Ryuk causes issues (rare), `TESTCONTAINERS_RYUK_DISABLED=true` can be set as a CI env var.

**Network:** The Testcontainers Postgres container is on the default bridge network. The test code connects to it via `localhost:${pg.getMappedPort(5432)}`. The CI service container Postgres is on a separate network at `localhost:5432`. No interference.

### Pattern 3: Playwright E2E Against Docker Compose Stack (TST-04)

**What:** A dedicated CI job spins up the full stack via `docker compose up`, waits for health checks, then runs Playwright headless tests against the running dashboard.

**CI job structure:**
```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: npx playwright install --with-deps chromium

    # Start the full stack — build from local Dockerfiles
    - name: Start compose stack
      run: docker compose up --build -d
    
    # Wait for dashboard to be reachable
    - name: Wait for stack health
      run: |
        timeout 120 bash -c 'until curl -sf http://localhost:3000; do sleep 2; done'
    
    # Seed DLQ: toggle mock-crm to fail mode, fire one event
    - name: Seed DLQ entry
      run: |
        curl -X POST http://localhost:3002/admin/failure-mode \
          -H 'Content-Type: application/json' -d '{"mode":"fail","rate":1}'
        # Fire event — will exhaust retries and land in DLQ/Postgres dlq_entries
        # (use a signed webhook or the /api/demo/start route)
        sleep 15  # wait for worker to exhaust retries
    
    - name: Run Playwright E2E
      run: npx playwright test
      env:
        PLAYWRIGHT_BASE_URL: http://localhost:3000
    
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: playwright-report
        path: playwright-report/
    
    - run: docker compose down -v
      if: always()
```

**DLQ seeding mechanism (D-12, Claude's discretion):** Toggle mock-crm to `fail` mode at 100% rate, then fire one valid signed webhook to `POST /ingest/shopee`. The worker will exhaust retries (Phase 4 default: 5 attempts × backoff), and BullMQ will move the job to the failed set, which Phase 4 mirrors to the `dlq_entries` Postgres table. After `~15–30s`, the DLQ entry is visible in the dashboard. This is deterministic because the fail rate is 1.0 (100%) and the retry count is fixed.

**Playwright config (`e2e/playwright.config.ts`):**
```typescript
// Source: playwright.dev/docs/test-configuration
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    headless: true,
  },
  // No webServer — external docker compose stack manages services
});
```

**Key point:** Do NOT use `webServer` config. Playwright's `webServer` is for starting a dev server from source; the E2E job uses a pre-built docker compose stack. Instead, use `baseURL` + a pre-flight curl health check.

**DLQ page Playwright test flow:**
```typescript
// e2e/dlq-requeue.spec.ts
test("DLQ re-queue flow", async ({ page }) => {
  await page.goto("/dlq");
  // Wait for table to show at least 1 entry (seeded via mock-crm fail mode)
  await expect(page.locator("table tbody tr")).toHaveCount({ minimum: 1 });
  // Click first Re-queue Job button
  await page.getByRole("button", { name: "Re-queue Job" }).first().click();
  // Feedback text appears
  await expect(page.locator("text=Re-queued successfully")).toBeVisible({ timeout: 10_000 });
  // Assert event appears in DB exactly once — via API call in afterEach/step
});
```

### Pattern 4: autocannon Programmatic API with Per-Source HMAC (OPS-04)

**What:** `scripts/loadtest.ts` blasts `POST /ingest/:source` with per-source valid HMAC signatures using autocannon's `requests[]` array.

**Key API insight:** autocannon v8 accepts a `requests` array where each element can have its own `path`, `method`, `body`, `headers`, and `setupRequest(req, context)` callback. The `setupRequest` callback receives the mutable request object — use it to compute HMAC per request or rotate through sources.

**Pattern:**
```typescript
// Source: autocannon npm (v8.0.0) README
import autocannon from "autocannon";
import { createHmac } from "node:crypto";

const INGEST_BASE_URL = process.env.INGEST_BASE_URL ?? "http://localhost:3001";
const DURATION = Number(process.env.LOAD_DURATION_S ?? "30");
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? "10");

const sources = ["shopee", "tokopedia", "meta", "crm"] as const;

function buildRequest(source: typeof sources[number]) {
  const secret = process.env[`WEBHOOK_SECRET_${source.toUpperCase()}`] ?? "dev-secret";
  const body = JSON.stringify({
    eventType: "order.created",
    externalId: `load-${Date.now()}-${Math.random()}`,
    occurredAt: new Date().toISOString(),
    payload: { amount: 99 },
  });
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return {
    path: `/ingest/${source}`,
    method: "POST" as const,
    body,
    headers: {
      "content-type": "application/json",
      "x-signature": sig,
    },
  };
}

const result = await autocannon({
  url: INGEST_BASE_URL,
  connections: CONNECTIONS,
  duration: DURATION,
  requests: sources.map(buildRequest),
});

autocannon.printResult(result);
```

**Note on `setupRequest`:** For truly dynamic per-request data (unique `externalId` per request), use `setupRequest(req, context)` which is called for each inflight request. This avoids all requests sharing the same `externalId` fingerprint (which would be deduped to 1 row — not useful for a load test).

```typescript
// Dynamic body + signature per request
{
  path: `/ingest/shopee`,
  method: "POST",
  setupRequest: (req) => {
    const body = JSON.stringify({
      eventType: "order.created",
      externalId: `load-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      occurredAt: new Date().toISOString(),
      payload: { amount: Math.floor(Math.random() * 1000) },
    });
    const sig = createHmac("sha256", shopeeSecret).update(body).digest("hex");
    req.body = body;
    req.headers = { "content-type": "application/json", "x-signature": sig };
    return req;
  },
}
```

### Pattern 5: GHCR Push in GitHub Actions (OPS-01 / D-09)

**What:** On merge to master, build api/worker/mock-crm images and push to `ghcr.io/afrizzal/omnisync-*`. On PRs, build only (no push).

**CI job to add to `.github/workflows/ci.yml`:**
```yaml
docker:
  runs-on: ubuntu-latest
  needs: verify          # gate on existing verify job passing
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - name: Login to GHCR
      if: github.ref == 'refs/heads/master'
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push api
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/api/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/afrizzal/omnisync-api:latest
          ghcr.io/afrizzal/omnisync-api:${{ github.sha }}

    - name: Build and push worker
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/worker/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/afrizzal/omnisync-worker:latest
          ghcr.io/afrizzal/omnisync-worker:${{ github.sha }}

    - name: Build and push mock-crm
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/mock-crm/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/afrizzal/omnisync-mock-crm:latest
          ghcr.io/afrizzal/omnisync-mock-crm:${{ github.sha }}
```

**Permissions note:** `permissions: packages: write` must be set at the job level (or workflow level). `GITHUB_TOKEN` is automatically available — no manual secret needed. The `login-action` is conditionally run only on master; build-push-action's `push:` condition ensures no push on PRs even if login is accidentally present.

**Sequential vs matrix:** Sequential (as above) is cleaner for 3 images — matrix adds conditional complexity with little benefit here.

**Image visibility:** GHCR images default to private. To make them public (for the demo story), the user navigates to the package page on GitHub → Change visibility → Public. This is a one-time manual step.

### Pattern 6: Vitest v4 Coverage Gate Confirmation (TST-01)

**Status:** Already working. Both `apps/api/vitest.config.ts` and `apps/worker/vitest.config.ts` have `thresholds: { lines: 80 }`. CI already runs `pnpm test -- --coverage`. Vitest exits with non-zero when thresholds are not met (confirmed behavior — Vitest writes an error to stderr and exits 1 when coverage drops below threshold).

**Vitest v4 change relevant to coverage:** `coverage.all` was removed in v4 and defaults to covering only files that are exercised by tests. The existing `coverage.include: ["src/**"]` config forces all `src/` files to be included in coverage calculation (including untouched files), which is the correct setting for an 80% gate. No changes needed.

**D-10 enforcement (packages/ excluded from gate):** `packages/db` and `packages/queue` have no `thresholds` in their vitest configs (confirmed: only `apps/api` and `apps/worker` have the 80% threshold). This matches D-10 exactly. Phase 6 does not add thresholds to packages.

**Existing `pnpm test -- --coverage` command in CI:** The `--` passes the `--coverage` flag through Turborepo to each `vitest run` invocation. With `@vitest/coverage-v8` installed in each app's devDependencies, this works correctly. CI exits non-zero if either app falls below 80%.

### Pattern 7: Demo Entrypoint (OPS-03 / D-04)

**Recommended shape:** A shell script `scripts/demo.sh` is the most portable option — no pnpm/Make tooling assumption for a reviewer.

```bash
#!/usr/bin/env bash
# scripts/demo.sh — one-command OmniSync demo
set -euo pipefail

echo "Starting OmniSync full stack..."
docker compose up --build -d

echo "Waiting for API to be ready..."
timeout 90 bash -c 'until curl -sf http://localhost:3001/healthz; do sleep 2; done'

echo "Running load test (30s)..."
INGEST_BASE_URL=http://localhost:3001 LOAD_DURATION_S=30 \
  tsx scripts/loadtest.ts

echo "Demo complete. Dashboard: http://localhost:3000"
echo "To stop: docker compose down -v"
```

Also add `pnpm demo` to root package.json scripts: `"demo": "bash scripts/demo.sh"` — gives the single-command entry point D-04 requires.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ephemeral Postgres for kill-test | Custom Docker API wrapper | `@testcontainers/postgresql` + dockerode for pause | testcontainers handles start, port mapping, health wait, cleanup via Ryuk |
| HMAC per-request in load test | Custom fetch loop | autocannon `requests[]` with `setupRequest` | autocannon tracks RPS, latency, error rates — a raw loop gives no metrics |
| Browser E2E automation | Fetch + DOM assertion scripts | Playwright | Cross-browser, async-safe, auto-wait, screenshot on failure |
| Docker image CI publishing | Bash docker push scripts | `docker/build-push-action@v6` | Handles multi-platform, layer caching, GHCR auth, and conditional push cleanly |
| Test DLQ seeding | Prisma direct insert | mock-crm fail-mode → real event flow | Direct DB seed bypasses the actual worker path; fail-mode seeding exercises the real DLQ flow end-to-end |

---

## Common Pitfalls

### Pitfall 1: Calling `container.pause()` on `StartedTestContainer` — Method Does Not Exist

**What goes wrong:** The `StartedTestContainer` object returned by `await pg.start()` in testcontainers-node v12 does NOT have a `.pause()` or `.unpause()` method. Calling it throws `TypeError: container.pause is not a function`.

**Why it happens:** The CONTEXT.md decision D-05 references `container.pause()`, which exists in testcontainers-java but was never implemented in testcontainers-node. The Node library only exposes `stop()`, `restart()`, `exec()`, and `logs()`.

**How to avoid:** Use dockerode directly with the container ID:
```typescript
import Dockerode from "dockerode";
const docker = new Dockerode();
const dockerContainer = docker.getContainer(pg.getId());
await dockerContainer.pause();
// ... test assertions ...
await dockerContainer.unpause();
```
`dockerode` is already a transitive dependency of `testcontainers` — no extra install needed. Import it as a type-only dep in the test file. `pg.getId()` returns the full container ID string.

**Warning signs:** TypeScript compile error `Property 'pause' does not exist on type 'StartedTestContainer'` — this will surface immediately during type-check.

### Pitfall 2: buildProcessor Signature Change (Phase 4 Addition)

**What goes wrong:** The existing `concurrency.test.ts` and `idempotency.test.ts` call `buildProcessor(prisma, logger)` with 2 arguments. Phase 4 changed the signature to `buildProcessor(prisma, logger, crmClient, crmPolicy, ttlMs)` — 5 arguments. The Testcontainers kill-test calling `buildProcessor` directly must provide all 5 arguments (including a stub `crmClient` and `crmPolicy`).

**How to avoid:** Inspect the current `event.processor.ts` signature before writing the test. The processor needs:
- `prisma` — Testcontainers-backed client
- `logger` — noop logger
- `crmClient` — stub that returns `Promise.resolve()` (we're testing DB durability, not CRM sync)
- `crmPolicy` — stub/no-op policy (or use `cockatiel.bulkhead(1, 1)` with a pass-through)
- `ttlMs` — any number (e.g., `60_000`)

Existing integration tests (`idempotency.test.ts`, `concurrency.test.ts`) also need to be checked — they may already be failing if they still call the old 2-arg form. Research shows those tests were written before the Phase 4 signature change and may need the stub deps added.

### Pitfall 3: Playwright E2E Timing — DLQ Seeding Race

**What goes wrong:** The DLQ is seeded by firing a webhook and waiting for the worker to exhaust retries. With Phase 4's jitter + exponential backoff (up to 5 attempts), the total wait time can be 30–60 seconds. If the Playwright test runs before the DLQ entry exists, the table appears empty and the test fails.

**How to avoid:**
- In the CI job, add an explicit wait step after seeding: poll the API's `GET /admin/dlq` endpoint until at least 1 entry appears, with a 120-second timeout.
- In the Playwright test, use `page.waitForSelector("table tbody tr", { timeout: 30_000 })` before asserting count.
- Set mock-crm to `fail` mode with `rate: 1.0` before firing the event — guaranteed failure on every attempt.

### Pitfall 4: Dashboard Port Not Exposed in docker-compose.yml

**What goes wrong:** The existing `docker-compose.yml` does not include the `dashboard` service — it has api, worker, postgres, redis, mock-crm. Playwright needs to reach the Next.js dashboard.

**How to avoid:** Add the `apps/dashboard` service to `docker-compose.yml` for the E2E job. The dashboard Dockerfile (already exists, confirmed) needs to be built and exposed on port 3000. The `NEXT_PUBLIC_API_URL` env var needs to be set to `http://localhost:3001` (or the API service name inside the compose network: `http://api:3001`).

**Note:** The compose dashboard service only needs to be running for the E2E job, not for the existing unit/integration test job. Consider a separate `docker-compose.e2e.yml` or an override file, or just add it to `docker-compose.yml` since it's harmless for non-E2E use.

### Pitfall 5: GHCR Image Visibility Defaults to Private

**What goes wrong:** After the first push to GHCR, the image is private by default. A recruiter trying `docker pull ghcr.io/afrizzal/omnisync-api:latest` gets a 403. The "one-command demo" story collapses.

**How to avoid:** After the first successful push, navigate to each package on GitHub → Package Settings → Change visibility to Public. This is a one-time manual step. Note it in the PLAN as a post-deployment checklist item.

### Pitfall 6: Testcontainers on GitHub Actions — RYUK_DISABLED May Be Needed

**What goes wrong:** On some GitHub Actions configurations, the Ryuk reaper container fails to start due to Docker daemon permission configuration, causing testcontainers to hang indefinitely at test startup.

**How to avoid:** If the kill-test hangs in CI with no output for >30 seconds, set `TESTCONTAINERS_RYUK_DISABLED=true` in the CI environment. This disables automatic cleanup but GitHub Actions runners are ephemeral anyway — containers are destroyed with the runner at job end.

### Pitfall 7: turbo.json `env` Missing New Env Vars for New Tests

**What goes wrong:** Turborepo v2 operates in strict env mode. Any env var used in a test that is not declared in `turbo.json`'s `env[]` array is ignored by the Turbo cache, and tests may use stale cached results from a run with different env values. Worse, the test itself may see the variable as `undefined` if Turbo strips undeclared env vars.

**How to avoid:** When the TST-02 durability test uses any new env vars (e.g., `TESTCONTAINERS_RYUK_DISABLED`), add them to the `test.env[]` array in `turbo.json`. The existing entries cover `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `WORKER_CONCURRENCY`. This lesson was learned in Phase 3 (see STATE.md).

---

## Code Examples

### Testcontainers Postgres Container + Dockerode Pause

```typescript
// apps/worker/tests/integration/durability.test.ts
// Source: node.testcontainers.org + dockerode docs (v5.0.0)
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import Dockerode from "dockerode";
import { createPrismaClient } from "@omnisync/db";
import { buildProcessor } from "../../src/processor/event.processor.js";

let pg: Awaited<ReturnType<typeof new PostgreSqlContainer().start>>;
let docker: Dockerode;

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16")
    .withDatabase("omnisync_test")
    .withUsername("test")
    .withPassword("test")
    .start();
  docker = new Dockerode();
}, 60_000);

afterAll(async () => {
  await pg.stop();
});

it("TST-02: in-flight events survive Postgres outage", async () => {
  const prisma = createPrismaClient({
    max: 5,
    // Override DATABASE_URL to point at the testcontainers Postgres
    // (via prisma.config.ts env override or direct PrismaClient constructor)
    url: pg.getConnectionUri(),
  });
  // ... apply migrations, build noop crmClient/crmPolicy, call buildProcessor ...

  const dockerContainer = docker.getContainer(pg.getId());

  // Start processing jobs — they will try to reach Postgres
  const processingPromises = /* ... fire N events ... */ [];

  // Pause mid-flight (simulates DB becoming unreachable)
  await dockerContainer.pause();
  await new Promise(r => setTimeout(r, 300)); // let in-flight requests fail

  // Assert jobs are still in queue, not dropped
  const surviving = await queue.count();
  expect(surviving).toBeGreaterThan(0);

  // Restore DB
  await dockerContainer.unpause();

  // Wait for drain with bounded poll
  await expect(waitForDrain(prisma, expectedCount, 30_000)).resolves.toBe(expectedCount);

  await prisma.$disconnect();
}, 60_000);
```

### autocannon with Per-Source HMAC (D-14)

```typescript
// scripts/loadtest.ts (tsx)
import autocannon from "autocannon";
import { createHmac } from "node:crypto";

const BASE_URL = process.env.INGEST_BASE_URL ?? "http://localhost:3001";
const DURATION = Number(process.env.LOAD_DURATION_S ?? "30");
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? "10");

const sources = ["shopee", "tokopedia", "meta", "crm"] as const;
type Source = typeof sources[number];

function makeRequest(source: Source) {
  const secret = process.env[`WEBHOOK_SECRET_${source.toUpperCase()}`] ?? "dev-secret";
  return {
    path: `/ingest/${source}`,
    method: "POST" as const,
    setupRequest: (req: autocannon.Request) => {
      const body = JSON.stringify({
        eventType: "order.created",
        externalId: `load-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        occurredAt: new Date().toISOString(),
        payload: { amount: Math.floor(Math.random() * 1000) },
      });
      const sig = createHmac("sha256", secret).update(body).digest("hex");
      req.body = body;
      (req.headers as Record<string, string>)["content-type"] = "application/json";
      (req.headers as Record<string, string>)["x-signature"] = sig;
      return req;
    },
  };
}

const result = await autocannon({
  url: BASE_URL,
  connections: CONNECTIONS,
  duration: DURATION,
  requests: sources.map(makeRequest),
});

autocannon.printResult(result);
process.exit(result.errors > 0 ? 1 : 0);
```

### GHCR Push Workflow Snippet (D-09)

```yaml
# Append as a new job in .github/workflows/ci.yml
docker:
  runs-on: ubuntu-latest
  needs: verify
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - name: Log in to GHCR
      if: github.ref == 'refs/heads/master'
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push api
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/api/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/${{ github.repository_owner }}/omnisync-api:latest
          ghcr.io/${{ github.repository_owner }}/omnisync-api:${{ github.sha }}

    - name: Build and push worker
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/worker/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/${{ github.repository_owner }}/omnisync-worker:latest
          ghcr.io/${{ github.repository_owner }}/omnisync-worker:${{ github.sha }}

    - name: Build and push mock-crm
      uses: docker/build-push-action@v6
      with:
        context: .
        file: apps/mock-crm/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/${{ github.repository_owner }}/omnisync-mock-crm:latest
          ghcr.io/${{ github.repository_owner }}/omnisync-mock-crm:${{ github.sha }}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| testcontainers v9–10 (had .pause() in some versions) | testcontainers v12 (no .pause()) | ~v11 refactor | Must use dockerode directly for pause/unpause |
| Vitest v3 coverage.all default true | Vitest v4 coverage.all removed, use coverage.include | v4.0.0 | Existing `coverage.include: ["src/**"]` is already correct — no change needed |
| `docker/build-push-action@v5` | `docker/build-push-action@v6` | 2025 | v6 is current; v5 still works but v6 recommended |
| autocannon v7 (no setupRequest per-request) | autocannon v8 (setupRequest callback) | ~2024 | `setupRequest` enables dynamic HMAC per request |
| Playwright v1.4x | Playwright v1.61.0 | 2025 | Current stable — no breaking changes in E2E patterns |

---

## Environment Availability Audit

| Dependency | Required By | Available on GH Actions ubuntu-latest | Notes |
|------------|------------|---------------------------------------|-------|
| Docker daemon | Testcontainers, docker compose, build-push | Yes (pre-installed) | No setup needed |
| docker compose v2 | E2E job, demo.sh | Yes (pre-installed on ubuntu-latest) | Use `docker compose` (not `docker-compose`) |
| Node.js 22 | All | Yes (via `actions/setup-node`) | Already set in ci.yml |
| Chromium (Playwright) | TST-04 E2E | Installed via `playwright install --with-deps chromium` | Must add install step to E2E job |
| GITHUB_TOKEN | OPS-01 GHCR push | Auto-available | No manual secret; needs `packages: write` permission |

**Local dev (reviewer machine) for demo:**

| Dependency | Required | Assumed Available | Notes |
|------------|----------|-------------------|-------|
| Docker Desktop / Docker Engine | docker compose up, demo.sh | Must be installed by reviewer | Standard dev tool; document in README |
| Node.js 22 + pnpm | `pnpm demo`, `tsx scripts/loadtest.ts` | Must be installed | Already documented in project README |
| `.env` file | Compose stack env vars | Must exist (based on `.env.example`) | Add demo-specific defaults to `.env.example` |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (apps/api, apps/worker); Playwright 1.61.0 (e2e/) |
| Config file | `apps/api/vitest.config.ts`, `apps/worker/vitest.config.ts`, `e2e/playwright.config.ts` (new) |
| Quick run (unit only) | `pnpm --filter @omnisync/api test` / `pnpm --filter @omnisync/worker test` |
| Full suite command | `pnpm test -- --coverage` |
| E2E command | `npx playwright test` (requires compose stack running) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TST-01 | ≥80% line coverage gate | Coverage threshold | `pnpm test -- --coverage` (fails if <80%) | ✅ thresholds already set |
| TST-02 | Kill-PG mid-flight: zero events dropped | Integration (Testcontainers) | `pnpm --filter @omnisync/worker test` (includes durability.test.ts) | ❌ Wave 0 gap |
| TST-03 | 50 concurrent identical → 1 stored row | Integration (existing) | `pnpm --filter @omnisync/worker test` | ✅ `idempotency.test.ts` |
| TST-04 | DLQ re-queue flow E2E | Playwright E2E | `npx playwright test` (requires stack) | ❌ Wave 0 gap |
| OPS-01 | GHCR push on master | CI (GitHub Actions) | Manual: merge to master | ❌ Wave 0 gap (ci.yml extension) |
| OPS-03 | One-command demo entrypoint | Manual smoke test | `bash scripts/demo.sh` | ❌ Wave 0 gap |
| OPS-04 | Load-test multi-channel script | Manual smoke test | `tsx scripts/loadtest.ts` | ❌ Wave 0 gap |

### Sampling Rate

- **Per task commit:** `pnpm test` (no coverage, fast) for the app under change
- **Per wave merge:** `pnpm test -- --coverage` (full coverage gate)
- **Phase gate:** Full suite green + `playwright test` green (requires compose stack) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/worker/tests/integration/durability.test.ts` — covers TST-02 (Testcontainers kill-PG)
- [ ] `e2e/playwright.config.ts` — Playwright config for TST-04
- [ ] `e2e/dlq-requeue.spec.ts` — TST-04 DLQ re-queue flow
- [ ] `.github/workflows/ci.yml` extension — docker job for OPS-01
- [ ] `scripts/loadtest.ts` — OPS-04 autocannon script
- [ ] `scripts/demo.sh` — OPS-03 one-command demo entrypoint
- [ ] Framework installs:
  - `pnpm add -D @testcontainers/postgresql testcontainers --filter @omnisync/worker`
  - `pnpm add -D @playwright/test autocannon @types/autocannon --workspace-root`
- [ ] `turbo.json` — add `TESTCONTAINERS_RYUK_DISABLED` to `test.env[]` if needed

---

## Open Questions

1. **buildProcessor signature compatibility with existing integration tests**
   - What we know: `event.processor.ts` now takes 5 args (prisma, logger, crmClient, crmPolicy, ttlMs)
   - What's unclear: Whether `idempotency.test.ts` and `concurrency.test.ts` already pass stubs for the new args or still use the old 2-arg form
   - Recommendation: Read both test files at planning time and add stub CRM deps if needed. If the tests are already broken, that's a Wave 0 fix before TST-02.

2. **Dashboard in docker-compose.yml**
   - What we know: `docker-compose.yml` has api/worker/postgres/redis/mock-crm — no dashboard service
   - What's unclear: Whether a dashboard Dockerfile exists and what port it uses (Next.js default 3000)
   - Recommendation: The planner should check `apps/dashboard/Dockerfile` and add the service to compose with `port: "3000:3000"`. If Dockerfile doesn't exist, Wave 0 must create it.

3. **`.env` configuration for demo**
   - What we know: `docker compose` uses `.env` for all services; `.env` is gitignored
   - What's unclear: Whether a `.env.example` exists with `WEBHOOK_SECRET_*` values
   - Recommendation: Add a `.env.example` with safe dev defaults for all required vars (including `WEBHOOK_SECRET_SHOPEE`, etc.) and verify `demo.sh` fails fast if `.env` is missing.

---

## Project Constraints (from CLAUDE.md)

- **Runtime:** Node.js 22 LTS; TypeScript v5 strict; ESM-native (`"type": "module"`)
- **Test framework:** Vitest 4.x (unit/integration), Playwright (E2E) — Jest is forbidden
- **Package manager:** pnpm workspaces — use `--filter` for package-scoped installs
- **Commits:** Conventional Commits `type(06): summary` for all Phase 6 commits; atomic (one logical change, green tree per commit)
- **Budget:** Zero-cost — no paid hosting; GHCR is free for public repos
- **Quality bar:** ≥80% line coverage on `apps/api` + `apps/worker` — CI must gate on this
- **No direct repo edits** outside GSD workflow (CLAUDE.md GSD Workflow Enforcement)
- **Biome** for lint/format (not ESLint/Prettier) — Phase 1 established this
- **Imports:** `zod/v4` subpath; `{ Redis }` named import from ioredis; ESM `.js` extensions in imports

---

## Sources

### Primary (HIGH confidence)
- `node.testcontainers.org/features/containers/` — `StartedTestContainer` API, confirmed no `.pause()` method
- `github.com/testcontainers/testcontainers-node/blob/main/packages/testcontainers/src/container-runtime/clients/container/docker-container-client.ts` — source confirms no pause in DockerContainerClient
- `npm view testcontainers version` → 12.0.3 (verified live)
- `npm view @testcontainers/postgresql version` → 12.0.3 (verified live)
- `npm view @playwright/test version` → 1.61.0 (verified live)
- `npm view autocannon dist-tags` → 8.0.0 latest (verified live)
- `npm view @types/autocannon version` → 7.12.7 (verified live)
- `playwright.dev/docs/test-configuration` — baseURL, retries, workers:1 in CI, no webServer for external stacks
- `docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows` — GHCR + GITHUB_TOKEN + `packages: write`
- Existing `apps/worker/tests/integration/idempotency.test.ts` — buildProcessor call pattern confirmed
- Existing `apps/worker/tests/integration/concurrency.test.ts` — integration test structure confirmed
- Existing `apps/api/vitest.config.ts`, `apps/worker/vitest.config.ts` — `thresholds: { lines: 80 }` confirmed present

### Secondary (MEDIUM confidence)
- `vitest.dev/config/coverage` — threshold behavior; non-zero exit on miss (documented behavior, not re-verified by running)
- `docs.docker.com/build/ci/github-actions/` — `push: ${{ github.ref == 'refs/heads/master' }}` conditional pattern
- `autocannon` README (via `github.com/mcollina/autocannon`) — `requests[]` array + `setupRequest` callback documented

### Tertiary (LOW confidence)
- Community pattern for dockerode `.pause()` workaround (multiple sources confirm dockerode `.pause()/.unpause()` on a container object via container ID works; not from official testcontainers docs)

---

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — all versions verified via `npm view`
- Testcontainers pause workaround: MEDIUM — confirmed via source inspection that `.pause()` doesn't exist; dockerode approach is the correct workaround but not from official testcontainers docs
- Architecture patterns: HIGH — based on existing codebase + official docs
- Pitfalls: HIGH — buildProcessor signature verified by reading source; most pitfalls verified against existing code
- GHCR push: HIGH — verified against GitHub official docs

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable ecosystem; testcontainers, Playwright version changes unlikely to matter within 30 days)
