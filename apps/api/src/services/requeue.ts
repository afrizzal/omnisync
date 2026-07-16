import type { PrismaClient } from "@omnisync/db";
import type { Queue } from "bullmq";

export interface RequeueDeps {
  prisma: PrismaClient;
  queue: Pick<Queue, "add">;
}

export type RequeueResult =
  | { status: "requeued"; fingerprint: string }
  | { status: "not_found" }
  | { status: "already_queued"; fingerprint: string };

// RES-06: re-enqueue a DLQ entry through the NORMAL worker pipeline. Idempotent by construction:
// jobId = fingerprint -> BullMQ deduplicates an in-flight/duplicate re-queue; the worker's
// ON CONFLICT (fingerprint) DO NOTHING absorbs any duplicate at the DB (IDM-02/IDM-03).
// NOTE: we use queue.add (NOT job.retry) per research finding #6 — the failed BullMQ job may have
// been removed (removeOnFail age), but the Postgres dlq_events mirror is the durable source of truth.
export async function requeueDlqEntry(
  deps: RequeueDeps,
  id: string,
): Promise<RequeueResult> {
  const entry = await deps.prisma.deadLetterEvent.findUnique({ where: { id } });
  if (!entry) return { status: "not_found" };

  // Reconstruct EventJobData from the durable DLQ row. payload is the stored InboundEvent JSON.
  const jobData = {
    source: entry.source,
    payload: entry.payload,
    fingerprint: entry.fingerprint,
  };

  const job = await deps.queue.add("process-event", jobData, {
    jobId: entry.fingerprint, // reuse fingerprint -> BullMQ dedup makes re-queue idempotent
  });

  // BullMQ returns the existing job (no new add) when the jobId already exists in active/waiting;
  // treat a re-add of a still-present job as already_queued (Pitfall 8 double-click safety).
  if (job == null)
    return { status: "already_queued", fingerprint: entry.fingerprint };

  // Mark the DLQ entry resolved so the dashboard reflects the re-queue (optional but cheap).
  await deps.prisma.deadLetterEvent.update({
    where: { id },
    data: { resolved: true },
  });

  return { status: "requeued", fingerprint: entry.fingerprint };
}
