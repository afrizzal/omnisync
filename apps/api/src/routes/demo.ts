import type { FastifyInstance } from "fastify";

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/demo/start", async (_request, reply) => {
    // STUB: Phase 6 (OPS-04) wires this to the synthetic-event load-test
    // script. For now it acknowledges the request so the /demo page button
    // has a working endpoint and the chart can populate from live events.
    return reply.code(202).send({ status: "started" });
  });
}
