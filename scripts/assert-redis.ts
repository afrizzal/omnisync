/**
 * assert-redis.ts
 *
 * Verifies that Redis is running with maxmemory-policy set to "noeviction".
 * Exits 0 if correct, exits 1 if misconfigured.
 *
 * Usage: tsx scripts/assert-redis.ts
 * Or via npm script: pnpm assert:redis
 */
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

try {
  await redis.connect();
  const result = await redis.config("GET", "maxmemory-policy");

  // ioredis returns config GET as an array: [key, value, key, value, ...]
  const policyIndex = result.indexOf("maxmemory-policy");
  const policy =
    policyIndex !== -1 ? result[policyIndex + 1] : (result[1] ?? "");

  if (policy !== "noeviction") {
    console.error(
      `FATAL: Redis maxmemory-policy is "${policy}", expected "noeviction"`,
    );
    console.error(
      "Fix: start Redis with --maxmemory-policy noeviction (or use docker-compose.yml)",
    );
    await redis.quit();
    process.exit(1);
  }

  console.log(`OK: Redis maxmemory-policy is "noeviction" at ${redisUrl}`);
  await redis.quit();
  process.exit(0);
} catch (err) {
  console.error("FATAL: Could not connect to Redis:", err);
  process.exit(1);
}
