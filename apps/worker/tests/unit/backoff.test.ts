import { env } from "@omnisync/config";
import { fullJitterBackoff } from "@omnisync/queue";
import { describe, expect, it } from "vitest";

// RES-01: Full-jitter backoff — tests must fail (RED) before implementation.
// Formula: delay = random(0, min(cap, base * 2^attempt))
// Source: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
describe("fullJitterBackoff (RES-01) — AWS full-jitter strategy", () => {
  it("Test 1: attempt=0 returns a number in [0, base] ([0, 1000] at defaults)", () => {
    const result = fullJitterBackoff(0, "custom", new Error());
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(env.RETRY_BASE_DELAY_MS);
  });

  it("Test 2: attempt=3 returns a number <= min(cap, base * 2^3) = min(30000, 8000) = 8000", () => {
    const result = fullJitterBackoff(3, "custom", new Error());
    const maxExpected = Math.min(env.RETRY_CAP_MS, env.RETRY_BASE_DELAY_MS * 2 ** 3);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(maxExpected);
  });

  it("Test 3: attempt=20 is capped at cap (30000) — exponent overflow clamped by Math.min", () => {
    const result = fullJitterBackoff(20, "custom", new Error());
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(env.RETRY_CAP_MS);
  });

  it("Test 4: all returned values are >= 0 (no negative delays)", () => {
    for (let attempt = 0; attempt <= 10; attempt++) {
      const result = fullJitterBackoff(attempt, "custom", new Error());
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it("Test 5: jitter spread — 100 calls with same attempt produce non-identical values (RES-01 thundering-herd guard)", () => {
    const results = Array.from({ length: 100 }, () =>
      fullJitterBackoff(3, "custom", new Error()),
    );
    // If all values are identical, there's no jitter — thundering herd not prevented
    expect(new Set(results).size).toBeGreaterThan(1);
  });
});
