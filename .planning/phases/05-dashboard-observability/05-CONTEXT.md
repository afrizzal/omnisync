# Phase 5: Dashboard & Observability - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the observability and live-demo layer on top of Phase 4's complete resilience infrastructure. This phase delivers:
- Structured pino log coverage for every event lifecycle transition (OBS-01)
- `GET /api/metrics` JSON endpoint on the Fastify API (OBS-02)
- Bull-Board queue UI mounted on the Fastify API (developer-visibility bonus)
- Next.js App Router dashboard with three live pages: `/dashboard` (metrics), `/dlq` (DLQ management), `/demo` (load-test chart)
- Tailwind CSS + shadcn/ui + next-themes for system-aware dark/light theme
- Recharts for the live load-test chart (DSH-04)

Requirements: **OBS-01, OBS-02, DSH-01, DSH-02, DSH-03, DSH-04**

This phase does NOT add testing infrastructure, CI gates, or deployment (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Live Update Mechanism (DSH-01, DSH-04)
- **D-01:** Use **client-side polling** (`setInterval` + `fetch`) — NOT SSE or WebSockets. Dashboard pages fetch `/api/metrics` (and `/api/dlq`) on a fixed interval. Simplest persistent-connection-free approach; easy to debug and test; works on Render free tier without a persistent connection server.
- **D-02:** Poll interval configurable via env var: `DASHBOARD_POLL_INTERVAL_MS` (default `3000` ms). Tight for demos, looseable for deployed free tier. Add to `@omnisync/config` Zod env schema as optional-with-default.
- **D-03:** Each dashboard page manages its own polling state in a React hook (`useInterval` pattern or a shared `useMetrics`/`useDlq` hook). No global state manager — React state + `useEffect` is sufficient.

### Metrics Data Source (OBS-02, DSH-01)
- **D-04:** Add `GET /api/metrics` route to the Fastify API (`apps/api`). This is the single source of truth for all dashboard numeric data. Returns JSON with:
  - `queue`: BullMQ `queue.getJobCounts()` result — `{ waiting, active, completed, failed, delayed }`
  - `events`: Prisma aggregate counts — `{ total: count of all events rows }`
  - `dlq`: `{ unresolved: count of dlq_events where resolved=false }`
  - `throughput`: `{ last60s: count of events with createdAt > (now - 60s) }` — rolling window from the `events` table
- **D-05:** The `/api/metrics` route requires the Prisma client and BullMQ queue injected via `AppDeps`. The `prisma` field in `AppDeps` is already optional; make it available for the metrics route alongside the admin routes (same guard: `if (deps.prisma)`).
- **D-06:** Add **Bull-Board** (`@bull-board/fastify` adapter) mounted at `/admin/queues` on the Fastify API. Gives a live visual job browser alongside the Next.js dashboard. Was deferred in Phases 3 and 4 — Phase 5 is the right moment. One dep, trivial to mount.

### Structured Logs (OBS-01)
- **D-07:** OBS-01 requires structured logs at every lifecycle transition. Audit of existing coverage:
  - `[worker] processing` — ✅ already logged in `event.processor.ts` (`logger.info({ jobId }, ...)`)
  - `[worker] completed` / `[worker] duplicate absorbed` — ✅ already logged
  - `[worker] failed` / `[worker] DLQ` — verify `dlq-handler.ts` emits a structured log on DLQ insertion; add if missing
  - `[ingest] received` — ❌ missing. Fastify `logger: true` logs HTTP requests but not a structured event-level log with fingerprint and source. Add a `logger.info({ fingerprint, source, eventType }, '[ingest] received')` call in the ingest route AFTER successful enqueue.
- **D-08:** Log field names follow existing pattern: `{ jobId, fingerprint, source, eventType }` as context fields + a bracketed prefix as the message string (`[worker] completed`, `[ingest] received`). Keep it consistent — the portfolio story is that logs are queryable/filterable in local `docker compose logs` output.

### Dashboard Pages (DSH-01, DSH-02, DSH-03, DSH-04)
- **D-09:** Three pages in the Next.js App Router:
  - `app/dashboard/page.tsx` — DSH-01: live queue metrics cards (waiting/active/completed/failed counts + throughput rate)
  - `app/dlq/page.tsx` — DSH-02/DSH-03: DLQ table with error detail + "Re-queue" button per row
  - `app/demo/page.tsx` — DSH-04: live Recharts AreaChart (cumulative completed vs. failed events over time)
  - `app/page.tsx` — redirect to `/dashboard` (or render the dashboard content directly)
- **D-10:** The dashboard fetches from the Fastify API, configured via `NEXT_PUBLIC_API_URL` env var (or `API_URL` for server-side fetches in Route Handlers). The URL points to `http://localhost:3001` (local) or the Render API service URL (deployed). Add to Next.js env schema in `next.config.js` or a dedicated `apps/dashboard/src/env.ts`.
- **D-11:** DLQ re-queue button calls `POST /admin/dlq/:id/requeue` (already implemented in Phase 4). Dashboard handles the three response states: `requeued`, `already_queued`, `not_found` — show toast/badge feedback.

### Dashboard UI (DSH-01..DSH-04)
- **D-12:** Use **Tailwind CSS + shadcn/ui** for all UI components. Components to use: `Card` (metrics stat blocks), `Table` + `TableRow` (DLQ list), `Badge` (status indicators: FAILED, RESOLVED), `Button` (Re-queue action). Install Tailwind + shadcn via `npx shadcn@latest init` in `apps/dashboard`.
- **D-13:** Theme: **system-aware dark/light** via `next-themes`. Install `next-themes` and wrap `app/layout.tsx` with `<ThemeProvider>`. shadcn ships with CSS variable-based theming that integrates cleanly.
- **D-14:** shadcn component variants: use `Card` for stat numbers on the dashboard page; `destructive` Badge variant for failed/DLQ counts; `outline` Button for Re-queue. Keep it clean and functional — this is an infrastructure demo, not a marketing page.

### Chart — Demo Page (DSH-04)
- **D-15:** Use **Recharts** (`recharts` npm package). Render an `AreaChart` (or `LineChart`) with two data series:
  - Series 1: `completed` — cumulative completed events (green/primary color)
  - Series 2: `failed` — cumulative failed events (red/destructive color)
- **D-16:** Data for the chart comes from the polling `/api/metrics` response. Each poll appends a data point `{ timestamp, completed, failed }` to a client-side array (React state). The chart renders the rolling window (last N points, e.g. 60 data points × 3s interval = 3 minutes of history). No server-side data storage for the chart — it's a live session view, not a historical query.
- **D-17:** The `/demo` page includes a simple "Start Load Test" button that calls a `POST /api/demo/start` endpoint (or invokes the demo script inline). This triggers the load-test/demo script to fire synthetic events — making the chart come alive in the browser. The demo script itself is Phase 6 (OPS-04); Phase 5 wires up the button and the chart visualization.

### Claude's Discretion
- Exact shadcn/ui component selection beyond the ones named above
- Whether `app/page.tsx` redirects or renders the dashboard content inline
- `useInterval` hook implementation details (standard pattern: `useEffect` + `setInterval` + cleanup)
- Exact Recharts `AreaChart` axis labels, tooltip format, color values
- Whether Bull-Board authentication is added (defer — not required in Phase 5, noted for Phase 6)
- Exact file layout within `apps/dashboard/app/` (loading states, error boundaries, client/server component split)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 requirements
- `.planning/REQUIREMENTS.md` — OBS-01, OBS-02, DSH-01, DSH-02, DSH-03, DSH-04 definitions
- `.planning/ROADMAP.md` — Phase 5 success criteria SC-1 through SC-5

### Prior phase foundations (read before extending)
- `.planning/phases/04-resilience-dynamic-routing/04-CONTEXT.md` — Re-queue API (D-16), circuit breaker, DLQ model shape
- `.planning/phases/03-worker-core-idempotent-persistence/03-CONTEXT.md` — ProcessorLogger interface (D-11), pino usage pattern (D-04)
- `.planning/phases/01-foundation-local-infra/01-CONTEXT.md` — ESM-native monorepo, two-URL Prisma pattern
- `.planning/research/STACK.md` — current package versions

### Source files this phase extends (read before implementing)
- `apps/api/src/app.ts` — add `/api/metrics` route; mount Bull-Board; `AppDeps.prisma` is already optional
- `apps/api/src/routes/admin.ts` — existing `/admin/dlq/:id/requeue` route (dashboard calls this)
- `apps/api/src/routes/ingest.ts` — add `[ingest] received` structured log after enqueue (D-07/D-08)
- `apps/worker/src/dlq/dlq-handler.ts` — verify DLQ log exists; add if missing (D-07)
- `apps/worker/src/processor/event.processor.ts` — existing log patterns to follow
- `apps/dashboard/app/layout.tsx` — wrap with ThemeProvider (next-themes)
- `apps/dashboard/app/page.tsx` — replace placeholder with dashboard content or redirect
- `apps/dashboard/package.json` — add: tailwindcss, shadcn, next-themes, recharts
- `packages/config/src/env.ts` — add `DASHBOARD_POLL_INTERVAL_MS` (optional-with-default)

### External library docs (researcher must fetch)
- Bull-Board Fastify adapter docs — `@bull-board/fastify` mounting API, latest version
- shadcn/ui Next.js setup docs — `npx shadcn@latest init` steps for Next.js 16 / App Router
- next-themes docs — ThemeProvider setup with App Router
- Recharts AreaChart docs — controlled data series, live-updating pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`buildApp(deps: AppDeps)`** (`apps/api/src/app.ts`) — DI factory; `prisma` already optional; add metrics route here alongside admin routes
- **`adminRoutes`** (`apps/api/src/routes/admin.ts`) — existing pattern for adding new routes to the API; metrics route follows the same shape
- **`requeueDlqEntry`** (`apps/api/src/services/requeue.ts`) — already implemented; dashboard `POST /admin/dlq/:id/requeue` call site is ready
- **`ProcessorLogger`** interface (`apps/worker/src/processor/event.processor.ts`) — `{ info, error }` — pino satisfies it; follow for any new log calls
- **`DeadLetterEvent` Prisma model** — `id`, `fingerprint`, `source`, `eventType`, `payload`, `failureReason`, `errorStack`, `attempts`, `resolved`, `frozenAt` — all fields needed for DSH-02 DLQ table are present
- **`Event` Prisma model** — `createdAt` index already exists — rolling throughput query is efficient
- **`@omnisync/config` env schema** — add `DASHBOARD_POLL_INTERVAL_MS` here (optional, number, default 3000)

### Established Patterns
- DI factory pattern (`buildApp`, `buildWorker`) — add metrics route the same way
- Zod-validated env with optional-with-default (`WORKER_CONCURRENCY` pattern) — follow for `DASHBOARD_POLL_INTERVAL_MS`
- Conventional Commits `type(NN): summary` — Phase 5 scope is `(05)`
- ESM-native throughout — `import type` for type-only imports, `zod/v4` subpath

### Integration Points
- Fastify API → `/api/metrics` (new) → BullMQ `queue.getJobCounts()` + Prisma aggregates
- Fastify API → `/admin/queues` (new) → Bull-Board UI (read-only job browser)
- Next.js dashboard → polls `/api/metrics` every `DASHBOARD_POLL_INTERVAL_MS` ms
- Next.js dashboard → calls `POST /admin/dlq/:id/requeue` on button click
- `apps/api/src/routes/ingest.ts` → emit `[ingest] received` log after `queue.add()`
- `apps/worker/src/dlq/dlq-handler.ts` → emit `[worker] DLQ` log on DLQ insertion (verify/add)

</code_context>

<specifics>
## Specific Ideas

- **"Polling over SSE"** is the explicit choice — simplest, no persistent connection, works anywhere. The 3s default is tight enough to look live under a load test.
- **Bull-Board at `/admin/queues`** is the live-demo bonus — shows the BullMQ internals directly. Worth the one extra dep.
- **Cumulative completed vs. failed on the chart** — this directly visualizes the resilience guarantee. Green growing, red staying low (or spiking when the circuit breaker opens) is the portfolio money shot.
- **`DASHBOARD_POLL_INTERVAL_MS` env var** — can be set to 1000 for a dramatic live demo, 10000 for deployed free tier to save request budget.
- **System-aware theme** — `next-themes` with shadcn CSS variables is the standard 2025 pattern. No extra config cost.

</specifics>

<deferred>
## Deferred Ideas

- **Bull-Board authentication** — `/admin/queues` is unauthenticated in Phase 5. Add basic auth in Phase 6 alongside deployment hardening.
- **`/demo` page "Start Load Test" button** — the button UI and wiring is in Phase 5; the actual demo script that fires synthetic events is Phase 6 (OPS-04). The demo page still has value without the button — the chart visualizes any in-flight events.
- **Historical chart queries** — Phase 5 chart shows live session data only (client-side state array). Historical event timelines (querying DB for past runs) could be Phase 6 or v2.
- **`GET /readyz` readiness endpoint** — deferred from Phase 2; Phase 6 deployment context.
- **Dashboard authentication** (AUTH-01) — v2 requirement; not in Phase 5 or 6.
- **Prometheus / OTLP exporter** — Full OpenTelemetry pipeline skipped; if the portfolio needs it, it's a standalone addition in v2.

None.

</deferred>

---

*Phase: 05-dashboard-observability*
*Context gathered: 2026-06-14*
