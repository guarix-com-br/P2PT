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

export type DiscoveryEvent =
  | { type: "peer"; peer: DiscoveredPeer }
  | { type: "peer-gone"; peerId: string; roomId?: RoomId }
  | { type: "state"; state: DiscoveryProviderState; previous: DiscoveryProviderState }
  | { type: "error"; error: Error };

export interface DiscoveryStartOptions {
  /** Application namespace — peers only discover peers in the same app. */
  appId: string;
  /** Restrict discovery to one or more rooms. */
  roomIds?: readonly RoomId[];
  /** Local identity announced to the source. */
  self: { peerId: string; metadata?: PeerMetadata };
}

export interface DiscoveryProviderEvents {
  event: DiscoveryEvent;
}

export interface DiscoveryProvider {
  /** Stable identifier for logs/events (`tracker:<url>`, `ws:<url>`, …). */
  readonly id: string;
  readonly state: DiscoveryProviderState;

  start(options: DiscoveryStartOptions): Promise<void>;
  stop(): Promise<void>;
  /** Periodic re-announce where the source requires it (trackers do). */
  announce?(): Promise<void>;
  on<E extends keyof DiscoveryProviderEvents>(
    event: E,
    handler: (payload: DiscoveryProviderEvents[E]) => void,
  ): () => void;
}
