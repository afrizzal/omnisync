import type { PrismaClient } from "@omnisync/db";
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmClient } from "../../src/crm/crm-client.js";
import { createCrmPolicy } from "../../src/crm/crm-policy.js";
import { resetRulesCache } from "../../src/normalizer/rule-cache.js";
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
    routingRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

// Pass-through policy: executes fn directly, no circuit breaking
function makePassthroughPolicy() {
  return {
    execute: (fn: () => Promise<void>) => fn(),
  } as unknown as ReturnType<typeof createCrmPolicy>;
}

// Fake CRM client that always succeeds
function makeFakeCrm(): CrmClient {
  return { sync: vi.fn().mockResolvedValue(undefined) };
}

const TTL_MS = 30_000;

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
  beforeEach(() => {
    resetRulesCache(); // Pitfall 7: prevent cache state leaking between tests
  });

  it("Test 1: valid job + persist returns 'inserted' — processor resolves; persistEvent called once; 'completed' logged", async () => {
    const prisma = makeMockPrisma(1);
    const logger = makeSpyLogger();
    const fakeCrm = makeFakeCrm();
    const crmPolicy = makePassthroughPolicy();
    const processor = buildProcessor(
      prisma,
      logger,
      fakeCrm,
      crmPolicy,
      TTL_MS,
    );

    await expect(
      processor({ id: "job-1", data: validJobData }),
    ).resolves.toBeUndefined();

    // persistEvent must have been invoked exactly once
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();

    // CRM sync must have been called after successful persist
    expect(fakeCrm.sync).toHaveBeenCalledOnce();

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
    const fakeCrm = makeFakeCrm();
    const crmPolicy = makePassthroughPolicy();
    const processor = buildProcessor(
      prisma,
      logger,
      fakeCrm,
      crmPolicy,
      TTL_MS,
    );

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
    const fakeCrm = makeFakeCrm();
    const crmPolicy = makePassthroughPolicy();
    const processor = buildProcessor(
      prisma,
      logger,
      fakeCrm,
      crmPolicy,
      TTL_MS,
    );

    // Bad job data: missing fingerprint and payload shape
    const badJobData = { nope: true };

    await expect(
      processor({ id: "bad-job-3", data: badJobData }),
    ).rejects.toThrow(/invalid job data/);

    // Must NOT attempt to persist a poison message
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("Test 4 (RES-07): Postgres failure does NOT open the CRM circuit breaker", async () => {
    // Simulate Postgres being down: $executeRaw always rejects
    const prismaDown = {
      $executeRaw: vi.fn().mockRejectedValue(new Error("connection refused")),
      routingRule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const logger = makeSpyLogger();
    const fakeCrm = makeFakeCrm();

    // Real circuit breaker that trips after 5 consecutive failures
    const crmPolicy = createCrmPolicy(10_000);

    const processor = buildProcessor(
      prismaDown,
      logger,
      fakeCrm,
      crmPolicy,
      TTL_MS,
    );

    // Call 6 times — each should fail due to Postgres, NOT due to breaker
    for (let i = 1; i <= 6; i++) {
      await expect(
        processor({ id: `job-db-down-${i}`, data: validJobData }),
      ).rejects.toThrow("connection refused");
    }

    // CRM sync must NEVER have been called — persistEvent throws before we reach crmPolicy.execute
    expect(fakeCrm.sync).not.toHaveBeenCalled();

    // The 7th call must STILL fail with DB error, NOT BrokenCircuitError
    // (breaker must remain closed because it was never consulted)
    const seventhError = await processor({
      id: "job-db-down-7",
      data: validJobData,
    }).catch((e) => e as Error);
    expect(seventhError).not.toBeInstanceOf(BrokenCircuitError);
    expect(seventhError.message).toMatch("connection refused");
  });
});
