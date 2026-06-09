import { createHash } from "node:crypto";

/**
 * Computes a stable, deterministic idempotency fingerprint for an inbound event.
 * Input fields are null-byte separated to prevent field-boundary collisions.
 * Returns a 64-character lowercase SHA-256 hex string.
 */
export function buildFingerprint(
  source: string,
  eventType: string,
  externalId: string,
  occurredAt: string,
): string {
  return createHash("sha256")
    .update([source, eventType, externalId, occurredAt].join("\0"))
    .digest("hex");
}
