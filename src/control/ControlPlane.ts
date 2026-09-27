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
import type { TimerProvider, WebSocketFactory } from "../transport/Adapter.js";
import type { ResourceLimits } from "../security/Limits.js";
import type {
  DiscoveryProvider,
  DiscoveryEvent,
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

/** Events emitted by `DiscoveryManager` on its own typed emitter. */
export interface DiscoveryManagerEvents extends Record<string, unknown> {
  /** A validated, deduplicated peer was seen for the first time (or after
   *  expiry) — mapped to the public `peer:discovered` event. */
  discovered: DiscoveredPeerInfoPayload;
  /** A previously-discovered entry expired (TTL) or was explicitly gone. */
  expired: DiscoveredPeerInfoPayload;
  /** Normalized provider stream (state changes, warnings, raw errors). */
  "provider-event": DiscoveryEvent & { providerId: string };
  /** Tracker-level connection state — mapped to public `tracker:*` events. */
  "tracker-status": {
    providerId: string;
    url: string;
    connected: boolean;
    error?: Error;
  };
}

/** Public payload shape for discovery hits (spec §34 `peer:discovered`). */
export interface DiscoveredPeerInfoPayload {
  peerId: string;
  appId: string;
  roomId?: RoomId;
  metadata?: PeerMetadata;
  /** Which providers currently hold this logical peer (source metadata). */
  sources: readonly string[];
}

/** Options accepted by the concrete `DiscoveryManager`. */
export interface DiscoveryManagerOptions {
  appId: string;
  self: { peerId: string; metadata?: PeerMetadata };
  limits: ResourceLimits;
  discovery: {
    minAnnounceIntervalSec: number;
    maxAnnounceIntervalSec: number;
    numwant: number;
    recentlyGoneCapacity: number;
  };
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectAttempts?: number;
  timers?: TimerProvider;
  /** Injected WebSocket factory used when auto-creating tracker providers. */
  webSocketFactory?: WebSocketFactory;
  /** Deterministic jitter source (tests inject a constant). */
  random?: () => number;
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
