/**
 * Dependency-free SHA-1 (RFC 3174).
 *
 * ⚠️ This is a *namespace/identifier* utility only — it is used by
 * `deriveDiscoveryTopic()` to map `(appId, roomId)` pairs onto the opaque
 * 20-byte info-hash space that WebTorrent-compatible trackers require.
 * It MUST NOT be used as a security primitive anywhere in the framework
 * (authenticity/integrity is handled by DTLS/SCTP in the transport layer).
 *
 * Implemented with `Uint32Array` and explicit unsigned rotate-left so it
 * behaves identically in browsers and Node without polyfills or
 * `node:crypto`. Correctness is pinned by known-answer tests
 * (`tests/sha1.test.ts`) cross-checked against Node's `crypto` module.
 */

const w = new Uint32Array(80);

/** Explicit 32-bit left rotation (values are kept unsigned throughout). */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** SHA-1 digest of an arbitrary byte sequence → exactly 20 bytes. */
export function sha1(message: Uint8Array): Uint8Array {
  // Pre-processing: append 0x80, pad with zeros, then 64-bit big-endian bit
  // length. Total must be a multiple of 64 bytes and hold at least
  // message.length + 1 + 8 bytes.
  const bitLen = message.length * 8;
  const dataWithMarker = message.length + 9; // payload + 0x80 byte + 8-byte length
  const paddedLen = Math.ceil(dataWithMarker / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(message);
  buf[message.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl((w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!) >>> 0, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

/** Convenience hex wrapper over {@link sha1} for UTF-8 string input. */
export function sha1Hex(text: string): string {
  const bytes = sha1(new TextEncoder().encode(text));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
