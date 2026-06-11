import { createPrismaClient } from "@omnisync/db";
import { createEventsQueue, createRedisConnection } from "@omnisync/queue";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorker } from "../../src/worker.js";

const noopLogger = { info: () => {}, error: () => {} };

// Unique fingerprint per test run — avoids BullMQ jobId dedup when the completed job
// stays in Redis for up to 1 hour (removeOnComplete: { age: 3600 }). Must be 64 hex chars.
const fingerprint = Date.now().toString(16).padStart(64, "0").slice(-64);
const jobData = {
  source: "SHOPEE",
  payload: {
    source: "SHOPEE",
    eventType: "order.created",
    externalId: "ext-wk-001",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { amount: 100 },
  },
  fingerprint,
};

const prisma = createPrismaClient({ max: 5 });
const connection = createRedisConnection(process.env.REDIS_URL!);
const queue = createEventsQueue(connection);
let worker: ReturnType<typeof buildWorker>;

// Bounded poll — max 10 iterations * 500ms ~= 5s. Never an unbounded while(true).
async function waitForCount(
  expected: number,
  maxIterations = 10,
  delayMs = 500,
): Promise<number> {
  for (let i = 0; i < maxIterations; i++) {
    const count = await prisma.event.count({ where: { fingerprint } });
    if (count === expected) return count;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return prisma.event.count({ where: { fingerprint } });
}

describe("QUE-02 end-to-end queue -> worker -> row", () => {
  beforeEach(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
  });
  afterEach(async () => {
    if (worker) await worker.close(); // close worker BEFORE connection (research Pitfall 4)
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  });

  it("consumes a queued job and persists exactly 1 row", {
    timeout: 20_000,
  }, async () => {
    worker = buildWorker({ prisma, connection, logger: noopLogger }, 5);
    await queue.add("process-event", jobData, { jobId: fingerprint });
    const count = await waitForCount(1);
    expect(count).toBe(1);
  });
});
