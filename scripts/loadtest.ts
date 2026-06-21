/**
 * OPS-04 (D-13/D-14): standalone autocannon blaster.
 * Fires multi-channel synthetic events with REAL per-source HMAC signatures through
 * the genuine /ingest validation path. Configurable via INGEST_BASE_URL,
 * LOAD_DURATION_S, LOAD_CONNECTIONS, LOAD_RPS.
 */
import { createHmac } from "node:crypto";
import autocannon from "autocannon";

const BASE_URL = process.env.INGEST_BASE_URL ?? "http://localhost:3001";
const DURATION = Number(process.env.LOAD_DURATION_S ?? "30");
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? "10");
const OVERALL_RATE = process.env.LOAD_RPS ? Number(process.env.LOAD_RPS) : undefined;

const SOURCES = [
	{ url: "shopee", secret: process.env.WEBHOOK_SECRET_SHOPEE ?? "dev-secret-shopee" },
	{ url: "tokopedia", secret: process.env.WEBHOOK_SECRET_TOKOPEDIA ?? "dev-secret-tokopedia" },
	{ url: "meta_ads", secret: process.env.WEBHOOK_SECRET_META_ADS ?? "dev-secret-meta" },
	{ url: "crm", secret: process.env.WEBHOOK_SECRET_CRM ?? "dev-secret-crm" },
] as const;

function makeRequest(src: (typeof SOURCES)[number]) {
	return {
		path: `/ingest/${src.url}`,
		method: "POST" as const,
		setupRequest: (req: autocannon.Request) => {
			const body = JSON.stringify({
				eventType: "order.created",
				externalId: `load-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				occurredAt: new Date().toISOString(),
				payload: { amount: Math.floor(Math.random() * 1000) },
			});
			const sig = createHmac("sha256", src.secret).update(body).digest("hex");
			req.body = body;
			req.headers = {
				"content-type": "application/json",
				"x-webhook-signature": sig,
			};
			return req;
		},
	};
}

console.log(
	`[loadtest] Blasting ${SOURCES.length} channels at ${BASE_URL} — ${DURATION}s, ${CONNECTIONS} connections${OVERALL_RATE ? `, ${OVERALL_RATE} req/s cap` : ""}`,
);

const result = await autocannon({
	url: BASE_URL,
	connections: CONNECTIONS,
	duration: DURATION,
	...(OVERALL_RATE ? { overallRate: OVERALL_RATE } : {}),
	requests: SOURCES.map(makeRequest),
});

autocannon.printResult(result);

const non2xx =
	(result["1xx"] ?? 0) +
	(result["3xx"] ?? 0) +
	(result["4xx"] ?? 0) +
	(result["5xx"] ?? 0);
if (non2xx > 0) {
	console.warn(
		`[loadtest] WARNING: ${non2xx} non-2xx responses — check HMAC signing / secrets`,
	);
}

process.exit(result.errors > 0 ? 1 : 0);
