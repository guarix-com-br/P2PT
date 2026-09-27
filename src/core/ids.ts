/**
 * Identifier generation helpers.
 *
 * Identifiers are plain strings so they can be produced in browsers and
 * Node alike without pulling in platform-specific APIs at import time.
 */

const HEX = "0123456789abcdef";

/**
 * Cryptographically-random hex id with a readable prefix, e.g.
 * `peer-1f3a…`. Uses `globalThis.crypto` when available and falls back to
 * `Math.random` only for non-security contexts (ids need uniqueness, not
 * secrecy — DTLS handles actual security).
 */
export function generateId(prefix: string, bytes = 12): string {
  const random = getRandomBytes(bytes);
  let hex = "";
  for (const byte of random) {
    hex += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  }
  return `${prefix}-${hex}`;
}

function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
