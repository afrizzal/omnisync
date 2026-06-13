import { z } from "zod/v4";

// v1 has ONE variant. Adding a rule type later = one new object in this array + one handler
// in rule-engine.ts ruleHandlers + one test. No refactoring of existing code (D-18/D-19).
export const RoutingRule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("phone_normalize_e164"),
    field: z.string().min(1),
  }),
]);
export type RoutingRule = z.infer<typeof RoutingRule>;
export type RoutingRuleType = RoutingRule["type"];
