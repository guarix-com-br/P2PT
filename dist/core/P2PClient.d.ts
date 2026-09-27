/**
 * `P2PClient` — the single public entry point (Phase 1 skeleton).
 *
 * Owns configuration, identity, the typed event bus and one handle per
 * plane. Methods that require machinery from later phases throw a clear
 * `NotImplementedError`; everything that can work today (config resolution,
 * identity, event subscription) is fully functional.
 */
import { TypedEventEmitter, type P2PEvents } from "./events.js";
import type { Peer, PeerMetadata } from "./Peer.js";
import type { Room, RoomId, RoomMetadata } from "./Room.js";
import { type P2PConfigInput, type ResolvedP2PConfig } from "../config/Config.js";
import type { DataPlaneApi } from "../data/DataPlane.js";
import type { MediaPlaneApi } from "../media/MediaPlane.js";
import type { ControlPlaneApi } from "../control/ControlPlane.js";
import type { StatsManagerApi } from "../stats/StatsManager.js";
import type { PresenceStatus } from "../presence/types.js";
export interface ConnectOptions {
    roomId?: RoomId;
}
export declare class P2PClient extends TypedEventEmitter<P2PEvents> {
    #private;
    readonly config: ResolvedP2PConfig;
    /** Stable local identity for this client instance. */
    readonly id: string;
    readonly metadata: PeerMetadata;
    /** Control-plane facades (implemented Phases 2–4, 13). */
    readonly control: ControlPlaneApi;
    /** Data-plane facade (implemented Phases 5–8). */
    readonly data: DataPlaneApi;
    /** Media-plane facade (implemented Phases 9–12). */
    readonly media: MediaPlaneApi;
    /** Diagnostics facade (implemented Phase 15). */
    readonly stats: StatsManagerApi;
    constructor(input: P2PConfigInput);
    get closed(): boolean;
    /**
     * Join a room: announces membership through discovery and connects to
     * existing members. Implemented in Phase 13 on top of Phases 2–4.
     */
    joinRoom(_roomId: RoomId, _metadata?: RoomMetadata): Promise<Room>;
    leaveRoom(_roomId: RoomId): Promise<void>;
    getRoom(roomId: RoomId): Room | undefined;
    /** Directly connect to a known peer id (bypasses discovery). */
    connectTo(_peerId: string, _options?: ConnectOptions): Promise<Peer>;
    disconnectFrom(peerId: string): Promise<void>;
    getPeer(peerId: string): Peer | undefined;
    getPeers(): readonly Peer[];
    /** Update local presence status broadcast (Phase 13). */
    setPresenceStatus(_status: PresenceStatus): Promise<void>;
    /** Deterministic shutdown: closes transports, providers and listeners. */
    close(): Promise<void>;
    /** @internal register a peer object created by ConnectionManager later. */
    _registerPeer(peer: Peer, roomId?: RoomId): void;
}
//# sourceMappingURL=P2PClient.d.ts.map