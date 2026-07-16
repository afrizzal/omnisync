import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getSecretForSource } from "../lib/secrets.js";

// OPS-04: control plane for the /demo "Live Load Test".
//   POST /api/demo/start  — begin a continuous stream of synthetic events
//   POST /api/demo/stop   — halt the stream
//   GET  /api/demo/status — { running } so the UI can resync after a reload
//
// Events are fired through the REAL /ingest/:source path via app.inject, so the
// full HMAC + Zod + dedup + enqueue pipeline runs for every event and the
// dashboard reflects genuine end-to-end throughput (not a fake animation).

const SOURCES = ["shopee", "tokopedia", "meta_ads", "crm"] as const;
const BATCH = 3; // events fired per tick
const TICK_MS = 120; // → ~25 events/sec while running

let running = false; // desired state (toggled by start/stop)
let looping = false; // guards against spawning a second loop
let counter = 0; // round-robin index across sources

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/demo/start", async (_request, reply) => {
    if (!running) {
      running = true;
      app.log.info(
        { batch: BATCH, tickMs: TICK_MS },
        "[demo] load test started",
      );
      if (!looping) void runLoop(app);
    }
    return reply.code(202).send({ status: "started", running: true });
  });

  app.post("/api/demo/stop", async (_request, reply) => {
    if (running) {
      running = false;
      app.log.info("[demo] load test stop requested");
    }
    return reply.code(200).send({ status: "stopped", running: false });
  });

  app.get("/api/demo/status", async (_request, reply) => {
    return reply.send({ running });
  });
}

async function runLoop(app: FastifyInstance): Promise<void> {
  looping = true;
  try {
    while (running) {
      const batch: Array<Promise<void>> = [];
      for (let k = 0; k < BATCH; k++) batch.push(fireOne(app, counter++));
      await Promise.allSettled(batch);
      await new Promise((resolve) => setTimeout(resolve, TICK_MS));
    }
  } finally {
    looping = false;
    app.log.info("[demo] load loop stopped");
  }
}

async function fireOne(app: FastifyInstance, index: number): Promise<void> {
  // Round-robin across the four channels so every source shows activity.
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
  // Sign the EXACT body string that is sent so rawBody bytes match the signature.
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
    // One bad inject must never kill the loop.
    app.log.warn({ err, source }, "[demo] synthetic event inject failed");
  }
}
