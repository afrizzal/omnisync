import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@omnisync/db";
import { env } from "@omnisync/config";
import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { adminRoutes } from "./routes/admin.js";
import { healthRoutes } from "./routes/health.js";
import { ingestRoutes } from "./routes/ingest.js";

export interface AppDeps {
  queue: Queue;
  redis: Pick<Redis, "set" | "del">;
  prisma?: PrismaClient; // present only when admin routes are needed
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  // CORS must be registered FIRST — before any route so preflight OPTIONS
  // requests are handled before routes attempt to process them.
  await app.register(cors, {
    origin: env.DASHBOARD_URL ?? "*",
    methods: ["GET", "POST", "OPTIONS"],
  });
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
  // Bull-Board queue browser at /admin/queues (no auth — Phase 6 scope)
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [new BullMQAdapter(deps.queue)],
    serverAdapter,
  });
  await app.register(serverAdapter.registerPlugin(), {
    prefix: "/admin/queues",
    basePath: "/admin/queues",
  });
  return app;
}
