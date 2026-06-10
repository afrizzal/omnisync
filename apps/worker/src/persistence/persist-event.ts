import type { PrismaClient } from "@omnisync/db";
import type { NormalizedEvent } from "../normalizer/normalize.js";

// Single atomic write (D-03). Returns "inserted" (affected=1) or "duplicate" (affected=0, conflict absorbed = success per D-05).
// NEVER check-then-act (PITFALLS #3) — the ON CONFLICT clause is the only dedup at this layer.
// SQL reused verbatim from the 03-01 smoke test that proved it works against the real schema.
export async function persistEvent(
  prisma: PrismaClient,
  event: NormalizedEvent,
): Promise<"inserted" | "duplicate"> {
  const affected = await prisma.$executeRaw`
    INSERT INTO events (
      id, fingerprint, source, "eventType", "externalId",
      "occurredAt", payload, status, "retryCount", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${event.fingerprint}, ${event.source}, ${event.eventType}, ${event.externalId},
      ${event.occurredAt}, ${JSON.stringify(event.payload)}::jsonb,
      'COMPLETED'::"EventStatus", 0, now(), now()
    )
    ON CONFLICT (fingerprint) DO NOTHING
  `;
  return affected === 1 ? "inserted" : "duplicate";
}
