import { expect, test } from "@playwright/test";

// TST-04: DLQ dashboard re-queue flow. Implemented in Plan 06-05 (Wave 2).
test.skip("DLQ re-queue flow lands exactly one event row", async ({ page }) => {
  await page.goto("/dlq");
  await expect(page).toHaveURL(/dlq/);
});
