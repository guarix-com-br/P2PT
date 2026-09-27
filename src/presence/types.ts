/**
 * Presence contracts (spec §27, Phase 1 interfaces only).
 *
 * Presence is lightweight state broadcast over the control channel with
 * change detection — unchanged state must never be re-broadcast.
 */

import type { PeerMetadata } from "../core/Peer.js";
import type { Capability } from "../capability/types.js";

export type PresenceStatus = "online" | "busy" | "away" | "offline";

export interface PresenceRecord {
  peerId: string;
  status: PresenceStatus;
  metadata?: PeerMetadata;
  capabilities?: Capability[];
  /** Monotonic timestamp (ms) used for last-writer-wins merging. */
  updatedAt: number;
}

export interface PresenceManagerEvents {
  update: PresenceRecord;
}

/** Public surface; concrete manager implemented in Phase 13. */
export interface PresenceManager {
  /** Current local presence record. */
  getLocal(): PresenceRecord;
  /** Update local presence; no-op when nothing changed (change detection). */
  setLocal(
    patch: Partial<Pick<PresenceRecord, "status" | "metadata" | "capabilities">>,
  ): Promise<void>;
  /** Last known presence of a remote peer, if any. */
  get(peerId: string): PresenceRecord | undefined;
  on<E extends keyof PresenceManagerEvents>(
    event: E,
    handler: (payload: PresenceManagerEvents[E]) => void,
  ): () => void;
}
