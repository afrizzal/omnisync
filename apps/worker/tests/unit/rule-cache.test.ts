import type { RoutingRule } from "@omnisync/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveRules,
  resetRulesCache,
} from "../../src/normalizer/rule-cache.js";

// Minimal fake PrismaClient — only the methods the cache uses
function makeFakePrisma(
  rows: RoutingRule[] = [{ type: "phone_normalize_e164", field: "phone" }],
) {
  return {
    routingRule: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  };
}

const TTL_MS = 5_000; // 5 seconds for tests

describe("getActiveRules() — lazy TTL rule cache (RTE-02)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRulesCache(); // Pitfall 7: always clear module-level cache between tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test 1: first call (cold cache) triggers exactly one findMany", async () => {
    const prisma = makeFakePrisma();
    await getActiveRules(prisma as never, TTL_MS);
    expect(prisma.routingRule.findMany).toHaveBeenCalledTimes(1);
  });

  it("Test 2: second call within TTL window does NOT trigger another findMany (cache hit)", async () => {
    const prisma = makeFakePrisma();
    await getActiveRules(prisma as never, TTL_MS);
    // Advance time by less than TTL
    vi.advanceTimersByTime(TTL_MS - 1);
    await getActiveRules(prisma as never, TTL_MS);
    expect(prisma.routingRule.findMany).toHaveBeenCalledTimes(1);
  });

  it("Test 3: call after TTL expires triggers a fresh findMany (RTE-02 reload after TTL)", async () => {
    const prisma = makeFakePrisma();
    await getActiveRules(prisma as never, TTL_MS);
    // Advance time past TTL
    vi.advanceTimersByTime(TTL_MS + 1);
    await getActiveRules(prisma as never, TTL_MS);
    expect(prisma.routingRule.findMany).toHaveBeenCalledTimes(2);
  });

  it("Test 4: resetRulesCache() clears state so next call reloads (Pitfall 7 — test isolation)", async () => {
    const prisma = makeFakePrisma();
    await getActiveRules(prisma as never, TTL_MS);
    resetRulesCache();
    await getActiveRules(prisma as never, TTL_MS);
    expect(prisma.routingRule.findMany).toHaveBeenCalledTimes(2);
  });

  it("Test 5: findMany is called with where: { enabled: true } and orderBy: { priority: 'desc' }", async () => {
    const prisma = makeFakePrisma();
    await getActiveRules(prisma as never, TTL_MS);
    expect(prisma.routingRule.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { priority: "desc" },
    });
  });
});
