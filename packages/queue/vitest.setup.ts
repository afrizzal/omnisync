// Required env vars for queue tests — set before any module imports trigger env parsing.
// `src/index.ts` imports @omnisync/config, which Zod-parses the FULL env at module load
// and process.exit(1)s on failure. Same pattern as apps/worker/vitest.setup.ts:
// ?? defaults point at local docker-compose; CI job-level env overrides pass through.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://omnisync:omnisync@localhost:5433/omnisync";
process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.WEBHOOK_SECRET_SHOPEE = "test-secret-shopee";
process.env.WEBHOOK_SECRET_TOKOPEDIA = "test-secret-tokopedia";
process.env.WEBHOOK_SECRET_META_ADS = "test-secret-meta";
process.env.WEBHOOK_SECRET_CRM = "test-secret-crm";
process.env.RETRY_ATTEMPTS = process.env.RETRY_ATTEMPTS ?? "5";
process.env.RETRY_BASE_DELAY_MS = process.env.RETRY_BASE_DELAY_MS ?? "1000";
process.env.RETRY_CAP_MS = process.env.RETRY_CAP_MS ?? "30000";
