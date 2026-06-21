// TST-03: concurrent duplicate webhooks result in exactly one stored record (the named, CI-gated proof).
import { createPrismaClient } from "@omnisync/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CrmClient } from "../../src/crm/crm-client.js";
import { createCrmPolicy } from "../../src/crm/crm-policy.js";
import { buildProcessor } from "../../src/processor/event.processor.js";

const prisma = createPrismaClient({ max: 12 });
const noopLogger = {
  info: (_obj: Record<string, unknown>, _msg: string) => {},
  error: (_obj: Record<string, unknown>, _msg: string) => {},
};
const noopCrmClient: CrmClient = { sync: async () => {} };
const passThroughPolicy = createCrmPolicy(10_000); // never trips: noopCrmClient never throws
const processEvent = buildProcessor(
  prisma,
  noopLogger,
  noopCrmClient,
  passThroughPolicy,
  60_000, // ttlMs for the rule cache
);

const fingerprint = "c".repeat(64);
const jobData = {
  source: "SHOPEE",
  payload: {
    source: "SHOPEE",
    eventType: "order.created",
    externalId: "ext-int-001",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { amount: 100 },
  },
  fingerprint,
};

describe("TST-03 / SC-2 / SC-3 idempotent persistence (IDM-02 / IDM-03)", () => {
  beforeEach(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
    await prisma.$disconnect();
  });

  it("TST-03: 50 concurrent identical jobs -> exactly 1 events row", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        processEvent({ id: `job-${i}`, data: jobData }),
      ),
    );
    expect(await prisma.event.count({ where: { fingerprint } })).toBe(1);
  });

  it("SC-3: re-processing an already-persisted event stays at 1 row", async () => {
    await processEvent({ id: "first", data: jobData });
    await processEvent({ id: "requeue-1", data: jobData });
    await processEvent({ id: "requeue-2", data: jobData });
    expect(await prisma.event.count({ where: { fingerprint } })).toBe(1);
  });
});
