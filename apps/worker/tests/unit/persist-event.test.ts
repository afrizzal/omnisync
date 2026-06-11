import type { PrismaClient } from "@omnisync/db";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../../src/normalizer/normalize.js";
import { persistEvent } from "../../src/persistence/persist-event.js";

const mockNormalizedEvent: NormalizedEvent = {
  fingerprint: "a".repeat(64),
  source: "SHOPEE",
  eventType: "order.created",
  externalId: "ext-001",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  payload: { amount: 100 },
};

describe("persistEvent() — atomic idempotent insert (D-03/D-05)", () => {
  it("Test 1: returns 'inserted' when $executeRaw returns 1 (row inserted)", async () => {
    const mockPrisma = {
      $executeRaw: vi.fn().mockResolvedValue(1),
    } as unknown as PrismaClient;

    const result = await persistEvent(mockPrisma, mockNormalizedEvent);

    expect(result).toBe("inserted");
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it("Test 2: returns 'duplicate' when $executeRaw returns 0 (conflict absorbed = success, no throw)", async () => {
    const mockPrisma = {
      $executeRaw: vi.fn().mockResolvedValue(0),
    } as unknown as PrismaClient;

    const result = await persistEvent(mockPrisma, mockNormalizedEvent);

    // Conflict is SUCCESS (D-05) — must return "duplicate", NOT throw
    expect(result).toBe("duplicate");
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });
});
