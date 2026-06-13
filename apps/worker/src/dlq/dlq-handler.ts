import type { PrismaClient } from "@omnisync/db";
import type { Job } from "bullmq";
import type { ProcessorLogger } from "../processor/event.processor.js";

// RES-02/RES-03: on EXHAUSTION (final attempt), mirror the failed job into the dlq_events
// Postgres table so DLQ history survives a Redis restart. BullMQ fires `failed` on EVERY
// failure — gate the insert on the final attempt (Pitfall 5) and guard undefined job (Pitfall 6).
export function buildDlqHandler(prisma: PrismaClient, logger: ProcessorLogger) {
  return async function onFailed(
    job: Job | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return; // Pitfall 6: stalled job + removeOnFail → job is undefined

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // intermediate retry — not yet exhausted

    const data = job.data as {
      source: string;
      fingerprint: string;
      payload?: { eventType?: string };
    };

    await prisma.deadLetterEvent.create({
      data: {
        fingerprint: data.fingerprint,
        source: data.source,
        eventType: data.payload?.eventType ?? "unknown",
        payload: (data.payload ?? {}) as object,
        failureReason: error.message,
        errorStack: error.stack ?? null,
        attempts: job.attemptsMade,
        eventId: null, // optional link if the events row exists; left null at exhaustion
      },
    });

    logger.error(
      { jobId: job.id, fingerprint: data.fingerprint, attempts: job.attemptsMade },
      "[worker] job exhausted -> DLQ",
    );
  };
}
