// Required env vars for all tests — set before any module imports trigger env parsing
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
process.env["DIRECT_URL"] = "postgresql://test:test@localhost:5432/test";
process.env["REDIS_URL"] = "redis://localhost:6379";
process.env["WEBHOOK_SECRET_SHOPEE"] = "test-secret-shopee";
process.env["WEBHOOK_SECRET_TOKOPEDIA"] = "test-secret-tokopedia";
process.env["WEBHOOK_SECRET_META_ADS"] = "test-secret-meta";
process.env["WEBHOOK_SECRET_CRM"] = "test-secret-crm";
