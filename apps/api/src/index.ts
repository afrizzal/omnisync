import { env } from "@omnisync/config";
import { createEventsQueue, createRedisConnection } from "@omnisync/queue";
import { buildApp } from "./app.js";

const connection = createRedisConnection(env.REDIS_URL);
const queue = createEventsQueue(connection);

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({ queue, redis: connection });
await app.listen({ port, host });
app.log.info(`[api] listening on ${host}:${port} — NODE_ENV=${env.NODE_ENV}`);

async function shutdown(): Promise<void> {
  await app.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
