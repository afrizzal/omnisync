---
phase: 05-dashboard-observability
plan: "04"
subsystem: dashboard
tags: [recharts, demo, live-chart, sse-polling, dsh-04]
dependency_graph:
  requires: [05-01, 05-02]
  provides: [DSH-04]
  affects: [apps/dashboard/app/demo/page.tsx]
tech_stack:
  added: []
  patterns:
    - Client-side poll accumulation with rolling 60-point window (setInterval + useState array)
    - Recharts 3.x AreaChart with two series, isAnimationActive=false for live data
    - Empty-state guard before first data point arrives
key_files:
  created:
    - apps/dashboard/app/demo/page.tsx
  modified: []
decisions:
  - "D-15: Two AreaChart series — completed (green) + failed (red) — visualize resilience guarantee live"
  - "D-16: Client-side accumulation into 60-point rolling window; polling in useEffect with clearInterval cleanup"
  - "D-17: Start Load Test button (default variant) POSTs to /api/demo/start stub; real load script deferred to Phase 6 OPS-04"
metrics:
  duration_minutes: 8
  completed_date: "2026-06-14"
  tasks_completed: 1
  files_changed: 1
---

# Phase 05 Plan 04: /demo Live Load Test AreaChart Summary

**One-liner:** Recharts 3.x AreaChart at /demo accumulates /api/metrics polls into a rolling 60-point two-series (green completed / red failed) live chart with a "Start Load Test" button wired to POST /api/demo/start.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | /demo page — Recharts AreaChart + Start Load Test button (DSH-04) | e87b99c | apps/dashboard/app/demo/page.tsx |

## What Was Built

Created `apps/dashboard/app/demo/page.tsx` — a `"use client"` Next.js App Router page that:

1. **Polls `/api/metrics`** on a `setInterval` at `POLL_INTERVAL_MS` (3 s default), making an immediate first fetch so the chart populates without waiting a full interval.

2. **Accumulates a rolling window** of at most `MAX_POINTS = 60` data points: `{ timestamp, completed, failed }` — each tick appends one point and slices off the oldest if the array exceeds 60 items.

3. **Renders a two-series Recharts AreaChart** (Recharts 3.x safe API only — no removed 2.x props):
   - `completed` area: stroke `#22c55e`, fill `#bbf7d0` (green)
   - `failed` area: stroke `#ef4444`, fill `#fecaca` (red)
   - `isAnimationActive={false}` prevents jitter on live-updating data

4. **Empty state** before data arrives: heading "Waiting for events" + body "Click 'Start Load Test' to fire synthetic events and watch the chart populate in real time."

5. **Start Load Test button** (shadcn `Button` default variant — primary accent CTA) POSTs to `/api/demo/start`; shows inline "Load test started." or error message without crashing the page.

6. **useEffect cleanup** returns `() => { active = false; clearInterval(id); }` preventing state updates after unmount.

## Verification

- `pnpm --filter @omnisync/dashboard typecheck` exits 0 (verified)
- All 9 acceptance criteria confirmed present in the file

## Deviations from Plan

None — plan executed exactly as written. The reference implementation from the plan was used directly (adapted from process.env inline reads to the Plan 05-02 `@/lib/api` helpers as specified).

## Known Stubs

- **POST /api/demo/start** is a stub in Plan 05-01 (returns 202 `{ status: "started" }` without firing real synthetic events). The real load-test script is deferred to Phase 6 / OPS-04. The button is fully wired; clicking it will succeed visually once the Phase 6 script wires the actual event firing. This is intentional per D-17 and the plan objective.

## Self-Check: PASSED

- `apps/dashboard/app/demo/page.tsx` — FOUND (created in worktree, commit e87b99c)
- Commit e87b99c — FOUND in git log
