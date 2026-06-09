import { env } from "@omnisync/config";

const SECRET_BY_SOURCE: Record<string, string> = {
  SHOPEE: env.WEBHOOK_SECRET_SHOPEE,
  TOKOPEDIA: env.WEBHOOK_SECRET_TOKOPEDIA,
  META_ADS: env.WEBHOOK_SECRET_META_ADS,
  CRM: env.WEBHOOK_SECRET_CRM,
};

export function getSecretForSource(source: string): string | null {
  return SECRET_BY_SOURCE[source] ?? null;
}
