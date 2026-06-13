import type { EventJobData, RoutingRule } from "@omnisync/types";
import { applyRules } from "./rule-engine.js";

export interface NormalizedEvent {
  fingerprint: string;
  source: string;
  eventType: string;
  externalId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

// Canonical envelope extraction (D-01/D-02) + routing-rule application seam (D-20).
// occurredAt canonicalized to a UTC Date via new Date(x) — same algorithm as buildFingerprint (canonical ISO round-trip).
// rules default to [] so callers without rules (e.g. existing unit tests) get a pure pass-through.
export function normalize(
  job: EventJobData,
  rules: RoutingRule[] = [],
): NormalizedEvent {
  // Phase 4: routing-rule application AT THE SEAM (D-20). Rules transform the payload
  // (e.g. phone_normalize_e164) before the canonical envelope is built. Empty rules = pass-through.
  const payload = applyRules(
    rules,
    job.payload as unknown as Record<string, unknown>,
  );
  return {
    fingerprint: job.fingerprint,
    source: job.source,
    eventType: job.payload.eventType,
    externalId: job.payload.externalId,
    occurredAt: new Date(new Date(job.payload.occurredAt).toISOString()),
    payload,
  };
}
