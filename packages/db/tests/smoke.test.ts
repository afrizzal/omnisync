import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/index.js";

const prisma = createPrismaClient({ max: 3 });
const fingerprint = "a".repeat(64); // valid 64-hex

async function rawInsert(): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO events (
      id, fingerprint, source, "eventType", "externalId",
      "occurredAt", payload, status, "retryCount", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${fingerprint}, 'SHOPEE', 'order.created', 'ext-smoke',
      ${new Date("2026-01-01T00:00:00.000Z")}, ${"{}"}::jsonb,
      'COMPLETED'::"EventStatus", 0, now(), now()
    )
    ON CONFLICT (fingerprint) DO NOTHING
  `;
}

describe("$executeRaw enum-cast idempotent insert (Open Question #1)", () => {
  beforeEach(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
  });
  afterAll(async () => {
    await prisma.event.deleteMany({ where: { fingerprint } });
    await prisma.$disconnect();
  });

  it("first insert affects 1 row; second is absorbed (0) and count stays 1", async () => {
    expect(await rawInsert()).toBe(1);
    expect(await rawInsert()).toBe(0);
    expect(await prisma.event.count({ where: { fingerprint } })).toBe(1);
  });
});
