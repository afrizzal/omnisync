import type { EventJobData, RoutingRule } from "@omnisync/types";
import { describe, expect, it } from "vitest";
import { normalize } from "../../src/normalizer/normalize.js";

// Valid EventJobData fixture
const validJobData: EventJobData = {
  source: "SHOPEE",
  fingerprint: "a".repeat(64),
  payload: {
    source: "SHOPEE",
    eventType: "order.created",
    externalId: "ext-001",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { amount: 100 },
  },
};

describe("normalize() — canonical envelope extraction (D-01/D-02)", () => {
  it("Test 1: returns a NormalizedEvent with all fields copied through + occurredAt as Date", () => {
    const result = normalize(validJobData);

    expect(result.fingerprint).toBe(validJobData.fingerprint);
    expect(result.source).toBe(validJobData.source);
    expect(result.eventType).toBe(validJobData.payload.eventType);
    expect(result.externalId).toBe(validJobData.payload.externalId);
    expect(result.occurredAt).toBeInstanceOf(Date);
    // occurredAt must equal the same instant as the input string
    expect(result.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(result.payload).toEqual(validJobData.payload);
  });

  it("Test 2: non-UTC offset ISO input canonicalizes to UTC via toISOString", () => {
    // "2026-01-01T07:00:00+07:00" is the same instant as "2026-01-01T00:00:00.000Z"
    const jobDataWithOffset: EventJobData = {
      ...validJobData,
      payload: {
        ...validJobData.payload,
        occurredAt: "2026-01-01T07:00:00+07:00",
      },
    };

    const result = normalize(jobDataWithOffset);

    expect(result.occurredAt).toBeInstanceOf(Date);
    expect(result.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("Test 3 (RTE-01/RTE-02): phone_normalize_e164 rule transforms payload.phone before envelope is built", () => {
    // The rule operates on job.payload cast to Record<string,unknown>.
    // We construct a job whose payload has a `phone` sibling field alongside eventType/externalId etc.
    const jobDataWithPhone = {
      ...validJobData,
      payload: {
        ...validJobData.payload,
        // phone is an extra field on the InboundEvent — passed through via cast in normalize()
        phone: "08123456789",
      },
    } as unknown as EventJobData;

    const rules: RoutingRule[] = [
      { type: "phone_normalize_e164", field: "phone" },
    ];

    const result = normalize(jobDataWithPhone, rules);

    // The rule must have transformed the Indonesian local number to E.164 format
    expect(result.payload.phone).toBe("+628123456789");
    // All canonical envelope fields remain intact
    expect(result.fingerprint).toBe(validJobData.fingerprint);
    expect(result.eventType).toBe(validJobData.payload.eventType);
    expect(result.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
