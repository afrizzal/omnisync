import { z } from "zod/v4";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  REDIS_URL: z.url(),
  WEBHOOK_SECRET_SHOPEE: z.string().min(1),
  WEBHOOK_SECRET_TOKOPEDIA: z.string().min(1),
  WEBHOOK_SECRET_META_ADS: z.string().min(1),
  WEBHOOK_SECRET_CRM: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).default(1000),
  RETRY_CAP_MS: z.coerce.number().int().min(1000).default(30000),
  BREAKER_HALF_OPEN_MS: z.coerce.number().int().min(1000).default(10000),
  RULE_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(30000),
  CRM_BASE_URL: z.url().default("http://mock-crm:3002"),
});

export const env = (() => {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      z.treeifyError(parsed.error),
    );
    process.exit(1);
  }
  return parsed.data;
})();
