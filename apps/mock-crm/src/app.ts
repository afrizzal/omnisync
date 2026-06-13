import Fastify, { type FastifyInstance } from "fastify";

type FailureMode = { mode: "ok" | "fail" | "slow"; rate: number };

// Module-level runtime state — flipped by POST /admin/failure-mode without a restart (D-08).
let failureMode: FailureMode = { mode: "ok", rate: 0 };

export function buildMockCrm(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.post("/crm/sync", async (_req, reply) => {
    if (failureMode.mode === "fail" && Math.random() < failureMode.rate) {
      return reply.code(500).send({ error: "MOCK_CRM_FAILURE" });
    }
    if (failureMode.mode === "slow") {
      // rate = delay in ms — exercises the Timeout policy / slow-downstream demo
      await new Promise((r) => setTimeout(r, failureMode.rate));
    }
    return reply.code(200).send({ status: "synced" });
  });

  app.post("/admin/failure-mode", async (req, reply) => {
    failureMode = req.body as FailureMode;
    return reply.send({ ok: true, failureMode });
  });

  // Test/demo helper so callers can inspect current mode
  app.get("/admin/failure-mode", async (_req, reply) =>
    reply.send(failureMode),
  );

  return app;
}
