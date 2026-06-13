import { describe, expect, it, vi } from "vitest";
import { buildDlqHandler } from "../../src/dlq/dlq-handler.js";

// RES-02/RES-03: DLQ final-attempt gate tests — must FAIL (RED) before implementation.
// Pitfall 5: BullMQ fires 'failed' on EVERY failure; gate insert on final attempt only.
// Pitfall 6: stalled job + removeOnFail can deliver undefined job — guard against it.

// Fake prisma with a mock deadLetterEvent.create
function makeFakePrisma() {
  return {
    deadLetterEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

// Noop logger satisfying ProcessorLogger structural interface
function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

// Fake job builder
function makeJob(attemptsMade: number, maxAttempts: number) {
  return {
    id: "test-job-id",
    attemptsMade,
    opts: { attempts: maxAttempts },
    data: {
      source: "SHOPEE",
      fingerprint: "a".repeat(64),
      payload: {
        source: "SHOPEE",
        eventType: "order.created",
        externalId: "ext-001",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { amount: 100 },
      },
    },
  };
}

describe("buildDlqHandler (RES-02/RES-03) — final-attempt-gated DLQ writer", () => {
  it("Test 1: intermediate retry (attemptsMade < attempts) does NOT call deadLetterEvent.create (RES-02 gate)", async () => {
    const prisma = makeFakePrisma();
    const logger = makeLogger();
    const handler = buildDlqHandler(prisma as never, logger);

    const job = makeJob(2, 5); // 2nd attempt of 5 — not yet exhausted
    await handler(job as never, new Error("CRM 500"));

    expect(prisma.deadLetterEvent.create).not.toHaveBeenCalled();
  });

  it("Test 2: final attempt (attemptsMade >= attempts) calls deadLetterEvent.create exactly once", async () => {
    const prisma = makeFakePrisma();
    const logger = makeLogger();
    const handler = buildDlqHandler(prisma as never, logger);

    const job = makeJob(5, 5); // 5th attempt of 5 — exhausted
    await handler(job as never, new Error("CRM 500"));

    expect(prisma.deadLetterEvent.create).toHaveBeenCalledTimes(1);
  });

  it("Test 3: DLQ row captures fingerprint, source, eventType, payload, failureReason, errorStack, attempts (RES-03)", async () => {
    const prisma = makeFakePrisma();
    const logger = makeLogger();
    const handler = buildDlqHandler(prisma as never, logger);

    const job = makeJob(5, 5);
    const error = new Error("downstream timeout");
    await handler(job as never, error);

    const callArg = prisma.deadLetterEvent.create.mock.calls[0][0];
    const data = callArg.data;

    expect(data.fingerprint).toBe("a".repeat(64));
    expect(data.source).toBe("SHOPEE");
    expect(data.eventType).toBe("order.created");
    expect(data.payload).toBeDefined();
    expect(data.failureReason).toBe("downstream timeout");
    expect(data.errorStack).toBe(error.stack);
    expect(data.attempts).toBe(5);
  });

  it("Test 4: when job is undefined, handler returns without throwing and does NOT call create (Pitfall 6)", async () => {
    const prisma = makeFakePrisma();
    const logger = makeLogger();
    const handler = buildDlqHandler(prisma as never, logger);

    await expect(
      handler(undefined as never, new Error("stalled")),
    ).resolves.toBeUndefined();

    expect(prisma.deadLetterEvent.create).not.toHaveBeenCalled();
  });

  it("Test 5: when job.opts.attempts is undefined, defaults to 1 so attemptsMade=1 triggers insert", async () => {
    const prisma = makeFakePrisma();
    const logger = makeLogger();
    const handler = buildDlqHandler(prisma as never, logger);

    const job = {
      id: "test",
      attemptsMade: 1,
      opts: {}, // no attempts property
      data: {
        source: "SHOPEE",
        fingerprint: "b".repeat(64),
        payload: {
          source: "SHOPEE",
          eventType: "order.updated",
          externalId: "ext-002",
          occurredAt: "2026-01-01T00:00:00.000Z",
          payload: {},
        },
      },
    };
    await handler(job as never, new Error("unknown failure"));

    expect(prisma.deadLetterEvent.create).toHaveBeenCalledTimes(1);
  });
});
