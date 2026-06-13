import type { FastifyInstance } from "fastify";
import { requeueDlqEntry, type RequeueDeps } from "../services/requeue.js";

export async function adminRoutes(
  app: FastifyInstance,
  deps: RequeueDeps,
): Promise<void> {
  app.post("/admin/dlq/:id/requeue", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await requeueDlqEntry(deps, id);

    if (result.status === "not_found") {
      return reply.code(404).send({
        error: "DLQ_ENTRY_NOT_FOUND",
        message: `No DLQ entry with id ${id}`,
      });
    }
    if (result.status === "already_queued") {
      return reply.code(200).send({
        status: "already_queued",
        fingerprint: result.fingerprint,
      });
    }
    return reply.code(200).send({
      status: "requeued",
      fingerprint: result.fingerprint,
    });
  });
}
