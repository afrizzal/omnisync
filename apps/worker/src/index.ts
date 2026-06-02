import { env } from "@omnisync/config";
import { QUEUE_NAME } from "@omnisync/queue";

console.log(
  `[worker] ready for queue "${QUEUE_NAME}" — NODE_ENV=${env.NODE_ENV}`,
);

// Keep the process alive so docker-compose worker service stays up.
// BullMQ Worker (with real job processing) arrives in Phase 3.
setInterval(() => {}, 1 << 30);
