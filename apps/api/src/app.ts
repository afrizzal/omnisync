import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { healthRoutes } from "./routes/health.js";
import { ingestRoutes } from "./routes/ingest.js";

export interface AppDeps {
  queue: Pick<Queue, "add">;
  redis: Pick<Redis, "set" | "del">;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(import("@fastify/helmet"));
  await app.register(import("@fastify/sensible"));
  await app.register(import("fastify-raw-body"), {
    global: true,
    encoding: false,
    runFirst: true,
  });
  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(async (instance) => {
    await ingestRoutes(instance, deps);
  });
  return app;
}
