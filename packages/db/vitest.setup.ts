process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://omnisync:omnisync@localhost:5433/omnisync";
process.env.DIRECT_URL = process.env.DATABASE_URL;
