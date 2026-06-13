import { describe, expect, it } from "vitest";
import type { RoutingRule } from "@omnisync/types";
import { applyRules } from "../../src/normalizer/rule-engine.js";

const phoneRule: RoutingRule = {
  type: "phone_normalize_e164",
  field: "phone",
};

describe("applyRules() — dispatch-table rule engine (RTE-01)", () => {
  it("Test 1: phone_normalize_e164 transforms Indonesian leading-0 number to E.164", () => {
    const result = applyRules([phoneRule], { phone: "08123456789" });
    expect(result.phone).toBe("+628123456789");
  });

  it("Test 2: rule applied to payload WITHOUT the target field returns payload unchanged", () => {
    const payload = { email: "user@example.com" };
    const result = applyRules([phoneRule], payload);
    expect(result).toEqual({ email: "user@example.com" });
    expect("phone" in result).toBe(false);
  });

  it("Test 3: non-string phone value (number) passes through unchanged", () => {
    const result = applyRules([phoneRule], { phone: 123 });
    expect(result.phone).toBe(123);
  });

  it("Test 4: unparseable phone string passes through unchanged (no throw)", () => {
    const result = applyRules([phoneRule], { phone: "not-a-phone" });
    expect(result.phone).toBe("not-a-phone");
  });

  it("Test 5: unknown rule type leaves payload unchanged (no throw)", () => {
    const unknownRule = { type: "unknown_rule_type", field: "phone" } as unknown as RoutingRule;
    const result = applyRules([unknownRule], { phone: "08123456789" });
    // Unknown type = no-op (resilient dispatch table)
    expect(result.phone).toBe("08123456789");
  });

  it("Test 6: multiple rules applied in order; returns new object (input not mutated)", () => {
    const phoneRule2: RoutingRule = { type: "phone_normalize_e164", field: "mobile" };
    const payload = { phone: "08123456789", mobile: "0811111111", other: "value" };
    const result = applyRules([phoneRule, phoneRule2], payload);

    expect(result.phone).toBe("+628123456789");
    expect(result.mobile).toBe("+62811111111");
    expect(result.other).toBe("value");

    // Input must NOT be mutated
    expect(payload.phone).toBe("08123456789");
    expect(payload.mobile).toBe("0811111111");
  });

  it("Test 7a: Zod union parse succeeds for valid phone_normalize_e164 rule", async () => {
    const { RoutingRule: RoutingRuleSchema } = await import("@omnisync/types");
    const parsed = RoutingRuleSchema.parse({ type: "phone_normalize_e164", field: "phone" });
    expect(parsed.type).toBe("phone_normalize_e164");
    expect(parsed.field).toBe("phone");
  });

  it("Test 7b: Zod union parse throws for unknown type", async () => {
    const { RoutingRule: RoutingRuleSchema } = await import("@omnisync/types");
    expect(() => RoutingRuleSchema.parse({ type: "unknown_rule", field: "x" })).toThrow();
  });
});
