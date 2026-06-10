import type { EventJobData } from "@omnisync/types";

export interface NormalizedEvent {
  fingerprint: string;
  source: string;
  eventType: string;
  externalId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

// Canonical envelope extraction only (D-01/D-02). No semantic transformation in Phase 3.
// Phase 4 inserts rule application HERE — this seam is intentionally a pass-through.
// occurredAt canonicalized to a UTC Date via new Date(x) — same algorithm as buildFingerprint (canonical ISO round-trip).
export function normalize(job: EventJobData): NormalizedEvent {
  return {
    fingerprint: job.fingerprint,
    source: job.source,
    eventType: job.payload.eventType,
    externalId: job.payload.externalId,
    occurredAt: new Date(new Date(job.payload.occurredAt).toISOString()),
    payload: job.payload as unknown as Record<string, unknown>,
  };
}
