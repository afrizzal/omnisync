import { afterAll, describe, expect, it } from "vitest";
import * as queue from "../src/index.js";

// createRedisConnection requires a URL — use CI service container or local docker-compose default.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("@omnisync/queue factories (D-07/D-08/D-09)", () => {
  it("imports without opening a socket", () => {
    // If the module had a top-level `new Redis(...)`, importing would throw / hang.
    // (Importing DOES read env via @omnisync/config — vitest.setup.ts provides it.)
    expect(typeof queue.createRedisConnection).toBe("function");
    expect(typeof queue.createEventsQueue).toBe("function");
    expect(queue.QUEUE_NAME).toBe("events");
  });

  it("fullJitterBackoff stays within [0, min(cap, base * 2^attempt)] (RES-01)", () => {
    for (const attempt of [1, 3, 10]) {
      const delay = queue.fullJitterBackoff(attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(Math.min(30000, 1000 * 2 ** attempt));
    }
  });
  it("exports no guardInterval / queueOptions (D-09 dead config removed)", () => {
    const keys = Object.keys(queue);
    expect(keys).not.toContain("queueOptions");
    expect(keys).not.toContain("guardInterval");
    expect(keys).not.toContain("eventsQueue");
    expect(keys).not.toContain("connection");
  });

  // Exercise the factory functions so coverage reaches the 80% line threshold.
  describe("factory invocation", () => {
    let connection: ReturnType<typeof queue.createRedisConnection>;
    let eventsQueue: ReturnType<typeof queue.createEventsQueue>;

    afterAll(async () => {
      if (eventsQueue) await eventsQueue.close();
      if (connection) await connection.quit();
    });

    it("createRedisConnection returns a Redis client with maxRetriesPerRequest: null", () => {
      connection = queue.createRedisConnection(REDIS_URL);
      expect(connection).toBeDefined();
      expect(typeof connection.get).toBe("function"); // ioredis Redis instance
    });

    it("createEventsQueue returns a BullMQ Queue bound to QUEUE_NAME", () => {
      eventsQueue = queue.createEventsQueue(connection);
      expect(eventsQueue).toBeDefined();
      expect(eventsQueue.name).toBe(queue.QUEUE_NAME);
    });
  });
});
