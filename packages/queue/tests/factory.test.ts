import { describe, expect, it } from "vitest";
import * as queue from "../src/index.js";

describe("@omnisync/queue factories (D-07/D-08/D-09)", () => {
  it("imports without opening a socket or reading env", () => {
    // If the module had a top-level `new Redis(...)`, importing would throw / hang without REDIS_URL.
    expect(typeof queue.createRedisConnection).toBe("function");
    expect(typeof queue.createEventsQueue).toBe("function");
    expect(queue.QUEUE_NAME).toBe("events");
  });
  it("exports no guardInterval / queueOptions (D-09 dead config removed)", () => {
    const keys = Object.keys(queue);
    expect(keys).not.toContain("queueOptions");
    expect(keys).not.toContain("guardInterval");
    expect(keys).not.toContain("eventsQueue");
    expect(keys).not.toContain("connection");
  });
});
