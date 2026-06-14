// Unit tests for GET /api/metrics and POST /api/demo/start routes
// Mocks queue and prisma to test HTTP response shape without real infra.

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

describe("GET /api/metrics", () => {
  let app: FastifyInstance;

  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getJobCounts: vi
      .fn()
      .mockResolvedValue({ waiting: 1, active: 2, completed: 42, failed: 3, delayed: 0 }),
  };
  const mockRedis = {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
  const mockPrisma = {
    event: {
      count: vi.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(7),
    },
    deadLetterEvent: {
      count: vi.fn().mockResolvedValue(5),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the event.count mock so each test run gets fresh values
    mockPrisma.event.count.mockResolvedValueOnce(100).mockResolvedValueOnce(7);
    app = await buildApp({
      queue: mockQueue as never,
      redis: mockRedis as never,
      prisma: mockPrisma as never,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with the four-key JSON shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/metrics",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
      events: { total: number };
      dlq: { unresolved: number };
      throughput: { last60s: number };
    };

    expect(body.queue.completed).toBe(42);
    expect(body.queue.waiting).toBe(1);
    expect(body.queue.active).toBe(2);
    expect(body.queue.failed).toBe(3);
    expect(body.queue.delayed).toBe(0);
    expect(body.events.total).toBe(100);
    expect(body.dlq.unresolved).toBe(5);
    expect(body.throughput.last60s).toBe(7);
  });

  it("calls prisma.deadLetterEvent.count with resolved:false filter", async () => {
    await app.inject({ method: "GET", url: "/api/metrics" });

    expect(mockPrisma.deadLetterEvent.count).toHaveBeenCalledWith({
      where: { resolved: false },
    });
  });

  it("calls queue.getJobCounts with the five status strings", async () => {
    await app.inject({ method: "GET", url: "/api/metrics" });

    expect(mockQueue.getJobCounts).toHaveBeenCalledWith(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
  });
});

describe("POST /api/demo/start", () => {
  let app: FastifyInstance;

  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
  };
  const mockRedis = {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({
      queue: mockQueue as never,
      redis: mockRedis as never,
      // No prisma — demo route must work without DB
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 202 with { status: 'started' } (stub, no DB needed)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/demo/start",
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("started");
  });
});
