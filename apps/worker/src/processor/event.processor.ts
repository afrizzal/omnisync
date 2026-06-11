import type { PrismaClient } from "@omnisync/db";
import { EventJobData } from "@omnisync/types";
import type { Job } from "bullmq";
import { z } from "zod/v4";
import { normalize } from "../normalizer/normalize.js";
import { persistEvent } from "../persistence/persist-event.js";

export interface ProcessorLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export function buildProcessor(prisma: PrismaClient, logger: ProcessorLogger) {
  return async function processEvent(
    job: Pick<Job, "id" | "data">,
  ): Promise<void> {
    logger.info({ jobId: job.id }, "[worker] processing");

    // D-10 poison-message guard — invalid job data fails immediately (lands in failed set; Phase 4 routes to DLQ).
    const parsed = EventJobData.safeParse(job.data);
    if (!parsed.success) {
      const reason = JSON.stringify(z.treeifyError(parsed.error));
      logger.error({ jobId: job.id, reason }, "[worker] invalid job data");
      throw new Error(`[worker] invalid job data for job ${job.id}: ${reason}`);
    }

    const normalized = normalize(parsed.data);
    const outcome = await persistEvent(prisma, normalized);

    if (outcome === "duplicate") {
      logger.info(
        { jobId: job.id, fingerprint: normalized.fingerprint },
        "[worker] duplicate absorbed",
      );
    } else {
      logger.info(
        { jobId: job.id, fingerprint: normalized.fingerprint },
        "[worker] completed",
      );
    }
    // No throw on duplicate — conflict is success (D-05). At-least-once safe: every path is safe to run twice.
  };
}
