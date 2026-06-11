import type { PrismaClient } from "@omnisync/db";
import { QUEUE_NAME } from "@omnisync/queue";
import type { Job } from "bullmq";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import {
  buildProcessor,
  type ProcessorLogger,
} from "./processor/event.processor.js";

export interface WorkerDeps {
  prisma: PrismaClient;
  connection: Redis;
  logger: ProcessorLogger;
}

export function buildWorker(deps: WorkerDeps, concurrency: number): Worker {
  const processor = buildProcessor(deps.prisma, deps.logger);
  return new Worker(QUEUE_NAME, (job: Job) => processor(job), {
    connection: deps.connection,
    concurrency,
    stalledInterval: 300_000, // 5 min — Upstash free-tier tuning (D-09 WorkerOption)
    drainDelay: 30, // 30 s — Upstash free-tier tuning (D-09 WorkerOption)
  });
}
