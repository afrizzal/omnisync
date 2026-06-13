import { BrokenCircuitError } from "cockatiel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCrmPolicy } from "../../src/crm/crm-policy.js";

// RES-04/RES-05: Circuit-breaker tests — must FAIL (RED) before implementation exists.
// D-02 resolution: BullMQ owns retry scheduling; cockatiel ConsecutiveBreaker(5) owns the breaker ONLY.
// The policy is a MODULE-LEVEL SINGLETON — it accumulates consecutive failures across BullMQ attempts.

describe("createCrmPolicy (RES-04/RES-05) — cockatiel ConsecutiveBreaker(5)", () => {
  it("Test 1: first 5 executions of a failing fn all reject with the underlying error (breaker still closed)", async () => {
    const policy = createCrmPolicy(10000);
    const failing = async () => {
      throw new Error("CRM 500");
    };

    for (let i = 0; i < 5; i++) {
      await expect(policy.execute(failing)).rejects.toThrow("CRM 500");
    }
  });

  it("Test 2: the 6th execution rejects with BrokenCircuitError (circuit is open after 5 consecutive failures — RES-04)", async () => {
    const policy = createCrmPolicy(10000);
    const failing = async () => {
      throw new Error("CRM 500");
    };

    // exhaust the 5 failures to open the breaker
    for (let i = 0; i < 5; i++) {
      await expect(policy.execute(failing)).rejects.toThrow("CRM 500");
    }

    // 6th call should be blocked by open breaker
    await expect(policy.execute(failing)).rejects.toBeInstanceOf(
      BrokenCircuitError,
    );
  });

  it("Test 3: while breaker is open, the wrapped function is NOT invoked (RES-05 — does not hammer the CRM)", async () => {
    const policy = createCrmPolicy(10000);
    let callCount = 0;
    const failing = async () => {
      callCount++;
      throw new Error("CRM 500");
    };

    // exhaust 5 failures
    for (let i = 0; i < 5; i++) {
      await expect(policy.execute(failing)).rejects.toThrow("CRM 500");
    }

    expect(callCount).toBe(5);

    // 6th call — breaker is open, fn should NOT be invoked
    await expect(policy.execute(failing)).rejects.toBeInstanceOf(
      BrokenCircuitError,
    );

    // counter must still be 5 — not 6
    expect(callCount).toBe(5);
  });

  it("Test 4: after halfOpenAfter ms, a succeeding probe can close the breaker (recovery path)", async () => {
    vi.useFakeTimers();
    try {
      // Use 1ms halfOpenAfter to allow fake-timer advancement
      const policy = createCrmPolicy(1);
      const failing = async () => {
        throw new Error("CRM 500");
      };

      // Open the breaker
      for (let i = 0; i < 5; i++) {
        await expect(policy.execute(failing)).rejects.toThrow("CRM 500");
      }

      // Advance fake time past halfOpenAfter to move to HalfOpen
      await vi.advanceTimersByTimeAsync(100);

      // A succeeding probe should close the breaker
      const result = await policy.execute(async () => "ok");
      expect(result).toBe("ok");

      // Now a normal call should also succeed (breaker closed again)
      const result2 = await policy.execute(async () => "also ok");
      expect(result2).toBe("also ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
