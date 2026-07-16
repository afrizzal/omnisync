---
phase: "05"
plan: "02"
subsystem: dashboard
tags: [shadcn, tailwind-v4, next-themes, polling-hooks, ui-scaffold]
dependency_graph:
  requires: []
  provides: [shadcn-components, themed-layout, polling-hooks, api-url-helper]
  affects: [05-03, 05-04]
tech_stack:
  added:
    - tailwindcss@4.3.1
    - recharts@3.8.1
    - next-themes@0.4.6
    - tw-animate-css@1.4.0
    - class-variance-authority
    - clsx
    - tailwind-merge
    - "@radix-ui/react-slot"
    - lucide-react
  patterns:
    - Tailwind v4 CSS-native config (@theme in globals.css, no tailwind.config.js)
    - shadcn/ui component scaffolding (manual due to SSL restriction)
    - next-themes ThemeProvider via client Providers wrapper pattern
    - Generic usePolling hook with immediate-fetch + cleanup pattern
key_files:
  created:
    - apps/dashboard/components.json
    - apps/dashboard/app/globals.css
    - apps/dashboard/lib/utils.ts
    - apps/dashboard/lib/api.ts
    - apps/dashboard/components/ui/card.tsx
    - apps/dashboard/components/ui/table.tsx
    - apps/dashboard/components/ui/badge.tsx
    - apps/dashboard/components/ui/button.tsx
    - apps/dashboard/components/providers.tsx
    - apps/dashboard/components/nav-bar.tsx
    - apps/dashboard/hooks/usePolling.ts
    - apps/dashboard/hooks/useMetrics.ts
    - apps/dashboard/hooks/useDlq.ts
  modified:
    - apps/dashboard/tsconfig.json (added @/* path alias)
    - apps/dashboard/app/layout.tsx (themed layout with NavBar)
    - apps/dashboard/app/page.tsx (redirect to /dashboard)
    - apps/dashboard/next.config.js (turbopack.root for worktree build)
    - apps/dashboard/package.json (new deps)
    - package.json (tw-animate-css at workspace root)
decisions:
  - shadcn CLI init bypassed due to SSL restriction on dev machine; components scaffolded manually from shadcn source patterns (equivalent output)
  - tw-animate-css @import removed from globals.css — CSS-only package without exports field causes Turbopack module-not-found in pnpm worktree builds; animations not required for Phase 5 core scaffold
  - turbopack.root set in next.config.js to resolve dual pnpm-workspace.yaml confusion in git worktree
  - app/page.tsx updated to redirect /dashboard (removed stale @omnisync/types type-proof import from Phase 1)
metrics:
  duration_minutes: 27
  completed_at: "2026-06-15"
  tasks_completed: 3
  files_changed: 17
---

# Phase 05 Plan 02: Dashboard UI Foundation Summary

shadcn/ui scaffold with Tailwind v4 CSS-native config, next-themes ThemeProvider, NavBar, and typed polling hooks (usePolling/useMetrics/useDlq) providing all UI primitives needed by Plans 05-03 and 05-04.

## What Was Built

### Task 1: shadcn/ui Scaffold + Tailwind v4

Installed tailwindcss, recharts, next-themes, and shadcn/ui peer dependencies. Created the shadcn scaffold manually (bypassing the interactive CLI due to dev machine SSL restrictions):

- `components.json` — shadcn config with neutral base color, @/* alias, App Router settings
- `app/globals.css` — Tailwind v4 CSS-native config with `@import "tailwindcss"` and `@theme` CSS variables (light + dark mode)
- `lib/utils.ts` — `cn()` helper using clsx + tailwind-merge
- Four shadcn UI components: `card.tsx`, `table.tsx`, `badge.tsx`, `button.tsx`
- `tsconfig.json` updated with `"@/*": ["./*"]` path alias

### Task 2: Providers, NavBar, Themed Layout

- `components/providers.tsx` — `"use client"` ThemeProvider wrapper with `attribute="class"` + `enableSystem`
- `components/nav-bar.tsx` — Nav with Dashboard / DLQ / Load Test links + theme toggle cycling system → light → dark
- `app/layout.tsx` — Server Component with `suppressHydrationWarning`, globals.css import, Providers + NavBar + main container

### Task 3: API URL Helper + Polling Hooks

- `lib/api.ts` — `API_URL` from `NEXT_PUBLIC_API_URL` env var (defaults `http://localhost:3001`), `POLL_INTERVAL_MS`, `MetricsResponse`/`DlqResponse`/`DlqEntry` interfaces
- `hooks/usePolling.ts` — Generic hook: immediate first fetch on mount, setInterval thereafter, clearInterval cleanup on unmount, continues polling on error
- `hooks/useMetrics.ts` — Typed wrapper for `/api/metrics`
- `hooks/useDlq.ts` — Typed wrapper for `/api/dlq`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn CLI init bypassed — scaffolded components manually**
- **Found during:** Task 1
- **Issue:** `pnpm dlx shadcn@latest init` makes an HTTPS request to `ui.shadcn.com` for templates. The dev machine's SSL revocation check (`CRYPT_E_NO_REVOCATION_CHECK`) blocks this request even with `strict-ssl=false` in `.npmrc` (which fixed the npm registry install). The CLI requires human interaction (prompts) which also isn't automatable in this context.
- **Fix:** Scaffolded all shadcn output files manually based on the shadcn source patterns from RESEARCH.md: `components.json`, `globals.css` with `@theme` CSS variables, `lib/utils.ts`, and all four UI components using the same API as shadcn would generate.
- **Files modified:** All files listed under Task 1 artifacts
- **Commits:** b4f476a

**2. [Rule 3 - Blocking] Removed `@import "tw-animate-css"` from globals.css**
- **Found during:** Build verification after Task 3
- **Issue:** Turbopack resolves CSS `@import` module specifiers from the monorepo workspace root (per `turbopack.root`). `tw-animate-css` is a CSS-only package with no `exports` field in its package.json, causing a Turbopack `module-not-found` error.
- **Fix:** Removed the `@import "tw-animate-css"` line from globals.css. The package provides animation keyframes (accordion, fade, slide-in) that shadcn uses for interactive component animations. Phase 5 components (Card, Table, Badge, Button) do not use animation keyframes — they use CSS transitions via Tailwind utilities. Animation imports can be re-added in Phase 6 if needed.
- **Files modified:** `apps/dashboard/app/globals.css`
- **Commit:** b7862e0

**3. [Rule 3 - Blocking] Added `turbopack.root` to next.config.js**
- **Found during:** Build verification after Task 3
- **Issue:** Git worktree has its own `pnpm-workspace.yaml`, causing Turbopack to detect "multiple lockfiles" and resolve modules from the wrong root directory (the main project root at `/d/Aff/proj/omnisync` instead of the worktree root).
- **Fix:** Added `turbopack: { root: path.resolve(__dirname, "../..") }` to `next.config.js` to explicitly set the monorepo root as the Turbopack module resolution root.
- **Files modified:** `apps/dashboard/next.config.js`
- **Commit:** b7862e0

**4. [Rule 1 - Bug] Updated app/page.tsx — removed stale @omnisync/types import**
- **Found during:** Task 2 typecheck
- **Issue:** The existing `app/page.tsx` (from Phase 1) imported `InboundEvent` from `@omnisync/types` as a "type proof". In the worktree, `@omnisync/types` is linked but its `dist/` folder doesn't exist (package not built), causing TS2307 error on typecheck.
- **Fix:** Replaced page.tsx content with `redirect("/dashboard")` — which is the correct Phase 5 behavior per RESEARCH.md Pattern 9 (D-09: app/page.tsx redirects to /dashboard).
- **Files modified:** `apps/dashboard/app/page.tsx`
- **Commit:** 326dfdc

## Known Stubs

None — this plan builds infrastructure components only (hooks, layout, UI primitives). No data is displayed yet; page rendering with actual data happens in Plans 05-03 and 05-04.

## Verification

- `pnpm --filter @omnisync/dashboard typecheck` — PASSED (exit 0)
- `pnpm --filter @omnisync/dashboard build` — PASSED (Next.js 16.2.7 Turbopack build, 3 static pages)
- All acceptance criteria artifacts confirmed present on disk

## Self-Check: PASSED

Files confirmed present:
- apps/dashboard/components.json — FOUND
- apps/dashboard/components/ui/card.tsx — FOUND
- apps/dashboard/components/ui/table.tsx — FOUND
- apps/dashboard/components/ui/badge.tsx — FOUND
- apps/dashboard/components/ui/button.tsx — FOUND
- apps/dashboard/lib/utils.ts — FOUND
- apps/dashboard/lib/api.ts — FOUND
- apps/dashboard/hooks/usePolling.ts — FOUND
- apps/dashboard/hooks/useMetrics.ts — FOUND
- apps/dashboard/hooks/useDlq.ts — FOUND
- apps/dashboard/components/providers.tsx — FOUND
- apps/dashboard/components/nav-bar.tsx — FOUND

Commits confirmed:
- b4f476a — feat(05-02): install shadcn/ui + Tailwind v4 + recharts + next-themes scaffold
- 326dfdc — feat(05-02): add ThemeProvider, NavBar, and themed root layout
- 4595493 — feat(05-02): add API URL helper and usePolling/useMetrics/useDlq hooks
- b7862e0 — fix(05-02): resolve Turbopack module resolution in worktree + build errors
