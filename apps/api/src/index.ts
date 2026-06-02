import { prisma } from "@omnisync/db";
import { env } from "@omnisync/config";

console.log(
  `[api] ready — NODE_ENV=${env.NODE_ENV} db=${env.DATABASE_URL.split("@")[1] ?? env.DATABASE_URL}`,
);

// Stub — Fastify HTTP server lands in Phase 2
// Disconnect Prisma on exit so the process terminates cleanly
process.on("SIGINT", () => {
  void prisma.$disconnect().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void prisma.$disconnect().then(() => process.exit(0));
});
