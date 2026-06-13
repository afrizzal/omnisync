import type { RoutingRule } from "@omnisync/types";

type RuleHandler = (value: unknown) => unknown;

// Dispatch table — NOT if/else (D-19). Extension point: add a key here for each new rule type.
// Future obvious extensions named explicitly: field_rename, field_drop.
const ruleHandlers: Record<string, RuleHandler> = {
  phone_normalize_e164: (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const digits = value.replace(/[^\d+]/g, "");
    // Indonesian normalization for v1 demo: leading 0 -> +62. Already-+ numbers pass through.
    // Production swaps this body for libphonenumber-js parse().format("E.164"); interface unchanged.
    if (/^0\d{8,12}$/.test(digits)) return `+62${digits.slice(1)}`;
    if (/^\+\d{8,15}$/.test(digits)) return digits;
    return value; // unparseable — pass through unchanged
  },
};

// Apply rules in order, returning a NEW payload (no mutation). Unknown types and missing
// fields are no-ops (resilient by construction).
export function applyRules(
  rules: RoutingRule[],
  payload: Record<string, unknown>,
): Record<string, unknown> {
  let result = payload;
  for (const rule of rules) {
    const handler = ruleHandlers[rule.type];
    if (!handler || !(rule.field in result)) continue;
    result = { ...result, [rule.field]: handler(result[rule.field]) };
  }
  return result;
}
