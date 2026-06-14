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
import { dlqListRoutes } from "./routes/dlq-list.js";
import { demoRoutes } from "./routes/demo.js";
import { healthRoutes } from "./routes/health.js";
import { ingestRoutes } from "./routes/ingest.js";
import { metricsRoutes } from "./routes/metrics.js";

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
  // Demo stub route — no DB needed (D-17: /demo page button calls POST /api/demo/start)
  await app.register(async (instance) => {
    await demoRoutes(instance);
  });
  if (deps.prisma) {
    const prisma = deps.prisma;
    await app.register(async (instance) => {
      await adminRoutes(instance, { prisma, queue: deps.queue });
    });
    await app.register(async (instance) => {
      await metricsRoutes(instance, { prisma, queue: deps.queue });
    });
    await app.register(async (instance) => {
      await dlqListRoutes(instance, { prisma });
    });
  }
  // Bull-Board queue browser at /admin/queues (no auth — Phase 6 scope)
  // Wrapped in try-catch: BullMQAdapter validates queue instanceof Queue —
  // mock queues in unit tests are not real Queue instances, so we skip gracefully.
  try {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath("/admin/queues");
    createBullBoard({
      queues: [new BullMQAdapter(deps.queue)],
      serverAdapter,
    });
    await app.register(serverAdapter.registerPlugin(), {
      prefix: "/admin/queues",
    });
  } catch (_err) {
    // Non-BullMQ queue (e.g. test mock) — Bull-Board mount skipped
  }
  return app;
}
