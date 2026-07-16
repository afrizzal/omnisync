// Unit tests for admin routes — covers adminRoutes POST /admin/dlq/:id/requeue
// Mocks requeueDlqEntry to test HTTP response mapping without real DB/Redis.

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

// Mock the requeue service so admin routes are exercised without real infra
vi.mock("../../src/services/requeue.js", () => ({
  requeueDlqEntry: vi.fn(),
}));

import { requeueDlqEntry } from "../../src/services/requeue.js";

const mockRequeue = vi.mocked(requeueDlqEntry);

describe("POST /admin/dlq/:id/requeue", () => {
  let app: FastifyInstance;
  const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
  const mockRedis = {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
  const mockPrisma = {} as never; // prisma is passed to requeueDlqEntry which is mocked

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({
      queue: mockQueue as never,
      redis: mockRedis as never,
      prisma: mockPrisma,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with requeued status when entry is found and re-queued", async () => {
    mockRequeue.mockResolvedValue({
      status: "requeued",
      fingerprint: "abc123",
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dlq/entry-id-1/requeue",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("requeued");
    expect(body.fingerprint).toBe("abc123");
  });

  it("returns 404 when DLQ entry is not found", async () => {
    mockRequeue.mockResolvedValue({ status: "not_found" });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dlq/nonexistent-id/requeue",
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("DLQ_ENTRY_NOT_FOUND");
  });

  it("returns 200 with already_queued status when entry is already in queue", async () => {
    mockRequeue.mockResolvedValue({
      status: "already_queued",
      fingerprint: "def456",
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dlq/entry-id-2/requeue",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("already_queued");
    expect(body.fingerprint).toBe("def456");
  });
});
