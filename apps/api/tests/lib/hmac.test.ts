import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../../src/lib/hmac.js";

const SECRET = "test-webhook-secret";
const RAW_BODY = Buffer.from('{"event":"order.created","id":"abc"}');

function makeSignature(body: Buffer, secret: string): string {
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("verifySignature", () => {
  it("returns true for a valid sha256=<hex> signature", () => {
    const header = makeSignature(RAW_BODY, SECRET);
    expect(verifySignature(RAW_BODY, SECRET, header)).toBe(true);
  });

  it("returns false for a tampered signature (one char flipped)", () => {
    const header = makeSignature(RAW_BODY, SECRET);
    // Flip the first hex character: '0'→'f', 'f'→'0', else flip last char
    const hex = header.slice(7);
    const flipped = hex[0] === "f" ? `0${hex.slice(1)}` : `f${hex.slice(1)}`;
    const tamperedHeader = `sha256=${flipped}`;
    expect(verifySignature(RAW_BODY, SECRET, tamperedHeader)).toBe(false);
  });

  it("returns false when secret is wrong (correct hex but wrong key)", () => {
    const header = makeSignature(RAW_BODY, "wrong-secret");
    expect(verifySignature(RAW_BODY, SECRET, header)).toBe(false);
  });

  it("returns false when header has no sha256= prefix", () => {
    const hex = createHmac("sha256", SECRET).update(RAW_BODY).digest("hex");
    // Just the hex without the prefix
    expect(verifySignature(RAW_BODY, SECRET, hex)).toBe(false);
  });

  it("returns false and does NOT throw when signatureHeader is undefined", () => {
    expect(() => {
      const result = verifySignature(RAW_BODY, SECRET, undefined);
      expect(result).toBe(false);
    }).not.toThrow();
  });

  it("returns false and does NOT throw when signature hex is malformed (wrong length)", () => {
    // 'sha256=abcd' decodes to a 2-byte buffer, not 32 — triggers the length guard
    expect(() => {
      const result = verifySignature(RAW_BODY, SECRET, "sha256=abcd");
      expect(result).toBe(false);
    }).not.toThrow();
  });

  it("returns false and does NOT throw when signature hex is empty after prefix", () => {
    expect(() => {
      const result = verifySignature(RAW_BODY, SECRET, "sha256=");
      expect(result).toBe(false);
    }).not.toThrow();
  });
});
