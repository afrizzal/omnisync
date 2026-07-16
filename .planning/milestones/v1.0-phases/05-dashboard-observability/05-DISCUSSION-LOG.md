# Phase 5: Dashboard & Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 05-dashboard-observability
**Areas discussed:** Live update strategy, Metrics data source (OBS-02), Dashboard UI framework, Chart / visualization for demo page

---

## Live Update Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| SSE (Server-Sent Events) | Next.js Route Handler streams via EventSource. No extra deps. | |
| Polling (setInterval fetch) | Client fetches /api/metrics on a fixed interval. Simplest approach. | ✓ |
| WebSockets | Bidirectional, overkill for one-way metrics feed. | |

**User's choice:** Polling (setInterval fetch)
**Notes:** Configurable interval via `DASHBOARD_POLL_INTERVAL_MS` env var, default 3000ms.

---

## Metrics Data Source (OBS-02)

### OBS-02 approach

| Option | Description | Selected |
|--------|-------------|----------|
| Lightweight JSON API endpoint | GET /api/metrics on Fastify — BullMQ counts + Prisma aggregates | ✓ |
| Full OpenTelemetry SDK | @opentelemetry/sdk-node, metrics pipeline, Prometheus endpoint | |
| BullMQ Bull-Board UI only | Mount @bull-board/fastify — visualizer only, no numeric metrics | |

**User's choice:** Lightweight JSON API endpoint

### Bull-Board addition

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add Bull-Board | Mount @bull-board/fastify at /admin/queues alongside metrics endpoint | ✓ |
| No — JSON endpoint only | Keep lean, no extra dep | |

**User's choice:** Yes — add Bull-Board

### Metric fields

| Option | Description | Selected |
|--------|-------------|----------|
| BullMQ counts + DB counts | queue.getJobCounts() + total events + DLQ unresolved count | |
| BullMQ counts + throughput rate | Add rolling window (events completed in last 60s from events.createdAt) | ✓ |
| Just BullMQ counts | Simplest — queue.getJobCounts() only, no DB queries | |

**User's choice:** BullMQ counts + throughput rate (events completed in last 60s)

---

## Dashboard UI Framework

### UI approach

| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind CSS + shadcn/ui | Pre-built Radix components, 2025 standard, recruiter-grade visual quality | ✓ |
| Tailwind CSS only | Full control, more CSS to write, no component library dep | |
| No CSS framework — minimal HTML/CSS | Maximum minimalism, proof-of-concept only | |

**User's choice:** Tailwind CSS + shadcn/ui

### Color theme

| Option | Description | Selected |
|--------|-------------|----------|
| Dark mode (default dark) | Infrastructure aesthetic, matches Grafana/Vercel/Linear | |
| Light mode (default light) | Cleaner, conventional | |
| System-aware (respects OS preference) | next-themes, best of both | ✓ |

**User's choice:** System-aware (respects OS preference) via next-themes

---

## Chart / Visualization for Demo Page

### Chart library

| Option | Description | Selected |
|--------|-------------|----------|
| Recharts | React-native, SSR-compatible, composable, lightweight | ✓ |
| Chart.js + react-chartjs-2 | Older, heavier, requires canvas | |
| Custom SVG path (no library) | No dep, significant implementation work | |

**User's choice:** Recharts

### Chart series

| Option | Description | Selected |
|--------|-------------|----------|
| Events completed vs. events failed (cumulative over time) | Green/red dual series, directly shows reliability guarantee | ✓ |
| Events per second (throughput rate) + error rate | Rate-based, more dynamic, requires rolling window computation | |
| Queue depth over time (waiting + active) | Backpressure dynamics, less tied to success/failure story | |

**User's choice:** Cumulative completed vs. failed events over time

---

## Claude's Discretion

- Exact shadcn/ui component selection beyond named ones (Card, Table, Badge, Button)
- Whether app/page.tsx redirects or renders dashboard inline
- `useInterval` hook implementation details
- Recharts axis labels, tooltip format, color values
- Bull-Board authentication (deferred to Phase 6)
- File layout within apps/dashboard/app/

## Deferred Ideas

- Bull-Board authentication — unauthenticated in Phase 5; add in Phase 6
- Demo page "Start Load Test" button wiring to actual script — Phase 6 (OPS-04)
- Historical chart queries — client-side session data only in Phase 5
- Prometheus / OTLP exporter — skipped; v2 if needed
