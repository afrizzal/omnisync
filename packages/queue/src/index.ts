import { Queue } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL environment variable is required");
}

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Locked config from CONTEXT D-10 (free-tier Upstash command-quota viability)
// These constants are consumed by the Worker in Phase 3 — do NOT change values.
export const QUEUE_NAME = "events";

export const queueOptions = {
  guardInterval: 30_000,
  stalledInterval: 300_000,
  drainDelay: 30,
} as const;

export const eventsQueue = new Queue(QUEUE_NAME, { connection });
