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

export const DEFAULT_LIMITS: ResourceLimits = {
  maxMessageSize: 256 * 1024, // 256 KiB — well under SCTP practical limits
  maxFileSize: 4 * 1024 * 1024 * 1024, // 4 GiB
  maxChunkSize: 16 * 1024, // 16 KiB — safe for all browsers' DataChannels
  maxConcurrentTransfers: 4,
  maxPendingRequests: 64,
  maxPeers: 20, // honest mesh ceiling; see ARCHITECTURE.md scalability note
  maxMessagesPerSecond: 200,
};

const POSITIVE_INT_FIELDS: ReadonlyArray<keyof ResourceLimits> = [
  "maxMessageSize",
  "maxFileSize",
  "maxChunkSize",
  "maxConcurrentTransfers",
  "maxPendingRequests",
  "maxPeers",
  "maxMessagesPerSecond",
];

/** Validate a limits object; returns field-level issues (empty = valid). */
export function validateLimits(limits: ResourceLimits): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const key of POSITIVE_INT_FIELDS) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      issues.push({ path: `limits.${key}`, message: "must be a positive integer" });
    }
  }
  if (limits.maxChunkSize > limits.maxMessageSize) {
    issues.push({
      path: "limits.maxChunkSize",
      message: "must not exceed limits.maxMessageSize",
    });
  }
  return issues;
}

/** Contract implemented by Phase-16 RateLimiter (token bucket per peer). */
export interface RateLimiter {
  tryConsume(key: string, cost?: number): boolean;
  reset(key: string): void;
}
