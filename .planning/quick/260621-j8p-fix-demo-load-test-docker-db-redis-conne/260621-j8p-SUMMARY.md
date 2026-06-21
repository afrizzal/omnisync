# Quick Task 260621-j8p — Summary

**Description:** Fix /demo "Live Load Test" so it works end-to-end for the portfolio demo video (Docker DB/Redis connectivity + wire OPS-04 button).
**Date:** 2026-06-21
**Status:** ✅ Complete & verified live

## Problem (diagnosed with live evidence)

The /demo page showed "Waiting for events" forever and the **Start Load Test** button did nothing visible. Two independent root causes plus one latent bug:

1. **Docker connectivity (the real blocker).** The full stack runs in Docker (`docker-compose.yml` → `env_file: .env`), but `.env` carries **host-facing** URLs (`localhost:5433` / `localhost:6379`). Inside containers `localhost` = the container itself, so `api`/`worker` could not reach Postgres/Redis. Proven by api logs: Prisma `P1001 Can't reach database server at 127.0.0.1:5433` and ioredis `ECONNREFUSED 127.0.0.1:6379`. Effect: `GET /api/metrics` 500'd on every 3s poll → the chart never got a data point; real ingestion couldn't enqueue.
2. **Missing migrations.** Once connectivity was fixed, `/api/metrics` still 500'd with `P2021 relation "public.events" does not exist` — the docker Postgres volume had never been migrated.
3. **OPS-04 stub.** `apps/api/src/routes/demo.ts` returned 202 but fired **zero** events, so even with metrics healthy the chart would show flat zeros.
4. **Bonus latent bug.** `scripts/loadtest.ts` signed without the GitHub-style `sha256=` prefix that `verifySignature` requires → its events would 401.

## What changed

| # | Change | File | Commit |
|---|--------|------|--------|
| A | Add `environment:` override (`postgres:5432` / `redis:6379`) to `api` & `worker` — overrides `env_file`, keeps `.env` host-facing for native dev | `docker-compose.yml` | `c443499` |
| B | Replace stub: `POST /api/demo/start` fires a background burst of ~240 signed synthetic events (~20/s over ~12s) through the **real** `/ingest/:source` path via `app.inject` (full HMAC + Zod + dedup + enqueue); idempotent run guard | `apps/api/src/routes/demo.ts` | `8ccd83c` |
| C | Add `sha256=` prefix to the autocannon blaster's signature header | `scripts/loadtest.ts` | `98f8762` |

Also run (operational, not committed): `prisma migrate deploy` against the docker Postgres volume via host `localhost:5433` (3 migrations applied: init, event-canonical-columns/DLQ redesign, routing-rules).

## Verification (live, against the running stack)

```
metrics endpoint:           200 (was 500)
POST /api/demo/start:        202  {"status":"started","events":240}
```

| Metric | Before | After (~18s) |
|--------|--------|--------------|
| `queue.completed` | 0 | **240** |
| `throughput.last60s` | 0 | **240** |
| `events.total` | 0 | **240** |
| `queue.failed` | 0 | 0 |
| `dlq.unresolved` | 0 | 0 |

All 240 events fired → validated → enqueued → processed by the worker → completed with **zero failures / zero DLQ**. No `ECONNREFUSED` / `P1001` / `P2021` in api or worker logs after the fix.

## Notes / follow-ups

- **Migrations are not auto-applied on container boot.** A fresh `docker compose up` against an empty Postgres volume needs `pnpm --filter @omnisync/db exec prisma migrate deploy` (with `DATABASE_URL` pointing at host `localhost:5433`). Consider adding a migrate step to the api/worker entrypoint or a one-shot `migrate` compose service if reproducibility matters for the demo.
- Host typecheck (`@omnisync/api`) reports a stale-artifact error for `env.DASHBOARD_URL` because `packages/config/dist` is older than its source (which DOES declare `DASHBOARD_URL`). The Docker build rebuilds config from source, so the image is clean. Running `pnpm --filter @omnisync/config build` clears the host noise. Pre-existing; out of scope here.
- This unblocks **Phase 06-06 Task 3** (record demo walkthrough): `localhost:3000/demo` → click **Start Load Test** → chart climbs 0→~240 live.

## Push status

3 atomic commits are **local only** — push deferred for user confirmation (user is mid-recording).
