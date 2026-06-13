import type { PrismaClient } from "@omnisync/db";
import { EventJobData } from "@omnisync/types";
import type { CircuitBreakerPolicy } from "cockatiel";
import type { Job } from "bullmq";
import { z } from "zod/v4";
import type { CrmClient } from "../crm/crm-client.js";
import { normalize } from "../normalizer/normalize.js";
import { getActiveRules } from "../normalizer/rule-cache.js";
import { persistEvent } from "../persistence/persist-event.js";

export interface ProcessorLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export function buildProcessor(
  prisma: PrismaClient,
  logger: ProcessorLogger,
  crmClient: CrmClient,
  crmPolicy: CircuitBreakerPolicy,
  ttlMs: number,
) {
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

    // RTE-02: load active rules via lazy TTL cache (DB hit only when TTL expired)
    const rules = await getActiveRules(prisma, ttlMs);
    const normalized = normalize(parsed.data, rules);

    // Persist FIRST. Postgres failure throws here and propagates straight to BullMQ retry —
    // it must NOT touch the CRM breaker (Pitfall 4 / RES-07). persistEvent is NOT inside execute().
    const outcome = await persistEvent(prisma, normalized);

    // RES-04/RES-05: CRM sync AFTER successful persist, guarded by the cockatiel breaker.
    // BrokenCircuitError (open breaker) and CRM errors both throw -> BullMQ retries with backoff.
    await crmPolicy.execute(() => crmClient.sync(normalized));

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
