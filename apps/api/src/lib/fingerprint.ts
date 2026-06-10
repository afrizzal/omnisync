import { createHash } from "node:crypto";

/**
 * Computes a stable, deterministic idempotency fingerprint for an inbound event.
 * Input fields are null-byte separated to prevent field-boundary collisions.
 * occurredAt is canonicalized to ISO-8601 UTC (via Date.toISOString()) before hashing
 * so that equivalent instants in different ISO-8601 forms ("Z", ".000Z", "+00:00")
 * always produce the same fingerprint.
 * Returns a 64-character lowercase SHA-256 hex string.
 */
export function buildFingerprint(
  source: string,
  eventType: string,
  externalId: string,
  occurredAt: string,
): string {
  const normalizedOccurredAt = new Date(occurredAt).toISOString();
  return createHash("sha256")
    .update([source, eventType, externalId, normalizedOccurredAt].join("\0"))
    .digest("hex");
}
