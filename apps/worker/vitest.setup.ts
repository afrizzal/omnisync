// Required env vars for all worker tests — set before any module imports trigger env parsing.
// Defaults point at the local docker-compose services (Postgres host 5433, Redis 6379).
// CI overrides DATABASE_URL/DIRECT_URL/REDIS_URL via the workflow `env:` block (service containers).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://omnisync:omnisync@localhost:5433/omnisync";
process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.WEBHOOK_SECRET_SHOPEE = "test-secret-shopee";
process.env.WEBHOOK_SECRET_TOKOPEDIA = "test-secret-tokopedia";
process.env.WEBHOOK_SECRET_META_ADS = "test-secret-meta";
process.env.WEBHOOK_SECRET_CRM = "test-secret-crm";
process.env.WORKER_CONCURRENCY = process.env.WORKER_CONCURRENCY ?? "5";
