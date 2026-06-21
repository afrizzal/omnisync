import { createPrismaClient } from "@omnisync/db";
import { afterAll, describe, expect, it } from "vitest";
import type { CrmClient } from "../../src/crm/crm-client.js";
import { createCrmPolicy } from "../../src/crm/crm-policy.js";
import { buildProcessor } from "../../src/processor/event.processor.js";

// SC-4: concurrency 10 + pool max 12 formula — no pool exhaustion under parallel load (QUE-03)
// Uses buildProcessor directly (no BullMQ overhead) to maximise parallelism against the DB pool.

const JOB_COUNT = 20;
const CONCURRENCY = 10;

// Generate JOB_COUNT distinct 64-hex fingerprints so each job races for a UNIQUE row (not same-row conflicts)
const fingerprints = Array.from({ length: JOB_COUNT }, (_, i) =>
  i.toString(16).padStart(64, "0"),
);

const prisma = createPrismaClient({ max: CONCURRENCY + 2 }); // max = 12: pool formula proven (SC-4)
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

afterAll(async () => {
  await prisma.event.deleteMany({
    where: { fingerprint: { in: fingerprints } },
  });
  await prisma.$disconnect();
});

describe("SC-4 / QUE-03 pool-exhaustion guard (concurrency 10, pool max 12)", () => {
  it(`${JOB_COUNT} distinct jobs at logical concurrency ${CONCURRENCY} — all persist, no pool error`, {
    timeout: 30_000,
  }, async () => {
    // Clean up before test
    await prisma.event.deleteMany({
      where: { fingerprint: { in: fingerprints } },
    });

    const errors: string[] = [];

    // Fire all jobs concurrently — pool exhaustion would surface as a rejected promise
    await Promise.all(
      fingerprints.map((fp, i) => {
        const jobData = {
          source: "SHOPEE",
          payload: {
            source: "SHOPEE",
            eventType: "order.created",
            externalId: `ext-conc-${i}`,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload: { amount: i },
          },
          fingerprint: fp,
        };
        return processEvent({ id: `conc-job-${i}`, data: jobData }).catch(
          (err: unknown) => {
            errors.push(err instanceof Error ? err.message : String(err));
          },
        );
      }),
    );

    // Assert no pool exhaustion errors
    const poolErrors = errors.filter((msg) =>
      /too many clients|timeout exceeded|pool/i.test(msg),
    );
    expect(poolErrors).toHaveLength(0);

    // Assert all rows persisted
    const count = await prisma.event.count({
      where: { fingerprint: { in: fingerprints } },
    });
    expect(count).toBe(JOB_COUNT);
  });
});
