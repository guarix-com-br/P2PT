/**
 * Security & resource-protection contracts (spec §32–§33, Phase 1).
 *
 * Every remote peer is treated as untrusted. The concrete enforcement
 * (frame validation, rate limiting) lands in Phase 16; the limits
 * themselves are configuration values validated here from day one so
 * applications can set them before any transport exists.
 */
import type { ConfigIssue } from "../core/errors.js";
/** Resource limits enforced framework-wide (spec §33). */
export interface ResourceLimits {
    /** Largest single protocol frame payload accepted, in bytes. */
    maxMessageSize: number;
    /** Largest file accepted for transfer, in bytes. */
    maxFileSize: number;
    /** Chunk size ceiling negotiated for file transfers, in bytes. */
    maxChunkSize: number;
    /** Simultaneous active file transfers allowed. */
    maxConcurrentTransfers: number;
    /** In-flight RPC requests awaiting responses. */
    maxPendingRequests: number;
    /** Concurrent connected peers allowed. */
    maxPeers: number;
    /** Per-peer inbound messages per second before throttling. */
    maxMessagesPerSecond: number;
}
export declare const DEFAULT_LIMITS: ResourceLimits;
/** Validate a limits object; returns field-level issues (empty = valid). */
export declare function validateLimits(limits: ResourceLimits): ConfigIssue[];
/** Contract implemented by Phase-16 RateLimiter (token bucket per peer). */
export interface RateLimiter {
    tryConsume(key: string, cost?: number): boolean;
    reset(key: string): void;
}
//# sourceMappingURL=Limits.d.ts.map