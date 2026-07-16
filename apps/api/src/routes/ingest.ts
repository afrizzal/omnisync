import { InboundEvent } from "@omnisync/types";
import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import type { AppDeps } from "../app.js";
import { buildFingerprint } from "../lib/fingerprint.js";
import { verifySignature } from "../lib/hmac.js";
import { getSecretForSource } from "../lib/secrets.js";

export async function ingestRoutes(
  app: FastifyInstance,
  { queue, redis }: AppDeps,
): Promise<void> {
  app.post("/ingest/:source", async (request, reply) => {
    const rawSource = (request.params as { source: string }).source;
    const source = rawSource.toUpperCase();

    // Step 1: HMAC verify (D-02/D-03) — unknown source OR bad signature → 401, never 500
    const secret = getSecretForSource(source);
    const signature = request.headers["x-webhook-signature"];
    const rawBody = request.rawBody;
    if (
      !secret ||
      !(rawBody instanceof Buffer) ||
      typeof signature !== "string" ||
      !verifySignature(rawBody, secret, signature)
    ) {
      return reply.code(401).send({
        error: "INVALID_SIGNATURE",
        message: "Signature verification failed",
      });
    }

    // Step 2: Zod validation (D-13) — inject normalized source so enum matches (Pitfall 6)
    const candidate = { ...(request.body as Record<string, unknown>), source };
    const parsed = InboundEvent.safeParse(candidate);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      const issues = Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
        (msgs ?? []).map((message) => ({ field, message })),
      );
      return reply.code(422).send({
        error: "VALIDATION_ERROR",
        message: "Invalid payload",
        issues,
      });
    }

    // Step 3: Fingerprint (D-15) — SHA-256 of source+eventType+externalId+occurredAt
    const { eventType, externalId, occurredAt } = parsed.data;
    const fingerprint = buildFingerprint(
      source,
      eventType,
      externalId,
      occurredAt,
    );

    // Step 4: Redis SET NX dedup gate (D-16 / IDM-01) — null means key existed → duplicate
    // ioredis overload order: key, value, "EX", seconds, "NX" (EX token before NX per ioredis types)
    const gate = await redis.set(`idem:${fingerprint}`, "1", "EX", 86400, "NX");
    if (gate === null) {
      return reply.code(202).send({ status: "duplicate", fingerprint });
    }

    // Step 5: Enqueue (D-14 / ING-05) — jobId = fingerprint (BullMQ dedup). No DB write on this path.
    // Gate-then-enqueue rollback (IDM-01): if queue.add rejects after the dedup gate is set,
    // release the idem key so the sender's retry is accepted instead of silently dropped as a "duplicate".
    try {
      await queue.add(
        "process-event",
        { source, payload: parsed.data, fingerprint },
        { jobId: fingerprint },
      );
    } catch (err) {
      // Best-effort rollback: release the dedup gate so the sender's retry is accepted,
      // not silently dropped as a "duplicate" while no job was ever enqueued.
      await redis.del(`idem:${fingerprint}`).catch(() => undefined);
      throw err; // centralized error handler returns 500 → sender retries
    }
    // OBS-01: structured log covering the "received" lifecycle step (D-07/D-08)
    // Uses the Fastify per-request pino child logger (request-enriched).
    request.log.info({ fingerprint, source, eventType }, "[ingest] received");
    return reply.code(202).send({ status: "queued", fingerprint });
  });
}
