import type { PrismaClient } from "@omnisync/db";
import type { Job, Queue } from "bullmq";
import type { FastifyInstance } from "fastify";

export interface MetricsDeps {
  queue: Queue;
  prisma: PrismaClient;
}

// OBS-02: latency + retry stats are sampled from the most recent completed jobs —
// BullMQ keeps per-job timestamps (created/processed/finished) but no aggregate gauge.
const LATENCY_SAMPLE_SIZE = 50;

interface LatencySample {
  avgWaitMs: number | null;
  avgProcessMs: number | null;
  sampleSize: number;
}

interface RetrySample {
  retriedJobs: number;
  totalRetries: number;
  sampleSize: number;
}

function sampleJobStats(jobs: Job[]): {
  latency: LatencySample;
  retries: RetrySample;
} {
  let waitSum = 0;
  let processSum = 0;
  let timed = 0;
  let retriedJobs = 0;
  let totalRetries = 0;

  for (const job of jobs) {
    if (job.processedOn !== undefined && job.finishedOn !== undefined) {
      waitSum += job.processedOn - job.timestamp;
      processSum += job.finishedOn - job.processedOn;
      timed += 1;
    }
    const retries = Math.max(0, job.attemptsMade - 1);
    if (retries > 0) {
      retriedJobs += 1;
      totalRetries += retries;
    }
  }

  return {
    latency: {
      avgWaitMs: timed > 0 ? Math.round(waitSum / timed) : null,
      avgProcessMs: timed > 0 ? Math.round(processSum / timed) : null,
      sampleSize: timed,
    },
    retries: { retriedJobs, totalRetries, sampleSize: jobs.length },
  };
}

export async function metricsRoutes(
  app: FastifyInstance,
  deps: MetricsDeps,
): Promise<void> {
  app.get("/api/metrics", async (_request, reply) => {
    const [queue, total, unresolved, last60s, recentCompleted, dlqBySource] =
      await Promise.all([
        deps.queue.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed",
        ),
        deps.prisma.event.count(),
        deps.prisma.deadLetterEvent.count({ where: { resolved: false } }),
        deps.prisma.event.count({
          where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
        }),
        deps.queue.getJobs(["completed"], 0, LATENCY_SAMPLE_SIZE - 1),
        deps.prisma.deadLetterEvent.groupBy({
          by: ["source"],
          where: { resolved: false },
          _count: { _all: true },
        }),
      ]);

    const { latency, retries } = sampleJobStats(recentCompleted);

    return reply.send({
      queue,
      events: { total },
      dlq: { unresolved },
      throughput: { last60s },
      latency,
      retries,
      errors: {
        bySource: dlqBySource.map((row) => ({
          source: row.source,
          count: row._count._all,
        })),
      },
    });
  });
}
