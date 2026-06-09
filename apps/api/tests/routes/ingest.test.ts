import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

const SECRET = "test-secret-shopee"; // matches vitest.setup.ts WEBHOOK_SECRET_SHOPEE

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(Buffer.from(body)).digest("hex")}`;
}

const validBody = {
  eventType: "order.created",
  externalId: "ext-123",
  occurredAt: "2026-06-09T10:00:00.000Z",
  payload: { amount: 100 },
};

describe("POST /ingest/:source", () => {
  let mockQueue: { add: ReturnType<typeof vi.fn> };
  let mockRedis: { set: ReturnType<typeof vi.fn> };
  let app: FastifyInstance;

  beforeEach(async () => {
    mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    mockRedis = { set: vi.fn().mockResolvedValue("OK") };
    app = await buildApp({ queue: mockQueue as never, redis: mockRedis as never });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("SC-1 / ING-01 + ING-05: valid signature + valid payload", () => {
    it("returns 202 with status queued and calls queue.add exactly once with jobId", async () => {
      const bodyStr = JSON.stringify(validBody);

      const response = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sign(bodyStr),
        },
        payload: bodyStr,
      });

      expect(response.statusCode).toBe(202);
      const body = response.json<{ status: string; fingerprint: string }>();
      expect(body.status).toBe("queued");
      expect(typeof body.fingerprint).toBe("string");

      // ING-05: queue.add called exactly once with jobId = fingerprint
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, , options] = mockQueue.add.mock.calls[0] as [string, unknown, { jobId: string }];
      expect(options.jobId).toBe(body.fingerprint);
    });
  });

  describe("SC-2 / ING-02: tampered or missing signature", () => {
    it("returns 401 on tampered signature and does NOT enqueue", async () => {
      const bodyStr = JSON.stringify(validBody);

      const response = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
        payload: bodyStr,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("INVALID_SIGNATURE");
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it("returns 401 when x-webhook-signature header is missing", async () => {
      const bodyStr = JSON.stringify(validBody);

      const response = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
        },
        payload: bodyStr,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("INVALID_SIGNATURE");
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("SC-3 / ING-03: schema-invalid payload", () => {
    it("returns 422 with VALIDATION_ERROR and non-empty issues[] when eventType is missing", async () => {
      // Omit eventType so Zod validation fails
      const malformedBody = {
        externalId: "ext-123",
        occurredAt: "2026-06-09T10:00:00.000Z",
        payload: { amount: 100 },
      };
      const bodyStr = JSON.stringify(malformedBody);
      // Sign over the malformed body so it passes HMAC and reaches Zod
      const response = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sign(bodyStr),
        },
        payload: bodyStr,
      });

      expect(response.statusCode).toBe(422);
      const body = response.json<{ error: string; issues: Array<{ field: string; message: string }> }>();
      expect(body.error).toBe("VALIDATION_ERROR");
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBeGreaterThan(0);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("SC-4 / IDM-01: duplicate webhook deduplication", () => {
    it("returns 202 queued on first call and 202 duplicate on second identical call", async () => {
      // Configure redis mock: first call OK (new), second call null (already exists)
      mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
      const bodyStr = JSON.stringify(validBody);
      const sig = sign(bodyStr);

      // First request — should be queued
      const first = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sig,
        },
        payload: bodyStr,
      });

      expect(first.statusCode).toBe(202);
      const firstBody = first.json<{ status: string }>();
      expect(firstBody.status).toBe("queued");
      expect(mockQueue.add).toHaveBeenCalledTimes(1);

      // Second identical request — should be duplicate (no enqueue)
      const second = await app.inject({
        method: "POST",
        url: "/ingest/SHOPEE",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sig,
        },
        payload: bodyStr,
      });

      expect(second.statusCode).toBe(202);
      const secondBody = second.json<{ status: string }>();
      expect(secondBody.status).toBe("duplicate");
      // add was called only once (from the first request)
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe("Unknown source", () => {
    it("returns 401 for an unknown source", async () => {
      const bodyStr = JSON.stringify(validBody);

      const response = await app.inject({
        method: "POST",
        url: "/ingest/UNKNOWN",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sign(bodyStr),
        },
        payload: bodyStr,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ error: string }>();
      expect(body.error).toBe("INVALID_SIGNATURE");
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
