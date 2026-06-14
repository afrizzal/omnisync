import type { PrismaClient } from "@omnisync/db";
import type { FastifyInstance } from "fastify";

export interface DlqListDeps {
  prisma: PrismaClient;
}

export async function dlqListRoutes(
  app: FastifyInstance,
  deps: DlqListDeps,
): Promise<void> {
  app.get("/api/dlq", async (_request, reply) => {
    const entries = await deps.prisma.deadLetterEvent.findMany({
      where: { resolved: false },
      orderBy: { frozenAt: "desc" },
      take: 100,
    });
    return reply.send({ entries });
  });
}
