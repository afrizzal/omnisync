import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export * from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// pg pool max >= WORKER_CONCURRENCY guarantees no pool exhaustion under parallel jobs (SC-4).
// createPrismaClient(opts) — factory for callers that need to size the pg pool.
// The worker passes max = WORKER_CONCURRENCY + 2 (research: 2 spare for health/migrations).
// Default max = 10 matches node-postgres default (what the singleton already uses).
export function createPrismaClient(opts?: { max?: number }): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts?.max ?? 10 });
  return new PrismaClient({ adapter });
}
