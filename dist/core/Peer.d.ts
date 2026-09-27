/**
 * `Peer` — public handle for a connected remote peer (Phase 1 skeleton).
 *
 * Applications obtain `Peer` objects from `P2PClient` (never construct them
 * directly). The class shape is stable from Phase 1; feature methods throw
 * `NotImplementedError` until their phase lands, so the API surface can be
 * tested and documented before the plumbing exists.
 */
import type { Capability } from "../capability/types.js";
import type { ConnectionState } from "../transport/Transport.js";
import type { RoomId } from "../core/Room.js";
import type { MessagingApi, RpcApi, MessagePayload, JsonValue } from "../data/DataPlane.js";
import type { FileTransferHandle, TransferMetadata } from "../transfer/types.js";
import type { PresenceRecord } from "../presence/types.js";
/** Free-form metadata announced with discovery/presence records. */
export interface PeerMetadata extends Record<string, string | number | boolean> {
    name: string;
}
/** Internal wiring passed by `P2PClient` when a peer object is created. */
export interface PeerInit {
    id: string;
    roomId?: RoomId;
    metadata?: PeerMetadata;
    capabilities?: readonly Capability[];
    state?: ConnectionState;
    messaging: MessagingApi;
    rpc: RpcApi;
}
export declare class Peer {
    #private;
    readonly id: string;
    readonly roomId: RoomId | undefined;
    /** @internal — created only by `P2PClient`. */
    constructor(init: PeerInit);
    get state(): ConnectionState;
    get metadata(): PeerMetadata | undefined;
    get capabilities(): readonly Capability[];
    /** True when the remote advertises `name` at or above `minVersion`. */
    supports(name: string, minVersion?: number): boolean;
    sendMessage(message: {
        type: string;
        payload: MessagePayload;
        metadata?: JsonValue;
    }): Promise<unknown>;
    request(method: string, params?: JsonValue): Promise<JsonValue>;
    /** Implemented in Phase 8 (File Transfer). */
    sendFile(_source: unknown, _metadata?: Partial<TransferMetadata>): Promise<FileTransferHandle>;
    /** Implemented in Phase 13 (Rooms and Presence). */
    getPresence(): Promise<PresenceRecord>;
    /** Implemented in Phase 4 (WebRTC Transport). */
    disconnect(): Promise<void>;
    /** @internal used by ConnectionManager as transports come online. */
    _updateState(state: ConnectionState): void;
    /** @internal */
    _updateCapabilities(capabilities: readonly Capability[]): void;
}
//# sourceMappingURL=Peer.d.ts.map