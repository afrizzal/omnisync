import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAME = "events";

export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createEventsQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
