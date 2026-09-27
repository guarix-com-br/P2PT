/**
 * Discovery provider abstraction (spec §7, Phase 1 interfaces only).
 *
 * `DiscoveryManager` consumes any provider implementing this contract —
 * WebTorrent-compatible trackers (Phase 2), WebSocket servers, or custom
 * user-supplied providers. The framework never imports a concrete tracker
 * client from application code.
 */

import type { PeerMetadata } from "../core/Peer.js";
import type { RoomId } from "../core/Room.js";

export type DiscoveryProviderState =
  "idle" | "connecting" | "connected" | "disconnected" | "failed";

/** A peer announced by a discovery source before any connection exists. */
export interface DiscoveredPeer {
  peerId: string;
  appId: string;
  roomId?: RoomId;
  metadata?: PeerMetadata;
  /** Provider-specific hints (e.g. tracker announce interval). */
  hints?: Record<string, unknown>;
}

/**
 * Provider → manager event stream. Phase 2 extended this union
 * additively (`warning`, `retrying`) — every Phase-1 variant keeps its
 * exact shape, so Phase-1 providers remain source-compatible.
 */
export type DiscoveryEvent =
  | { type: "peer"; peer: DiscoveredPeer }
  | { type: "peer-gone"; peerId: string; roomId?: RoomId }
  | { type: "state"; state: DiscoveryProviderState; previous: DiscoveryProviderState }
  | { type: "error"; error: Error; retryable?: boolean }
  | { type: "warning"; message: string }
  | { type: "retrying"; attempt: number; delayMs: number };

export interface DiscoveryStartOptions {
  /** Application namespace — peers only discover peers in the same app. */
  appId: string;
  /** Restrict discovery to one or more rooms. */
  roomIds?: readonly RoomId[];
  /** Local identity announced to the source. */
  self: { peerId: string; metadata?: PeerMetadata };
}

/**
 * Optional scope commands a provider MAY implement to support
 * incremental room joins/leaves without a full restart. The manager
 * feature-detects these methods; providers without them are restarted
 * with the new room set instead (fully backward compatible).
 */
export interface DiscoveryScopeCommands {
  joinRoom?(roomId?: RoomId): Promise<void> | void;
  leaveRoom?(roomId?: RoomId): Promise<void> | void;
}

export interface DiscoveryProviderEvents {
  event: DiscoveryEvent;
}

export interface DiscoveryProvider extends Partial<DiscoveryScopeCommands> {
  /** Stable identifier for logs/events (`tracker:<url>`, `ws:<url>`, …). */
  readonly id: string;
  readonly state: DiscoveryProviderState;

  start(options: DiscoveryStartOptions): Promise<void>;
  stop(): Promise<void>;
  /** Periodic re-announce where the source requires it (trackers do). */
  announce?(): Promise<void>;
  /** Optional hard teardown after `stop()` (release pooled resources). */
  destroy?(): Promise<void>;
  on<E extends keyof DiscoveryProviderEvents>(
    event: E,
    handler: (payload: DiscoveryProviderEvents[E]) => void,
  ): () => void;
}
