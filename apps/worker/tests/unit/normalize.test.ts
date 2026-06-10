import { describe, expect, it } from "vitest";
import type { EventJobData } from "@omnisync/types";
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
});
