/**
 * `Peer` — public handle for a connected remote peer (Phase 1 skeleton).
 *
 * Applications obtain `Peer` objects from `P2PClient` (never construct them
 * directly). The class shape is stable from Phase 1; feature methods throw
 * `NotImplementedError` until their phase lands, so the API surface can be
 * tested and documented before the plumbing exists.
 */

import { NotImplementedError } from "../core/errors.js";
import type { Capability } from "../capability/types.js";
import type { ConnectionState } from "../transport/Transport.js";
import type { RoomId } from "../core/Room.js";
import type {
  MessagingApi,
  RpcApi,
  MessagePayload,
  JsonValue,
} from "../data/DataPlane.js";
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

export class Peer {
  readonly id: string;
  readonly roomId: RoomId | undefined;
  #metadata: PeerMetadata | undefined;
  #capabilities: readonly Capability[];
  #state: ConnectionState;
  #messaging: MessagingApi;
  #rpc: RpcApi;

  /** @internal — created only by `P2PClient`. */
  constructor(init: PeerInit) {
    this.id = init.id;
    this.roomId = init.roomId;
    this.#metadata = init.metadata;
    this.#capabilities = init.capabilities ?? [];
    this.#state = init.state ?? "new";
    this.#messaging = init.messaging;
    this.#rpc = init.rpc;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get metadata(): PeerMetadata | undefined {
    return this.#metadata;
  }

  get capabilities(): readonly Capability[] {
    return this.#capabilities;
  }

  /** True when the remote advertises `name` at or above `minVersion`. */
  supports(name: string, minVersion = 1): boolean {
    return this.#capabilities.some((c) => c.name === name && c.version >= minVersion);
  }

  /* ----------------------- delegated data plane ----------------------- */

  sendMessage(message: {
    type: string;
    payload: MessagePayload;
    metadata?: JsonValue;
  }): Promise<unknown> {
    return this.#messaging.sendMessage(message);
  }

  request(method: string, params?: JsonValue): Promise<JsonValue> {
    return this.#rpc.request(method, params);
  }

  /* --------------------------- not yet live --------------------------- */

  /** Implemented in Phase 8 (File Transfer). */
  sendFile(
    _source: unknown,
    _metadata?: Partial<TransferMetadata>,
  ): Promise<FileTransferHandle> {
    throw new NotImplementedError("Peer.sendFile()", 8);
  }

  /** Implemented in Phase 13 (Rooms and Presence). */
  getPresence(): Promise<PresenceRecord> {
    throw new NotImplementedError("Peer.getPresence()", 13);
  }

  /** Implemented in Phase 4 (WebRTC Transport). */
  disconnect(): Promise<void> {
    throw new NotImplementedError("Peer.disconnect()", 4);
  }

  /** @internal used by ConnectionManager as transports come online. */
  _updateState(state: ConnectionState): void {
    this.#state = state;
  }

  /** @internal */
  _updateCapabilities(capabilities: readonly Capability[]): void {
    this.#capabilities = capabilities;
  }
}
