/**
 * SHA-1 correctness (Phase 2): known vectors + cross-check against Node's
 * crypto across block-boundary lengths. SHA-1 here is a namespace/identity
 * mechanism only — never a security primitive.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha1, sha1Hex } from "../src/core/sha1.js";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

describe("sha1", () => {
  it('matches the empty-string vector', () => {
    expect(toHex(sha1(new TextEncoder().encode("")))).toBe(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it('matches the "abc" vector', () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("matches additional known SHA-1 vectors", () => {
    // Verified against Node's crypto: the canonical 56-char vector.
    expect(sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    );
    expect(sha1Hex("hello world")).toBe("2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
  });

  it("agrees with node:crypto at every interesting length", () => {
    const lengths = [0, 1, 2, 55, 56, 57, 63, 64, 65, 119, 120, 128, 200, 1000];
    for (const len of lengths) {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i++) input[i] = (i * 37 + 11) & 0xff;
      const expected = createHash("sha1").update(input).digest("hex");
      expect(toHex(sha1(input)), `length ${len}`).toBe(expected);
    }
  });

  it("handles multibyte UTF-8 input", () => {
    const s = "p2pfw:v1:app:raum-ü-🚀".repeat(7);
    expect(sha1Hex(s)).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
  });
});
