import { env } from "@omnisync/config";
import { createPrismaClient } from "@omnisync/db";
import { createRedisConnection } from "@omnisync/queue";
import pino from "pino"; // direct dep declared in apps/worker/package.json (Plan 03-03 Wave 0)
import { HttpCrmClient } from "./crm/crm-client.js";
import { createCrmPolicy } from "./crm/crm-policy.js";
import { buildWorker } from "./worker.js";

const concurrency = env.WORKER_CONCURRENCY;
const prisma = createPrismaClient({ max: concurrency + 2 }); // SC-4: pool >= concurrency, +2 spare
const connection = createRedisConnection(env.REDIS_URL);
const logger = pino({ name: "worker" }); // D-04 structured logger — satisfies ProcessorLogger

// Singleton pattern (Pitfall 1): crmPolicy accumulates consecutive failures across BullMQ attempts.
// Must NOT be recreated per-job — create ONCE per process.
const crmPolicy = createCrmPolicy(env.BREAKER_HALF_OPEN_MS);
const crmClient = new HttpCrmClient(env.CRM_BASE_URL);

const worker = buildWorker(
  {
    prisma,
    connection,
    logger,
    crmClient,
    crmPolicy,
    ttlMs: env.RULE_CACHE_TTL_MS,
  },
  concurrency,
);
logger.info({ concurrency, queue: "events" }, "[worker] started");

const SHUTDOWN_TIMEOUT_MS = 30_000;
async function shutdown(): Promise<void> {
  const timer = setTimeout(() => {
    logger.error({}, "[worker] shutdown timeout — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  await worker.close(); // drains in-flight jobs (no built-in timeout)
  await prisma.$disconnect();
  await connection.quit();
  clearTimeout(timer);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
