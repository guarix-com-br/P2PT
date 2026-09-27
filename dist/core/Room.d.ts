/**
 * `Room` — generic room abstraction (spec §26, Phase 1 skeleton).
 *
 * A room is simply an id that participates in discovery plus the set of
 * peers currently joined. Rooms carry no application-specific meaning
 * (no servers/channels/UI concepts — spec §2).
 */
import type { Peer } from "./Peer.js";
/** Branded-ish alias keeps call sites self-documenting. */
export type RoomId = string;
/** Room metadata is an open key/value bag; alias kept for readability. */
export type RoomMetadata = Record<string, string | number | boolean>;
export interface RoomInit {
    id: RoomId;
    metadata?: RoomMetadata;
}
export declare class Room {
    readonly id: RoomId;
    readonly metadata: RoomMetadata;
    /** Live peer registry maintained by P2PClient as connections arrive. */
    readonly peers: Map<string, Peer>;
    /** @internal — created only by `P2PClient`. */
    constructor(init: RoomInit);
    get size(): number;
    getPeers(): readonly Peer[];
    getPeer(peerId: string): Peer | undefined;
    /** Broadcast a message to every peer in the room (Phase 5). */
    broadcast(_message: unknown): Promise<void>;
    /** Leave via the owning client; kept here for API ergonomics (Phase 13). */
    leave(): Promise<void>;
}
//# sourceMappingURL=Room.d.ts.map