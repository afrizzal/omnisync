import type { PrismaClient } from "@omnisync/db";
import { fullJitterBackoff, QUEUE_NAME } from "@omnisync/queue";
import type { CircuitBreakerPolicy } from "cockatiel";
import type { Job } from "bullmq";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { CrmClient } from "./crm/crm-client.js";
import { buildDlqHandler } from "./dlq/dlq-handler.js";
import {
  buildProcessor,
  type ProcessorLogger,
} from "./processor/event.processor.js";

export interface WorkerDeps {
  prisma: PrismaClient;
  connection: Redis;
  logger: ProcessorLogger;
  crmClient: CrmClient;            // injected HTTP client (or fake in tests)
  crmPolicy: CircuitBreakerPolicy; // cockatiel breaker SINGLETON (created once in index.ts)
  ttlMs: number;                   // RULE_CACHE_TTL_MS
}

export function buildWorker(deps: WorkerDeps, concurrency: number): Worker {
  const processor = buildProcessor(
    deps.prisma,
    deps.logger,
    deps.crmClient,
    deps.crmPolicy,
    deps.ttlMs,
  );
  const worker = new Worker(QUEUE_NAME, (job: Job) => processor(job), {
    connection: deps.connection,
    concurrency,
    stalledInterval: 300_000, // 5 min — Upstash free-tier tuning (D-09 WorkerOption)
    drainDelay: 30,           // 30 s — Upstash free-tier tuning (D-09 WorkerOption)
    settings: {
      backoffStrategy: fullJitterBackoff, // RES-01 — implementation lives on the WORKER (Pitfall 2)
    },
  });

  // RES-02/RES-03: exhausted jobs -> dlq_events Postgres mirror
  const onFailed = buildDlqHandler(deps.prisma, deps.logger);
  worker.on("failed", (job, error) => void onFailed(job, error));

  return worker;
}
