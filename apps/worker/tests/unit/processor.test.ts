import type { PrismaClient } from "@omnisync/db";
import { describe, expect, it, vi } from "vitest";
import type { ProcessorLogger } from "../../src/processor/event.processor.js";
import { buildProcessor } from "../../src/processor/event.processor.js";

// Build a spy logger satisfying ProcessorLogger
function makeSpyLogger(): ProcessorLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

// Build a mock prisma that controls $executeRaw outcome
function makeMockPrisma(executeRawResult: number): PrismaClient {
  return {
    $executeRaw: vi.fn().mockResolvedValue(executeRawResult),
  } as unknown as PrismaClient;
}

// Valid job data matching EventJobData wire shape
const validJobData = {
  source: "SHOPEE",
  fingerprint: "a".repeat(64),
  payload: {
    source: "SHOPEE",
    eventType: "order.created",
    externalId: "ext-001",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { amount: 100 },
  },
};

describe("buildProcessor() — validate → normalize → persist pipeline (D-04/D-05/D-10)", () => {
  it("Test 1: valid job + persist returns 'inserted' — processor resolves; persistEvent called once; 'completed' logged", async () => {
    const prisma = makeMockPrisma(1);
    const logger = makeSpyLogger();
    const processor = buildProcessor(prisma, logger);

    await expect(
      processor({ id: "job-1", data: validJobData }),
    ).resolves.toBeUndefined();

    // persistEvent must have been invoked exactly once
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();

    // "completed" log emitted (not "duplicate absorbed")
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const completedCall = infoCalls.find(
      ([, msg]: [Record<string, unknown>, string]) =>
        msg === "[worker] completed",
    );
    expect(completedCall).toBeDefined();
  });

  it("Test 2: valid job + persist returns 'duplicate' — processor resolves (no throw); 'duplicate absorbed' logged", async () => {
    const prisma = makeMockPrisma(0);
    const logger = makeSpyLogger();
    const processor = buildProcessor(prisma, logger);

    // Conflict is SUCCESS (D-05) — must NOT throw
    await expect(
      processor({ id: "job-2", data: validJobData }),
    ).resolves.toBeUndefined();

    expect(prisma.$executeRaw).toHaveBeenCalledOnce();

    // "duplicate absorbed" log emitted
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const dupCall = infoCalls.find(
      ([, msg]: [Record<string, unknown>, string]) =>
        msg === "[worker] duplicate absorbed",
    );
    expect(dupCall).toBeDefined();
  });

  it("Test 3: poison message (bad data shape) — processor throws; persistEvent NOT called", async () => {
    const prisma = makeMockPrisma(1);
    const logger = makeSpyLogger();
    const processor = buildProcessor(prisma, logger);

    // Bad job data: missing fingerprint and payload shape
    const badJobData = { nope: true };

    await expect(
      processor({ id: "bad-job-3", data: badJobData }),
    ).rejects.toThrow(/invalid job data/);

    // Must NOT attempt to persist a poison message
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
