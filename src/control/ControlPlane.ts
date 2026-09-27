/**
 * Control Plane contracts (spec §6–§10, Phase 1 interfaces only).
 *
 * The Control Plane owns everything required to *establish and maintain*
 * communication: discovery, signaling, connection lifecycle, capabilities
 * and presence. It must never carry chat messages or file payloads — those
 * belong to the Data Plane.
 */

import type { RoomId } from "../core/Room.js";
import type { PeerMetadata } from "../core/Peer.js";
import type { ConnectionState } from "../transport/Transport.js";
import type {
  DiscoveryProvider,
  DiscoveredPeer,
} from "../discovery/DiscoveryProvider.js";
import type { SignalingProvider } from "../signaling/SignalingProvider.js";
import type { Capability } from "../capability/types.js";

/* ----------------------------- Discovery ----------------------------- */

export interface DiscoveryManagerApi {
  /** Register a provider (tracker, WebSocket relay, custom). */
  addProvider(provider: DiscoveryProvider): void;
  removeProvider(id: string): Promise<void>;
  start(opts: { appId: string; roomIds?: readonly RoomId[] }): Promise<void>;
  stop(): Promise<void>;
  /** Latest snapshot of peers found across all providers. */
  getDiscovered(): readonly DiscoveredPeer[];
}

/* ----------------------------- Signaling ----------------------------- */

export interface SignalingManagerApi {
  addProvider(provider: SignalingProvider): void;
  removeProvider(id: string): Promise<void>;
  /** Negotiate a connection with a discovered peer. Implemented Phase 3/4. */
  negotiate(peerId: string, roomId?: RoomId): Promise<void>;
}

/* -------------------------- Connection mgmt --------------------------- */

/** Per-connection health view exposed to applications. */
export interface ConnectionInfo {
  peerId: string;
  roomId?: RoomId;
  state: ConnectionState;
  /** True while an ICE restart / reconnect backoff cycle is running. */
  recovering: boolean;
  capabilities: readonly Capability[];
  connectedAt?: number;
}

export interface ConnectionManagerEvents {
  stateChange: {
    peerId: string;
    state: ConnectionState;
    previous: ConnectionState;
  };
}

/**
 * PeerConnectionManager contract (spec §10). Owns transport creation,
 * negotiation triggers, reconnect/backoff policy and deterministic cleanup.
 * Concrete implementation arrives in Phase 4 (+ recovery in Phase 14).
 */
export interface ConnectionManagerApi {
  connect(
    peerId: string,
    opts?: { roomId?: RoomId; metadata?: PeerMetadata },
  ): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  getConnection(peerId: string): ConnectionInfo | undefined;
  listConnections(): readonly ConnectionInfo[];
  /** Request an ICE restart (Phase 14). */
  restartIce(peerId: string): Promise<void>;
  on<E extends keyof ConnectionManagerEvents>(
    event: E,
    handler: (payload: ConnectionManagerEvents[E]) => void,
  ): () => void;
}

/* ---------------------------- Control plane --------------------------- */

/**
 * Facade bundling the control-plane managers. `P2PClient` holds one of
 * these per instance; applications normally interact through `P2PClient`.
 */
export interface ControlPlaneApi {
  readonly discovery: DiscoveryManagerApi;
  readonly signaling: SignalingManagerApi;
  readonly connections: ConnectionManagerApi;
  /** Begin shutdown of every managed resource. */
  close(): Promise<void>;
}
