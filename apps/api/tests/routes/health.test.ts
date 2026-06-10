import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    const mockRedis = { set: vi.fn().mockResolvedValue("OK") };
    const app = await buildApp({
      queue: mockQueue as never,
      redis: mockRedis as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; uptime: number }>();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");

    await app.close();
  });
});
