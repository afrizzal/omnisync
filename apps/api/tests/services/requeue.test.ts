// Unit tests for requeueDlqEntry service (apps/api/src/services/requeue.ts)
// Mocks prisma + queue to isolate the service logic — no real DB/Redis needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requeueDlqEntry } from "../../src/services/requeue.js";

const mockDlqEntry = {
  id: "dlq-id-1",
  fingerprint: "a".repeat(64),
  source: "SHOPEE",
  eventType: "order.created",
  payload: {
    source: "SHOPEE",
    eventType: "order.created",
    externalId: "ext-001",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: {},
  },
  failureReason: "CRM down",
  attempts: 5,
  resolved: false,
  createdAt: new Date(),
};

describe("requeueDlqEntry", () => {
  let mockPrisma: {
    deadLetterEvent: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = {
      deadLetterEvent: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...mockDlqEntry, resolved: true }),
      },
    };
    mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-abc" }) };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_found when DLQ entry does not exist", async () => {
    mockPrisma.deadLetterEvent.findUnique.mockResolvedValue(null);

    const result = await requeueDlqEntry(
      { prisma: mockPrisma as never, queue: mockQueue as never },
      "nonexistent-id",
    );

    expect(result.status).toBe("not_found");
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it("re-enqueues the job with fingerprint as jobId and returns requeued", async () => {
    mockPrisma.deadLetterEvent.findUnique.mockResolvedValue(mockDlqEntry);

    const result = await requeueDlqEntry(
      { prisma: mockPrisma as never, queue: mockQueue as never },
      "dlq-id-1",
    );

    expect(result.status).toBe("requeued");
    expect((result as { status: "requeued"; fingerprint: string }).fingerprint).toBe(
      mockDlqEntry.fingerprint,
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-event",
      {
        source: mockDlqEntry.source,
        payload: mockDlqEntry.payload,
        fingerprint: mockDlqEntry.fingerprint,
      },
      { jobId: mockDlqEntry.fingerprint },
    );
    // marks resolved
    expect(mockPrisma.deadLetterEvent.update).toHaveBeenCalledWith({
      where: { id: "dlq-id-1" },
      data: { resolved: true },
    });
  });

  it("returns already_queued when queue.add returns null (BullMQ dedup — job already in-flight)", async () => {
    mockPrisma.deadLetterEvent.findUnique.mockResolvedValue(mockDlqEntry);
    mockQueue.add.mockResolvedValue(null); // BullMQ returns null for already-present jobId

    const result = await requeueDlqEntry(
      { prisma: mockPrisma as never, queue: mockQueue as never },
      "dlq-id-1",
    );

    expect(result.status).toBe("already_queued");
    expect((result as { status: "already_queued"; fingerprint: string }).fingerprint).toBe(
      mockDlqEntry.fingerprint,
    );
    // does NOT mark resolved on already_queued
    expect(mockPrisma.deadLetterEvent.update).not.toHaveBeenCalled();
  });
});
