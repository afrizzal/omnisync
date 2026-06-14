// Unit tests for GET /api/dlq route
// Mocks prisma to test HTTP response shape without real DB.

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

describe("GET /api/dlq", () => {
  let app: FastifyInstance;

  const mockEntry = {
    id: "d1",
    source: "SHOPEE",
    eventType: "order.created",
    attempts: 5,
    failureReason: "boom",
    errorStack: "Error: boom\n  at ...",
    frozenAt: new Date("2026-06-14T12:00:00.000Z"),
    fingerprint: "fp1",
    resolved: false,
  };

  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getJobCounts: vi.fn().mockResolvedValue({}),
  };
  const mockRedis = {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
  const mockPrisma = {
    event: { count: vi.fn().mockResolvedValue(0) },
    deadLetterEvent: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([mockEntry]),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.deadLetterEvent.findMany.mockResolvedValue([mockEntry]);
    app = await buildApp({
      queue: mockQueue as never,
      redis: mockRedis as never,
      prisma: mockPrisma as never,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with entries array", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dlq",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { entries: typeof mockEntry[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(1);
  });

  it("returns entry with expected fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dlq",
    });

    const body = JSON.parse(response.body) as { entries: typeof mockEntry[] };
    const entry = body.entries[0];
    expect(entry).toBeDefined();
    expect(entry!.failureReason).toBe("boom");
    expect(entry!.source).toBe("SHOPEE");
    expect(entry!.eventType).toBe("order.created");
    expect(entry!.fingerprint).toBe("fp1");
  });

  it("calls findMany with resolved:false, frozenAt:desc order, take:100", async () => {
    await app.inject({ method: "GET", url: "/api/dlq" });

    expect(mockPrisma.deadLetterEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resolved: false },
        orderBy: { frozenAt: "desc" },
        take: 100,
      }),
    );
  });
});
