import { describe, expect, it } from "vitest";
import { buildFingerprint } from "../../src/lib/fingerprint.js";

describe("buildFingerprint", () => {
  const SOURCE = "SHOPEE";
  const EVENT_TYPE = "order.created";
  const EXTERNAL_ID = "abc";
  const OCCURRED_AT = "2026-06-09T10:00:00.000Z";

  it("returns a 64-char lowercase hex string", () => {
    const result = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce identical output", () => {
    const first = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    const second = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    expect(first).toBe(second);
  });

  it("is field-sensitive — different source produces different hash", () => {
    const shopee = buildFingerprint(
      "SHOPEE",
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    const tokopedia = buildFingerprint(
      "TOKOPEDIA",
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    expect(shopee).not.toBe(tokopedia);
  });

  it("is field-sensitive — different eventType produces different hash", () => {
    const created = buildFingerprint(
      SOURCE,
      "order.created",
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    const updated = buildFingerprint(
      SOURCE,
      "order.updated",
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    expect(created).not.toBe(updated);
  });

  it("is field-sensitive — different externalId produces different hash", () => {
    const a = buildFingerprint(SOURCE, EVENT_TYPE, "abc", OCCURRED_AT);
    const b = buildFingerprint(SOURCE, EVENT_TYPE, "xyz", OCCURRED_AT);
    expect(a).not.toBe(b);
  });

  it("is field-sensitive — different occurredAt produces different hash", () => {
    const t1 = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T10:00:00.000Z",
    );
    const t2 = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T11:00:00.000Z",
    );
    expect(t1).not.toBe(t2);
  });

  it("prevents field-boundary collisions via null-byte separator", () => {
    // Without null-byte separator, "a"+"bc"+"d" and "ab"+"c"+"d" would collide.
    // Use valid ISO timestamps as the occurredAt argument (normalization is a no-op for canonical inputs).
    const noCollision1 = buildFingerprint(
      "a",
      "bc",
      "d",
      "2026-06-09T10:00:00.000Z",
    );
    const noCollision2 = buildFingerprint(
      "ab",
      "c",
      "d",
      "2026-06-09T10:00:00.000Z",
    );
    expect(noCollision1).not.toBe(noCollision2);
  });

  it("matches a known-value anchor (stability guard against algorithm changes)", () => {
    // Known value hardcoded to detect future algorithm drift.
    // The anchor input (OCCURRED_AT = "2026-06-09T10:00:00.000Z") is already canonical ISO-8601 UTC,
    // so normalization is a no-op for it — this anchor value is UNCHANGED by the normalization fix.
    const known = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      OCCURRED_AT,
    );
    expect(known).toBe(
      "7ed400d9932c822806865fbc3658051dcffc88718ad40ea0039690d284d0ea74",
    );
  });

  it("normalizes equivalent ISO-8601 instants to the same fingerprint", () => {
    // Three different string representations of the same UTC instant must hash identically
    const withZ = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T10:00:00Z",
    );
    const withMillis = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T10:00:00.000Z",
    );
    const withOffset = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T10:00:00+00:00",
    );
    expect(withZ).toBe(withMillis);
    expect(withMillis).toBe(withOffset);
  });

  it("a genuinely different instant still produces a different fingerprint", () => {
    const tenAM = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T10:00:00.000Z",
    );
    const elevenAM = buildFingerprint(
      SOURCE,
      EVENT_TYPE,
      EXTERNAL_ID,
      "2026-06-09T11:00:00.000Z",
    );
    expect(tenAM).not.toBe(elevenAM);
  });
});
