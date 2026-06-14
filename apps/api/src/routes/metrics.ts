import type { PrismaClient } from "@omnisync/db";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";

export interface MetricsDeps {
  queue: Queue;
  prisma: PrismaClient;
}

export async function metricsRoutes(
  app: FastifyInstance,
  deps: MetricsDeps,
): Promise<void> {
  app.get("/api/metrics", async (_request, reply) => {
    const [queue, total, unresolved, last60s] = await Promise.all([
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
    ]);
    return reply.send({
      queue,
      events: { total },
      dlq: { unresolved },
      throughput: { last60s },
    });
  });
}
