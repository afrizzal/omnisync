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
