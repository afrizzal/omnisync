import { expect, test } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3001";

// TST-04: DLQ dashboard re-queue flow against the live docker compose stack.
// Precondition: the CI job seeds >=1 dlq_events row (mock-crm fail mode + fired signed webhook).
// Exactly-once persistence is proven by TST-03 (IDM-02); this test proves the UI recovery path.
test("DLQ re-queue: click Re-queue Job, see success, entry leaves the queue", async ({
	page,
}) => {
	// 1. Load /dlq and wait for the seeded entry to render.
	await page.goto("/dlq");
	const firstRow = page.locator("table tbody tr").first();
	await expect(firstRow).toBeVisible({ timeout: 30_000 });

	// 2. Capture the fingerprint of the entry we re-queue (for the exactly-once-via-resolved check).
	const before = await page.request.get(`${API_URL}/api/dlq`);
	const beforeBody = (await before.json()) as {
		entries: Array<{ fingerprint: string }>;
	};
	expect(beforeBody.entries.length).toBeGreaterThanOrEqual(1);
	const fingerprint = beforeBody.entries[0].fingerprint;

	// 3. Click the first "Re-queue Job" button.
	await page.getByRole("button", { name: "Re-queue Job" }).first().click();

	// 4. Assert the success feedback appears.
	await expect(page.getByText("Re-queued successfully.")).toBeVisible({
		timeout: 15_000,
	});

	// 5. Assert the entry leaves the unresolved DLQ list (requeueDlqEntry set resolved=true).
	//    This proves the UI-triggered recovery completed end-to-end. Re-queue is idempotent by
	//    construction (jobId=fingerprint + ON CONFLICT DO NOTHING -> exactly one events row, per TST-03).
	await expect
		.poll(
			async () => {
				const res = await page.request.get(`${API_URL}/api/dlq`);
				const body = (await res.json()) as {
					entries: Array<{ fingerprint: string }>;
				};
				return body.entries.some((e) => e.fingerprint === fingerprint);
			},
			{ timeout: 20_000, intervals: [1000] },
		)
		.toBe(false);
});
