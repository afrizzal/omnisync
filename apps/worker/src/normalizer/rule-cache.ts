import type { PrismaClient } from "@omnisync/db";
import type { RoutingRule } from "@omnisync/types";

interface RulesCacheState {
  rules: RoutingRule[];
  loadedAt: number;
}

// Module-level singleton (D-22 lazy TTL). Reset between tests via resetRulesCache (Pitfall 7).
let cache: RulesCacheState | null = null;

// Lazy reload: query DB ONLY when a job is being processed AND the TTL has expired.
// No background setInterval (D-22) — zero idle Redis/DB pressure (Upstash free-tier friendly).
export async function getActiveRules(
  prisma: PrismaClient,
  ttlMs: number,
): Promise<RoutingRule[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < ttlMs) {
    return cache.rules;
  }
  const rows = await prisma.routingRule.findMany({
    where: { enabled: true },
    orderBy: { priority: "desc" },
  });
  // Rows are DB-shaped; trust the DB `type`/`field` columns map to the Zod union for v1.
  const rules = rows as unknown as RoutingRule[];
  cache = { rules, loadedAt: now };
  return rules;
}

// Test/teardown helper — clears module-level cache so state never leaks between cases (Pitfall 7).
export function resetRulesCache(): void {
  cache = null;
}
