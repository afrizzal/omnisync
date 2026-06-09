import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a GitHub-style "sha256=<hex>" webhook signature using constant-time comparison.
 * Returns false (never throws) for any malformed, missing, or invalid input.
 *
 * Security: Uses crypto.timingSafeEqual to prevent timing attacks.
 * The length guard before timingSafeEqual prevents it from throwing on
 * malformed hex strings that decode to a different byte length than expected.
 */
export function verifySignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice(7);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
