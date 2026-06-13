import type { PrismaClient } from "@omnisync/db";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { adminRoutes } from "./routes/admin.js";
import { healthRoutes } from "./routes/health.js";
import { ingestRoutes } from "./routes/ingest.js";

export interface AppDeps {
  queue: Pick<Queue, "add">;
  redis: Pick<Redis, "set" | "del">;
  prisma?: PrismaClient; // present only when admin routes are needed
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
  if (deps.prisma) {
    const prisma = deps.prisma;
    await app.register(async (instance) => {
      await adminRoutes(instance, { prisma, queue: deps.queue });
    });
  }
  return app;
}
