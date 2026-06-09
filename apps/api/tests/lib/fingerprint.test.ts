import { describe, it, expect } from "vitest";
import { buildFingerprint } from "../../src/lib/fingerprint.js";

describe("buildFingerprint", () => {
  const SOURCE = "SHOPEE";
  const EVENT_TYPE = "order.created";
  const EXTERNAL_ID = "abc";
  const OCCURRED_AT = "2026-06-09T10:00:00.000Z";

  it("returns a 64-char lowercase hex string", () => {
    const result = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce identical output", () => {
    const first = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    const second = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    expect(first).toBe(second);
  });

  it("is field-sensitive — different source produces different hash", () => {
    const shopee = buildFingerprint("SHOPEE", EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    const tokopedia = buildFingerprint("TOKOPEDIA", EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    expect(shopee).not.toBe(tokopedia);
  });

  it("is field-sensitive — different eventType produces different hash", () => {
    const created = buildFingerprint(SOURCE, "order.created", EXTERNAL_ID, OCCURRED_AT);
    const updated = buildFingerprint(SOURCE, "order.updated", EXTERNAL_ID, OCCURRED_AT);
    expect(created).not.toBe(updated);
  });

  it("is field-sensitive — different externalId produces different hash", () => {
    const a = buildFingerprint(SOURCE, EVENT_TYPE, "abc", OCCURRED_AT);
    const b = buildFingerprint(SOURCE, EVENT_TYPE, "xyz", OCCURRED_AT);
    expect(a).not.toBe(b);
  });

  it("is field-sensitive — different occurredAt produces different hash", () => {
    const t1 = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, "2026-06-09T10:00:00.000Z");
    const t2 = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, "2026-06-09T11:00:00.000Z");
    expect(t1).not.toBe(t2);
  });

  it("prevents field-boundary collisions via null-byte separator", () => {
    // Without null-byte separator, "a"+"bc"+"d" would collide with "ab"+"c"+"d"
    const noCollision1 = buildFingerprint("a", "b", "c", "d");
    const noCollision2 = buildFingerprint("ab", "c", "d", "");
    expect(noCollision1).not.toBe(noCollision2);
  });

  it("matches a known-value anchor (stability guard against algorithm changes)", () => {
    // Known value computed during GREEN phase — hardcoded to detect future algorithm drift
    const known = buildFingerprint(SOURCE, EVENT_TYPE, EXTERNAL_ID, OCCURRED_AT);
    // Placeholder: will be replaced with the actual hash during GREEN
    expect(known).toMatch(/^[0-9a-f]{64}$/);
    // The actual hardcoded value is set below after GREEN confirms it:
    expect(known).toBe("PLACEHOLDER_HASH_TO_BE_REPLACED");
  });
});
