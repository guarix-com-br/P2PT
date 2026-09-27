/**
 * `Room` — generic room abstraction (spec §26, Phase 1 skeleton).
 *
 * A room is simply an id that participates in discovery plus the set of
 * peers currently joined. Rooms carry no application-specific meaning
 * (no servers/channels/UI concepts — spec §2).
 */

import { NotImplementedError } from "../core/errors.js";
import type { Peer } from "./Peer.js";

/** Branded-ish alias keeps call sites self-documenting. */
export type RoomId = string;

/** Room metadata is an open key/value bag; alias kept for readability. */
export type RoomMetadata = Record<string, string | number | boolean>;

export interface RoomInit {
  id: RoomId;
  metadata?: RoomMetadata;
}

export class Room {
  readonly id: RoomId;
  readonly metadata: RoomMetadata;
  /** Live peer registry maintained by P2PClient as connections arrive. */
  readonly peers = new Map<string, Peer>();

  /** @internal — created only by `P2PClient`. */
  constructor(init: RoomInit) {
    this.id = init.id;
    this.metadata = init.metadata ?? {};
  }

  get size(): number {
    return this.peers.size;
  }

  getPeers(): readonly Peer[] {
    return [...this.peers.values()];
  }

  getPeer(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  /** Broadcast a message to every peer in the room (Phase 5). */
  broadcast(_message: unknown): Promise<void> {
    throw new NotImplementedError("Room.broadcast()", 5);
  }

  /** Leave via the owning client; kept here for API ergonomics (Phase 13). */
  leave(): Promise<void> {
    throw new NotImplementedError("Room.leave() — use P2PClient.leaveRoom()", 13);
  }
}
