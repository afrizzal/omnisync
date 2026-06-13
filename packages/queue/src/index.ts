import { env } from "@omnisync/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAME = "events";

// AWS "Full Jitter": delay = random(0, min(cap, base * 2^attempt))
// https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
// RES-01: Prevents thundering herd by randomizing each retry delay within the bounded window.
// NOTE: This function is registered on the WORKER's `settings.backoffStrategy` (Plan 04-04),
// not instantiated here. The Queue side only declares `backoff: { type: "custom" }` (Pitfall 2).
// Parameters are optional to match BullMQ's BackoffStrategy type (type?: string, err?: Error).
export function fullJitterBackoff(
  attemptsMade: number,
  _type?: string,
  _err?: Error,
): number {
  const base = env.RETRY_BASE_DELAY_MS;
  const cap = env.RETRY_CAP_MS;
  return Math.random() * Math.min(cap, base * 2 ** attemptsMade);
}

export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createEventsQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: env.RETRY_ATTEMPTS,
      backoff: { type: "custom" },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
