/**
 * Identifier generation helpers.
 *
 * Identifiers are plain strings so they can be produced in browsers and
 * Node alike without pulling in platform-specific APIs at import time.
 */
/**
 * Cryptographically-random hex id with a readable prefix, e.g.
 * `peer-1f3a…`. Uses `globalThis.crypto` when available and falls back to
 * `Math.random` only for non-security contexts (ids need uniqueness, not
 * secrecy — DTLS handles actual security).
 */
export declare function generateId(prefix: string, bytes?: number): string;
//# sourceMappingURL=ids.d.ts.map