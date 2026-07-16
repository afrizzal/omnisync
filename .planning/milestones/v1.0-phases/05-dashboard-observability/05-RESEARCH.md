# Phase 5: Dashboard & Observability - Research

**Researched:** 2026-06-14
**Domain:** Next.js 16 App Router dashboard, shadcn/ui + Tailwind v4, Recharts live charts, bull-board Fastify adapter, structured pino logs, BullMQ metrics
**Confidence:** HIGH (all critical library versions verified via web; code context read from codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use **client-side polling** (`setInterval` + `fetch`) for live updates — NOT SSE or WebSockets. Dashboard pages fetch `/api/metrics` (and `/api/dlq`) on a fixed interval.
- **D-02:** Poll interval via env var `DASHBOARD_POLL_INTERVAL_MS` (default `3000` ms). Add to `@omnisync/config` Zod env schema as optional-with-default.
- **D-03:** Each dashboard page manages its own polling state in a React hook (`useInterval` pattern or shared `useMetrics`/`useDlq` hook). No global state manager.
- **D-04:** Add `GET /api/metrics` route to Fastify API. Returns JSON: `{ queue: { waiting, active, completed, failed, delayed }, events: { total }, dlq: { unresolved }, throughput: { last60s } }`.
- **D-05:** The `/api/metrics` route uses `AppDeps.prisma` (already optional) for Prisma aggregates + BullMQ `queue.getJobCounts()`.
- **D-06:** Add **Bull-Board** (`@bull-board/fastify` adapter) mounted at `/admin/queues` on the Fastify API.
- **D-07:** Audit log coverage. Add `[ingest] received` structured log after successful enqueue in `ingest.ts`. Verify DLQ log in `dlq-handler.ts` (already present: `[worker] job exhausted -> DLQ`). Processing + completed logs already exist in `event.processor.ts`.
- **D-08:** Log field names: `{ jobId, fingerprint, source, eventType }` as context fields + bracketed prefix as message string.
- **D-09:** Three Next.js App Router pages: `app/dashboard/page.tsx` (DSH-01), `app/dlq/page.tsx` (DSH-02/DSH-03), `app/demo/page.tsx` (DSH-04). `app/page.tsx` redirects or renders dashboard inline.
- **D-10:** Dashboard fetches from Fastify API via `NEXT_PUBLIC_API_URL` env var (`http://localhost:3001` local, Render URL deployed).
- **D-11:** DLQ re-queue button calls `POST /admin/dlq/:id/requeue` (existing). Dashboard handles `requeued`, `already_queued`, `not_found` responses with toast/badge feedback.
- **D-12:** **Tailwind CSS + shadcn/ui** for all UI. Components: `Card`, `Table`/`TableRow`, `Badge`, `Button`. Install via `pnpm dlx shadcn@latest init` in `apps/dashboard`.
- **D-13:** **next-themes** for system-aware dark/light theme. Wrap `app/layout.tsx` with `<ThemeProvider>`.
- **D-14:** shadcn variants: `Card` for stat numbers, `destructive` Badge for failed/DLQ, `outline` Button for Re-queue.
- **D-15:** Use **Recharts** `AreaChart` (or `LineChart`) with two series: `completed` (green/primary) and `failed` (red/destructive).
- **D-16:** Chart data: each poll appends `{ timestamp, completed, failed }` to client-side React state array. Rolling window of last N points (e.g. 60 × 3s = 3 min). No server-side chart storage.
- **D-17:** `/demo` page includes "Start Load Test" button wired to `POST /api/demo/start`. Demo script itself is Phase 6 (OPS-04).

### Claude's Discretion

- Exact shadcn/ui component selection beyond named ones
- Whether `app/page.tsx` redirects or renders dashboard content inline
- `useInterval` hook implementation details
- Exact Recharts `AreaChart` axis labels, tooltip format, color values
- Whether Bull-Board authentication is added (defer to Phase 6)
- Exact file layout within `apps/dashboard/app/`

### Deferred Ideas (OUT OF SCOPE)

- Bull-Board authentication (Phase 6)
- `/demo` "Start Load Test" actual demo script (Phase 6, OPS-04)
- Historical chart queries (Phase 6 or v2)
- `GET /readyz` readiness endpoint (Phase 6)
- Dashboard authentication (AUTH-01, v2)
- Prometheus / OTLP exporter (v2)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | System emits structured logs for each event lifecycle transition (received, processing, completed, failed, DLQ) | D-07/D-08: pino patterns exist in codebase; `[ingest] received` is the only gap; dlq-handler already has the log |
| OBS-02 | System exposes metrics for throughput, queue latency, retry counts, and error distribution | D-04/D-05: `GET /api/metrics` on Fastify using BullMQ `getJobCounts()` + Prisma aggregates |
| DSH-01 | Dashboard shows live queue and throughput metrics | D-01/D-03/D-04/D-09: polling hook + `/api/metrics` route + `app/dashboard/page.tsx` |
| DSH-02 | Dashboard lists failed/DLQ jobs with error detail | D-04/D-09/D-12: `/api/dlq` endpoint (or metrics route) + `app/dlq/page.tsx` + Table + Badge |
| DSH-03 | Dashboard provides one-click re-queue action for a DLQ job | D-11: existing `POST /admin/dlq/:id/requeue` endpoint; Re-queue Button in DLQ table |
| DSH-04 | Dashboard visualizes a live load test (events processed vs failed over time) | D-15/D-16/D-17: Recharts AreaChart fed from polling state accumulation |
</phase_requirements>

---

## Summary

Phase 5 builds the observability and live-demo layer on top of a complete Phase 4 resilience infrastructure. The backend work is minimal: add one `GET /api/metrics` JSON route to the Fastify API, mount bull-board at `/admin/queues`, add one missing structured log call in `ingest.ts`, and add `DASHBOARD_POLL_INTERVAL_MS` to the Zod env schema. The bulk of the work is the Next.js dashboard: three App Router pages using shadcn/ui + Tailwind v4, next-themes, and Recharts for the live chart.

The most important architectural insight is the **client-side polling model** (locked decision D-01): each "use client" page component runs `setInterval` + `fetch` to hit the Fastify `/api/metrics` endpoint. This is the simplest possible real-time mechanism — it requires `@fastify/cors` to be registered on the Fastify API (currently absent), which is the single new API-side plugin dependency. The `/api/dlq` list endpoint also needs to be added to serve the DLQ table page.

The Recharts `AreaChart` in the demo page uses client-side React state accumulation: each poll appends one data point to a rolling array. This is entirely client-side — no server-side timeseries storage. The only structural caution is that **Recharts 3.x (current) has breaking changes from 2.x** (internal state hooks, `CategoricalChartState` removal) — all code must target the 3.x API.

**Primary recommendation:** Implement in wave order — (1) `GET /api/metrics` + CORS + log gap + env var, (2) shadcn/ui scaffold + ThemeProvider + layout, (3) `/dashboard` + `/dlq` pages with polling hooks, (4) `/demo` page with Recharts chart, (5) bull-board mount.

---

## Standard Stack

### Core (all locked by CONTEXT.md decisions)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Next.js | 16.2.7 (already installed) | Dashboard app | Already in `apps/dashboard/package.json` |
| React | 19.2.7 (already installed) | Component runtime | Already installed |
| Tailwind CSS | 4.3.1 (current) | Utility CSS | shadcn/ui v4 requires Tailwind v4; zero config file needed |
| shadcn/ui (CLI) | `shadcn@latest` | Component scaffolding | CLI copies components into `apps/dashboard/components/ui/` |
| next-themes | 0.4.6 (current) | Dark/light system theme | Standard App Router theming; `suppressHydrationWarning` required |
| Recharts | 3.8.1 (current) | AreaChart for demo page | React+D3 chart library; 3.x requires React 16.8+, TypeScript 5.x |
| @bull-board/api | 6.16.2 (current) | Bull-board core | Required peer for the Fastify adapter |
| @bull-board/fastify | 6.16.2 (current) | Bull-board Fastify adapter | Mounts queue browser as Fastify plugin at `/admin/queues` |
| @fastify/cors | latest | CORS for dashboard polling | Dashboard at :3000 fetches Fastify at :3001 — cross-origin without CORS headers returns network error |

### Already Installed (no new install needed)

| Library | Version | Notes |
|---------|---------|-------|
| pino | via Fastify | `app.log.info(...)` already works; no extra install |
| BullMQ | 5.77.x | `queue.getJobCounts()` method available |
| Prisma | 7.x | `prisma.event.count()`, `prisma.deadLetterEvent.count()`, `prisma.deadLetterEvent.findMany()` |
| @fastify/helmet | 13.0.2 | Already registered in `buildApp` |
| @fastify/sensible | 6.0.4 | Already registered in `buildApp` |

### Installation Commands

```bash
# In apps/dashboard:
pnpm add tailwindcss recharts next-themes
pnpm dlx shadcn@latest init   # scaffolds components/ui/, globals.css @theme, lib/utils.ts

# Add individual shadcn components after init:
pnpm dlx shadcn@latest add card table badge button

# In apps/api:
pnpm add @bull-board/api @bull-board/fastify @fastify/cors
```

### Version Verification (checked 2026-06-14)

| Package | Verified Version | Source |
|---------|-----------------|--------|
| tailwindcss | 4.3.1 | npm registry (published June 13, 2026) |
| recharts | 3.8.1 | npm registry (published March 25, 2026) |
| next-themes | 0.4.6 | npm registry |
| @bull-board/fastify | 6.16.2 | npm registry (WebSearch confirmed, published ~9 days ago) |
| @bull-board/api | 6.16.2 | Same package family, aligned version |

---

## Architecture Patterns

### Recommended Project Structure

```
apps/dashboard/
├── app/
│   ├── layout.tsx              # ThemeProvider wrapper (use client providers.tsx pattern)
│   ├── page.tsx                # Redirect to /dashboard (or render inline)
│   ├── dashboard/
│   │   └── page.tsx            # DSH-01: live metrics cards (use client)
│   ├── dlq/
│   │   └── page.tsx            # DSH-02/DSH-03: DLQ table + re-queue (use client)
│   └── demo/
│       └── page.tsx            # DSH-04: Recharts AreaChart (use client)
├── components/
│   ├── ui/                     # shadcn/ui scaffolded components (Card, Table, Badge, Button)
│   └── providers.tsx           # "use client" ThemeProvider wrapper
├── hooks/
│   ├── usePolling.ts           # Generic setInterval + fetch hook
│   ├── useMetrics.ts           # Typed wrapper for /api/metrics polling
│   └── useDlq.ts               # Typed wrapper for /api/dlq polling
├── lib/
│   └── utils.ts                # shadcn/ui cn() helper (from init)
├── globals.css                 # Tailwind v4 @import + @theme CSS variables
└── next.config.js              # Already exists; add NEXT_PUBLIC_API_URL exposure

apps/api/src/
├── app.ts                      # Add: CORS registration + Bull-Board plugin mount + metrics route
├── routes/
│   ├── metrics.ts              # NEW: GET /api/metrics route
│   ├── dlq-list.ts             # NEW: GET /api/dlq (list for dashboard DLQ page)
│   ├── admin.ts                # Existing: POST /admin/dlq/:id/requeue
│   └── ingest.ts               # PATCH: add [ingest] received log after queue.add()
└── services/
    └── metrics.service.ts      # NEW: getBullMQCounts() + getPrismaAggregates()

packages/config/src/
└── env.ts                      # ADD: DASHBOARD_POLL_INTERVAL_MS optional-with-default
```

### Pattern 1: Fastify CORS Registration (required before any polling works)

**What:** Register `@fastify/cors` in `buildApp()` before routes are registered.
**Why:** The dashboard at `localhost:3000` fetches `localhost:3001/api/metrics` — different port = cross-origin. Without CORS headers, the browser blocks the request entirely. This is the single most likely "polling works in curl but not in the browser" pitfall.

```typescript
// Source: @fastify/cors official docs
// In apps/api/src/app.ts — register BEFORE routes

import cors from "@fastify/cors";

// Inside buildApp():
await app.register(cors, {
  origin: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
});
```

Add `DASHBOARD_URL` to env schema (optional, no default needed — restrict to `*` in dev if not set, explicit origin in prod).

### Pattern 2: Bull-Board Fastify Plugin Mount

**What:** Mount `@bull-board/fastify` adapter as a plugin inside `buildApp()`.
**When to use:** After CORS, before route registration to get consistent plugin ordering.

```typescript
// Source: bull-board official docs / oneuptime.com 2026 article
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";

// Inside buildApp(deps: AppDeps):
const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(deps.queue as Queue)], // cast needed: AppDeps.queue is Pick<Queue, "add">
  serverAdapter,
});
await app.register(serverAdapter.registerPlugin(), {
  prefix: "/admin/queues",
  basePath: "/admin/queues",
});
```

**Pitfall:** `deps.queue` is typed as `Pick<Queue, "add">` for test isolation. Bull-Board's `BullMQAdapter` constructor requires the full `Queue` type. Cast with `as Queue` or widen the `AppDeps` type to accept `Queue` directly when Bull-Board is used.

### Pattern 3: GET /api/metrics Route

**What:** Returns a JSON snapshot of BullMQ job counts + Prisma aggregate counts.
**Why:** Single source of truth for all dashboard numeric data.

```typescript
// Source: BullMQ docs (getJobCounts), Prisma docs (aggregate/count)
// apps/api/src/routes/metrics.ts

export async function metricsRoutes(
  app: FastifyInstance,
  deps: { queue: Pick<Queue, "getJobCounts">; prisma: PrismaClient },
) {
  app.get("/api/metrics", async (_request, reply) => {
    const [queueCounts, totalEvents, unresolvedDlq, last60s] = await Promise.all([
      (deps.queue as Queue).getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      deps.prisma.event.count(),
      deps.prisma.deadLetterEvent.count({ where: { resolved: false } }),
      deps.prisma.event.count({
        where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
      }),
    ]);
    return reply.send({
      queue: queueCounts,
      events: { total: totalEvents },
      dlq: { unresolved: unresolvedDlq },
      throughput: { last60s },
    });
  });
}
```

**Note on `getJobCounts` typing:** `AppDeps.queue` is `Pick<Queue, "add">`. The metrics route needs `getJobCounts`. Either add `getJobCounts` to the `Pick` type, or receive the full `Queue` in a separate `MetricsDeps` interface to keep ingest route types narrow.

### Pattern 4: GET /api/dlq Route

The DLQ page needs a list endpoint that `admin.ts` does not currently have. This must be added alongside the metrics route.

```typescript
// apps/api/src/routes/dlq-list.ts
app.get("/api/dlq", async (_request, reply) => {
  if (!deps.prisma) return reply.code(503).send({ error: "DB not available" });
  const entries = await deps.prisma.deadLetterEvent.findMany({
    where: { resolved: false },
    orderBy: { frozenAt: "desc" },
    take: 100, // safety cap for dashboard rendering
  });
  return reply.send({ entries });
});
```

### Pattern 5: Polling Hook (usePolling)

**What:** Generic hook for client-side polling with configurable interval.
**When to use:** Each dashboard page — pass the fetch URL and interval; get back `{ data, loading, error }`.

```typescript
// apps/dashboard/hooks/usePolling.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function usePolling<T>(url: string, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData(); // immediate first fetch
    intervalRef.current = setInterval(() => void fetchData(), intervalMs);
    return () => clearInterval(intervalRef.current);
  }, [fetchData, intervalMs]);

  return { data, loading, error };
}
```

### Pattern 6: Recharts AreaChart (live data accumulation)

**What:** Accumulate poll data points into React state; chart reads the state array.
**Breaking changes in Recharts 3.x:** `CategoricalChartState` removed; internal props (`points`, `activeIndex`) gone; use hooks (`useActiveTooltipLabel`) instead of prop injection; `accessibilityLayer` defaults to `true`; render order controls Z-index.

```typescript
// apps/dashboard/app/demo/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

type DataPoint = { timestamp: string; completed: number; failed: number };
const MAX_POINTS = 60;

export default function DemoPage() {
  const [points, setPoints] = useState<DataPoint[]>([]);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const intervalMs = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL ?? "3000");

  useEffect(() => {
    const id = setInterval(async () => {
      const res = await fetch(`${apiUrl}/api/metrics`);
      const d = await res.json();
      setPoints((prev) => [
        ...prev.slice(-MAX_POINTS + 1),
        {
          timestamp: new Date().toLocaleTimeString(),
          completed: d.queue.completed,
          failed: d.queue.failed,
        },
      ]);
    }, intervalMs);
    return () => clearInterval(id);
  }, [apiUrl, intervalMs]);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <AreaChart data={points}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="timestamp" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="completed" stroke="#22c55e" fill="#bbf7d0" />
        <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="#fecaca" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

### Pattern 7: next-themes ThemeProvider (App Router)

**What:** Wrap children in a client component `Providers` that holds ThemeProvider. The root layout stays a Server Component but delegates theming to a client wrapper.
**Why:** ThemeProvider is a client component; Next.js App Router requires `"use client"` for hooks and context.

```typescript
// apps/dashboard/components/providers.tsx
"use client";
import { ThemeProvider } from "next-themes";
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}

// apps/dashboard/app/layout.tsx
import { Providers } from "@/components/providers";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>   {/* MANDATORY: suppressHydrationWarning */}
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**Critical:** `suppressHydrationWarning` on `<html>` is MANDATORY. Without it, Next.js throws a hydration mismatch warning because the server renders `class=""` but the client immediately injects `class="dark"` or `class="light"`.

### Pattern 8: [ingest] received Log Gap (OBS-01)

The only missing structured log for OBS-01. Add after successful `queue.add()` in `ingest.ts`:

```typescript
// After the try/catch queue.add block in apps/api/src/routes/ingest.ts
request.log.info(
  { fingerprint, source, eventType },
  "[ingest] received",
);
return reply.code(202).send({ status: "queued", fingerprint });
```

`request.log` is the Fastify per-request child logger — same pino instance, automatically enriched with request context. This matches the `ProcessorLogger` pattern used in the worker.

### Pattern 9: shadcn/ui init for Tailwind v4

**Current state (2026):** shadcn/ui `npx shadcn@latest init` supports Tailwind v4 natively. The init command:
1. Installs `tailwindcss` (v4), `tw-animate-css` (replaces `tailwindcss-animate`)
2. Adds `@import "tailwindcss"` + `@theme inline { ... }` CSS variables to `globals.css`
3. Creates `lib/utils.ts` with the `cn()` helper
4. Updates `tsconfig.json` with `"@/*": ["./*"]` path alias
5. Does NOT create `tailwind.config.js` (Tailwind v4 is CSS-config-only)

**Path alias in monorepo:** The dashboard's `tsconfig.json` uses `"extends": "../../tsconfig.base.json"`. After `shadcn init`, verify the `"@/*"` alias is in the dashboard's `tsconfig.json` `compilerOptions.paths`, not just the base config.

### Anti-Patterns to Avoid

- **Fetching in Server Components for polling data:** Server Components run once at build or request time. All polling logic MUST be in `"use client"` components with `useEffect` + `setInterval`.
- **Using `getJobCounts()` without awaiting inside Promise.all:** `getJobCounts()` is async. Forgetting `await` returns a Promise, not a count object.
- **Using Recharts 2.x API in a Recharts 3.x project:** `CategoricalChartState` and internal prop injection no longer exist in 3.x. Do not pass `activeIndex` or `points` as props.
- **Importing ThemeProvider directly into a Server Component:** Will throw "hooks can only be called inside a function component" at build time. Always wrap in `"use client"` Providers component.
- **Wildcard CORS in production:** `origin: "*"` blocks credentialed requests. Use explicit origin from `DASHBOARD_URL` env var in production.
- **Not adding `suppressHydrationWarning` to `<html>`:** Hydration mismatch causes React 19 "flash of unstyled content" and console warnings that look like bugs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Queue job browser UI | Custom React queue viewer | `@bull-board/fastify` | Full job lifecycle browser with retry/delete — already battle-tested; one dep |
| Dark/light theme with system preference | Custom CSS variables + JS media query | `next-themes` | Handles flash-of-wrong-theme, SSR/hydration mismatch, `prefers-color-scheme`, localStorage persistence |
| Area/Line charts | Custom SVG chart | `recharts` | D3 scaling, axis formatting, tooltips, responsiveness — hundreds of edge cases |
| UI primitives (cards, tables, buttons) | Custom CSS components | `shadcn/ui` | Copy-pasted components with accessible markup, keyboard navigation, theme-aware CSS variables |
| CORS header management | Manual `reply.header()` per route | `@fastify/cors` | Handles preflight OPTIONS, methods, origins, max-age consistently |

**Key insight:** All five of these have significant hidden complexity (flash-of-wrong-theme, chart axis scaling edge cases, accessible table markup, CORS preflight handling). The locked decisions already chose the correct solutions.

---

## Common Pitfalls

### Pitfall 1: CORS Blocks All Dashboard Polling
**What goes wrong:** Dashboard at `:3000` fetches Fastify at `:3001`. Browser enforces Same-Origin Policy — fetch returns a network error (not an HTTP error) with no useful message.
**Why it happens:** `@fastify/cors` is not currently registered in `buildApp()`. Without it, Fastify sends no `Access-Control-Allow-Origin` header.
**How to avoid:** Register `@fastify/cors` as the FIRST plugin in `buildApp()`, before routes. Set `origin` to `process.env.DASHBOARD_URL ?? "*"` for local dev.
**Warning signs:** Browser console shows `Cross-Origin Request Blocked` or `net::ERR_FAILED`. Curl to `/api/metrics` works, browser fetch does not.

### Pitfall 2: `AppDeps.queue` Type Too Narrow for Bull-Board and getJobCounts
**What goes wrong:** `BullMQAdapter` requires `Queue` (full type). `deps.queue` is `Pick<Queue, "add">`. TypeScript errors at the Bull-Board instantiation and in the metrics route where `getJobCounts` is not on the narrow type.
**Why it happens:** `AppDeps` was deliberately narrowed for ingest-path isolation.
**How to avoid:** Two options: (1) Widen `AppDeps.queue` to `Queue` (simplest, slight interface loosening), or (2) Add a separate `bullQueue: Queue` field to `AppDeps` used only for metrics/bull-board paths.
**Recommendation:** Option 1 — widen to `Queue`. The narrow type served Phase 2 isolation; Phase 5 legitimately needs the full queue interface for observability. The ingest route only calls `.add()` regardless.

### Pitfall 3: Recharts 3.x vs 2.x API Mismatch
**What goes wrong:** Copying Recharts examples from pre-2025 blog posts or AI training data that target 2.x API. Using `CategoricalChartState`, internal `points` prop, or `animateNewValues` — all removed in 3.x.
**Why it happens:** Recharts 3.0 was a major rewrite with breaking changes. Most blog content still targets 2.x.
**How to avoid:** Only use the official Recharts 3.x docs/source. Key safe API: `<AreaChart data={...}>`, `<Area dataKey="..." />`, `<XAxis dataKey="..." />`, `<Tooltip />`, `<Legend />`, `<ResponsiveContainer />`. Avoid any prop not in the 3.x source.
**Warning signs:** TypeScript errors on props like `animateNewValues`; runtime errors about undefined state internals.

### Pitfall 4: Missing `suppressHydrationWarning` on `<html>`
**What goes wrong:** Next.js server renders `<html class="">` (no theme). Client hydrates and immediately adds `class="dark"`. React 19 flags this as a hydration mismatch — console warning, possible layout flash.
**Why it happens:** `next-themes` sets the class via a script before React hydrates, but Next.js strict hydration mode still detects the mismatch.
**How to avoid:** Always add `suppressHydrationWarning` to the `<html>` element in `app/layout.tsx`. This is the documented requirement from next-themes.

### Pitfall 5: shadcn/ui Path Alias `@/*` Not Resolving in Monorepo
**What goes wrong:** `shadcn init` adds `"@/*": ["./*"]` to tsconfig, but the dashboard extends `../../tsconfig.base.json`. The path alias may be added to the wrong tsconfig level, or Next.js may not pick it up.
**Why it happens:** Monorepo tsconfig inheritance is non-obvious; `shadcn init` targets a standalone project structure.
**How to avoid:** After `shadcn init`, verify `apps/dashboard/tsconfig.json` (not `tsconfig.base.json`) contains `"paths": { "@/*": ["./*"] }`. Also add to `next.config.js` if needed: the `@` alias must work at both TypeScript and webpack/turbopack resolution levels.

### Pitfall 6: Polling Without Cleanup Causes Memory Leaks and Double-Polling
**What goes wrong:** Forgetting to return a cleanup function from `useEffect` leaves the interval running after the component unmounts. On route change (e.g., `/dashboard` → `/dlq`), old interval fires alongside the new one.
**Why it happens:** React 18/19 Strict Mode double-invokes effects in development; unmount without cleanup causes doubled polls.
**How to avoid:** Always return `() => clearInterval(id)` from the `useEffect` that sets the interval. The `usePolling` hook pattern shown above handles this correctly.

### Pitfall 7: BullMQ `getJobCounts()` Needs Full Queue Reference
**What goes wrong:** Calling `deps.queue.getJobCounts(...)` when `deps.queue` is typed as `Pick<Queue, "add">` — TypeScript error at compile time, or runtime error if cast bypassed.
**Why it happens:** See Pitfall 2. The ingest path deliberately narrows the queue type.
**How to avoid:** Either widen `AppDeps.queue` to `Queue` (recommended) or create a `MetricsDeps` interface with the full queue for the metrics route. Do not use `as any` casts.

### Pitfall 8: `GET /api/dlq` Endpoint Missing
**What goes wrong:** The DLQ page (`app/dlq/page.tsx`) needs to list DLQ entries. The existing admin route only has `POST /admin/dlq/:id/requeue`. There is no GET list endpoint.
**Why it happens:** Phase 4 implemented the requeue action but not a list read endpoint. The metrics route (`D-04`) returns only a count, not the full entry list.
**How to avoid:** Add `GET /api/dlq` route that returns `DeadLetterEvent` rows with `resolved: false` (capped at 100). This must be planned explicitly in Plan 05-01 or 05-02 alongside the metrics route.

---

## Code Examples

### BullMQ getJobCounts API (verified from BullMQ source)

```typescript
// Source: BullMQ docs — Queue class
// Returns an object with counts keyed by status string
const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
// counts = { waiting: 0, active: 1, completed: 42, failed: 3, delayed: 0 }
```

### Prisma Aggregate Counts

```typescript
// Prisma v7 — count() with where clause
const unresolvedDlq = await prisma.deadLetterEvent.count({
  where: { resolved: false },
});

const last60s = await prisma.event.count({
  where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
});
// createdAt has an @index in schema — this query is efficient
```

### Zod env schema addition

```typescript
// packages/config/src/env.ts — add to Env object:
DASHBOARD_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(3000),
// Pattern matches WORKER_CONCURRENCY (already in schema)
```

### shadcn/ui Card for Metrics

```typescript
// Source: shadcn/ui docs — Card component
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Queue Waiting</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-4xl font-bold">{metrics?.queue.waiting ?? "—"}</p>
  </CardContent>
</Card>
```

### DLQ Table with Re-queue Button

```typescript
// Source: shadcn/ui Table + Button docs
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

{entries.map((entry) => (
  <TableRow key={entry.id}>
    <TableCell>{entry.source}</TableCell>
    <TableCell>{entry.eventType}</TableCell>
    <TableCell><Badge variant="destructive">{entry.attempts} attempts</Badge></TableCell>
    <TableCell className="max-w-xs truncate">{entry.failureReason}</TableCell>
    <TableCell>
      <Button variant="outline" size="sm" onClick={() => handleRequeue(entry.id)}>
        Re-queue
      </Button>
    </TableCell>
  </TableRow>
))}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 `tailwind.config.js` | Tailwind v4 CSS-native `@theme {}` in `globals.css` — no config file | Feb 2025 | shadcn init no longer creates `tailwind.config.js`; `tw-animate-css` replaces `tailwindcss-animate` |
| Recharts 2.x `CategoricalChartState` prop injection | Recharts 3.x hooks (`useActiveTooltipLabel`) | Recharts 3.0 (2024) | Internal state props removed; all code must target 3.x API |
| next-themes with `_document.js` (Pages Router) | next-themes with `Providers` client component + `suppressHydrationWarning` on `<html>` (App Router) | Next.js 13 App Router | Providers pattern is the only correct approach for App Router |
| `tailwindcss-animate` | `tw-animate-css` | shadcn/ui Feb 2025 changelog | shadcn installs `tw-animate-css` by default; don't manually add `tailwindcss-animate` |
| Bull-board `serverAdapter.registerPlugin()` with express | Same API, different adapter: `FastifyAdapter` + `fastify.register(serverAdapter.registerPlugin(), { prefix, basePath })` | bull-board v4+ | API is stable across v4-v6; same `createBullBoard` + adapter pattern |

**Deprecated/outdated:**
- `tailwindcss-animate`: Replaced by `tw-animate-css` in Tailwind v4 / shadcn 2025+. Do not install.
- `tailwind.config.js`: No longer needed or generated by Tailwind v4. CSS-native config only.
- Recharts `animateNewValues` prop: Removed in 3.x. Do not use.
- Recharts `blendStroke` prop: Deprecated in 3.x; use `stroke="none"` instead.

---

## Open Questions

1. **`DASHBOARD_URL` for CORS in production**
   - What we know: Local dev needs `http://localhost:3000`. Render deployment URL is unknown until Phase 6.
   - What's unclear: Phase 5 does not do deployment (Phase 6 does). Should CORS be configured with `origin: "*"` for now and tightened in Phase 6?
   - Recommendation: Use `process.env.DASHBOARD_URL ?? "*"` for now. Flag in Phase 6 to restrict to the actual Render URL. This is safe for a local-dev-only phase.

2. **Bull-Board `deps.queue` type cast**
   - What we know: `AppDeps.queue` is `Pick<Queue, "add">`. `BullMQAdapter` needs full `Queue`.
   - What's unclear: Widening `AppDeps.queue` vs. separate field. Tests mock the narrow type.
   - Recommendation: Widen `AppDeps.queue` to `Queue`. Existing tests mock `.add()` via `{ add: vi.fn() }` — they will still pass (duck typing). This is the cleanest path.

3. **`GET /api/dlq` pagination**
   - What we know: `findMany({ take: 100 })` is a safe cap for the dashboard table.
   - What's unclear: If production load generates >100 DLQ entries, the oldest won't show.
   - Recommendation: `take: 100, orderBy: { frozenAt: "desc" }` is sufficient for a portfolio demo. No pagination needed in Phase 5.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All | Per prior phases | 22 LTS | — |
| pnpm | Package installs | Per prior phases | Workspace configured | — |
| Docker (local) | Local dev (Redis + Postgres) | Per prior phases | 25+ | — |
| npm registry access | `pnpm add recharts next-themes @bull-board/*` | Restricted (SSL cert error) | — | Install from known good network; CI has access |

**Note on npm SSL error:** The dev machine has `UNABLE_TO_VERIFY_LEAF_SIGNATURE` for npm registry. Package installs must be done from a network without corporate SSL inspection, or with `NODE_TLS_REJECT_UNAUTHORIZED=0` as a temporary workaround. This affects only the install step, not runtime. CI (GitHub Actions) is unaffected.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `apps/api/vitest.config.ts` (existing), `apps/worker/vitest.config.ts` (existing) |
| Quick run (api) | `pnpm --filter @omnisync/api test` |
| Full suite | `pnpm --filter @omnisync/api test:coverage` |
| Dashboard | No vitest config yet — Phase 5 adds no dashboard unit tests (UI is tested in Phase 6 Playwright E2E) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | `[ingest] received` log emitted after enqueue | Unit (spy on `request.log.info`) | `pnpm --filter @omnisync/api test -- --run tests/routes/ingest.test.ts` | ✅ `tests/routes/ingest.test.ts` — needs new assertion |
| OBS-02 | `GET /api/metrics` returns valid JSON shape | Unit (inject mock queue + prisma) | `pnpm --filter @omnisync/api test -- --run tests/routes/metrics.test.ts` | ❌ Wave 0 |
| DSH-01 | Dashboard metrics page renders counts | E2E (Phase 6, TST-04) | Playwright | ❌ Phase 6 |
| DSH-02 | DLQ page lists entries with error detail | E2E (Phase 6, TST-04) | Playwright | ❌ Phase 6 |
| DSH-03 | Re-queue button calls POST and shows feedback | E2E (Phase 6, TST-04) | Playwright | ❌ Phase 6 |
| DSH-04 | Demo page chart renders with data points | Manual / E2E (Phase 6) | Playwright | ❌ Phase 6 |

### Sampling Rate

- **Per task commit:** `pnpm --filter @omnisync/api test` (< 10s)
- **Per wave merge:** `pnpm --filter @omnisync/api test:coverage` (coverage gate ≥ 80%)
- **Phase gate:** API coverage ≥ 80% + manual smoke test of three dashboard pages before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/api/tests/routes/metrics.test.ts` — covers OBS-02 (GET /api/metrics returns correct shape)
- [ ] `apps/api/tests/routes/dlq-list.test.ts` — covers GET /api/dlq list endpoint

*(Existing `tests/routes/ingest.test.ts` needs one new assertion for the `[ingest] received` log — not a new file, just a new test case.)*

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 5 |
|-----------|-------------------|
| **Tech stack locked:** Node.js 22+, TypeScript 5, Fastify v5, BullMQ v5, Prisma v7, Zod v4, Next.js, Vitest + Playwright | All library choices in this phase comply |
| **Budget: near-zero / free tier** | No paid observability services; no Datadog/Sentry; pino JSON logs only |
| **≥80% test coverage, green CI on every push** | API coverage must stay ≥ 80% after adding metrics + dlq-list routes (Wave 0 test files required) |
| **No Prometheus/OTLP pipeline** | OBS-02 satisfied by JSON metrics endpoint only (deferred in CONTEXT.md) |
| **Conventional Commits `type(NN): summary`** | Phase 5 commits use scope `(05)` |
| **Commit atomically per task** | Each plan produces self-contained commits; push at end of plan |
| **ESM-native throughout** | All new files use `import`/`export`, `zod/v4` subpath, `.js` extensions in imports |
| **GSD workflow enforcement** | All edits via `/gsd:execute-phase` — no direct file edits outside GSD |

---

## Sources

### Primary (HIGH confidence)
- Codebase read: `apps/api/src/app.ts`, `apps/api/src/routes/admin.ts`, `apps/api/src/routes/ingest.ts`, `apps/worker/src/dlq/dlq-handler.ts`, `apps/worker/src/processor/event.processor.ts`, `packages/config/src/env.ts`, `packages/db/prisma/schema.prisma`, `apps/dashboard/package.json`, `apps/dashboard/app/layout.tsx` — direct code inspection
- `.planning/phases/05-dashboard-observability/05-CONTEXT.md` — locked decisions D-01 through D-17
- `.planning/REQUIREMENTS.md` — OBS-01, OBS-02, DSH-01 through DSH-04 definitions
- Recharts 3.0 migration guide (GitHub wiki) — breaking changes verified

### Secondary (MEDIUM confidence)
- [@bull-board/fastify npm](https://www.npmjs.com/package/@bull-board/fastify) — v6.16.2 current; `createBullBoard` + `FastifyAdapter` + `registerPlugin()` API pattern
- [bull-board guide (oneuptime.com, Jan 2026)](https://oneuptime.com/blog/post/2026-01-21-bullmq-bull-board/view) — Fastify adapter setup pattern verified
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) — `pnpm dlx shadcn@latest init` for App Router
- [shadcn/ui Tailwind v4 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) — `tw-animate-css` replaces `tailwindcss-animate`; CSS-native config
- [next-themes npm/GitHub](https://github.com/pacocoursey/next-themes) — v0.4.6; `suppressHydrationWarning` requirement; Providers pattern for App Router
- [recharts npm](https://www.npmjs.com/package/recharts) — v3.8.1 current (March 2026)
- [@fastify/cors npm](https://www.npmjs.com/package/@fastify/cors) — origin config pattern
- [Tailwind CSS v4.0](https://tailwindcss.com/blog/tailwindcss-v4) — CSS-native config, no `tailwind.config.js`, v4.3.1 current

### Tertiary (LOW confidence — flag for validation)
- WebSearch-sourced information about tailwindcss v4.3.1 being current (published June 13, 2026) — plausible given active release cadence but unverified against registry directly due to SSL restriction on dev machine

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions cross-verified via WebSearch + official npm pages
- Architecture: HIGH — based on direct codebase read + official library docs
- Pitfalls: HIGH — CORS gap and type narrowing issues are directly visible in the codebase

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (Recharts and shadcn move fast; re-verify if implementation is delayed)
