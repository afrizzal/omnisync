import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getSecretForSource } from "../lib/secrets.js";

// OPS-04: the /demo "Live Load Test" button. POST /api/demo/start fires a burst
// of synthetic, properly-signed events through the REAL /ingest/:source path via
// app.inject — exercising the full HMAC + Zod + dedup + enqueue pipeline so the
// dashboard chart climbs in real time (no separate load-test process required).

const SOURCES = ["shopee", "tokopedia", "meta_ads", "crm"] as const;
const TOTAL_EVENTS = 240;
const INTERVAL_MS = 50; // ~20 events/sec → ~12s of visible chart climb

// Module-level guard so the button is idempotent: a second click while a burst
// is already running returns 202 without starting an overlapping burst.
let running = false;

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/demo/start", async (_request, reply) => {
    if (running) {
      return reply
        .code(202)
        .send({ status: "already-running", events: TOTAL_EVENTS });
    }
    running = true;
    app.log.info(
      { events: TOTAL_EVENTS, durationMs: TOTAL_EVENTS * INTERVAL_MS },
      "[demo] load test started — firing synthetic events through /ingest",
    );
    // Fire-and-forget: acknowledge immediately, stream events in the background.
    void runBurst(app);
    return reply.code(202).send({ status: "started", events: TOTAL_EVENTS });
  });
}

async function runBurst(app: FastifyInstance): Promise<void> {
  try {
    for (let i = 0; i < TOTAL_EVENTS; i++) {
      await fireOne(app, i);
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  } finally {
    running = false;
    app.log.info("[demo] load test burst complete");
  }
}

async function fireOne(app: FastifyInstance, index: number): Promise<void> {
  // Round-robin across the four channels so all sources show activity.
  const source = SOURCES[index % SOURCES.length] ?? SOURCES[0];
  const secret = getSecretForSource(source.toUpperCase());
  if (!secret) return; // unconfigured source — skip rather than 401-spam

  // The /ingest route injects `source` itself, so it is omitted from the body.
  const body = JSON.stringify({
    eventType: "order.created",
    externalId: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    occurredAt: new Date().toISOString(),
    payload: { amount: Math.floor(Math.random() * 1000) },
  });

  // CRITICAL: verifySignature requires the GitHub-style "sha256=" prefix.
  // Sign the EXACT body string that is sent as the payload so rawBody bytes match.
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  try {
    await app.inject({
      method: "POST",
      url: `/ingest/${source}`,
      payload: body,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
      },
    });
  } catch (err) {
    // One bad inject must never kill the burst loop.
    app.log.warn({ err, source }, "[demo] synthetic event inject failed");
  }
}
