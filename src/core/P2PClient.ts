/**
 * `P2PClient` — the single public entry point (Phase 1 skeleton).
 *
 * Owns configuration, identity, the typed event bus and one handle per
 * plane. Methods that require machinery from later phases throw a clear
 * `NotImplementedError`; everything that can work today (config resolution,
 * identity, event subscription) is fully functional.
 */

import { NotImplementedError } from "./errors.js";
import { generateId } from "./ids.js";
import {
  TypedEventEmitter,
  type P2PEvents,
  type DiscoveredPeerInfo,
} from "./events.js";
// Peer is only used as a type here; instances are created by the
// ConnectionManager (Phase 4). Room handles are real in Phase 2: joining a
// room today means joining its *discovery scope* (no connections yet —
// full room semantics arrive with Phases 4/13).
import type { Peer, PeerMetadata } from "./Peer.js";
import { Room, type RoomId, type RoomMetadata } from "./Room.js";
import {
  resolveConfig,
  type P2PConfigInput,
  type ResolvedP2PConfig,
} from "../config/Config.js";
import type { DataPlaneApi } from "../data/DataPlane.js";
import type { MediaPlaneApi } from "../media/MediaPlane.js";
import type { ControlPlaneApi } from "../control/ControlPlane.js";
import { DiscoveryManager } from "../discovery/DiscoveryManager.js";
import type { StatsManagerApi } from "../stats/StatsManager.js";
import type { PresenceStatus } from "../presence/types.js";

export interface ConnectOptions {
  roomId?: RoomId;
}

/** Extra construction seams for testing (injected timers/WebSocket). */
export interface P2PClientOptions extends P2PConfigInput {
  /** @internal inject a WebSocket factory (Node < 22 / tests). */
  webSocketFactory?: import("../transport/Adapter.js").WebSocketFactory;
  /** @internal inject timer provider (fake timers in tests). */
  timers?: import("../transport/Adapter.js").TimerProvider;
  /** @internal deterministic jitter source. */
  random?: () => number;
}

/**
 * Placeholder facade wiring until Phases 2–15 replace it with real
 * managers. Any method access yields a function that throws a clear
 * `NotImplementedError` naming the full call path and target phase.
 *
 * The proxy is uniformly recursive over *callable* nodes: every accessed
 * property is itself a callable proxy whose recorded path extends the
 * parent's. This makes arbitrary nesting work correctly —
 * `client.control.discovery.addProvider(...)`,
 * `client.data.rpc.request(...)`, even
 * `client.control.discovery.providers.tracker.start()` — because a node
 * never has to guess whether it is a leaf method or an intermediate
 * namespace: calling it throws with its own path, and further property
 * access simply records a deeper path.
 */
const PATH_SYMBOL = Symbol("notReadyPath");

/** Names of async API members (`getX`, `watchX`): they must reject rather
 *  than throw synchronously, because callers use them inside `await`. */
const ASYNC_NAME = /^(get|watch)/;

function notReady(path: string, phase: number): Record<string, unknown> {
  const makeNode = (nodePath: string): unknown => {
    // Dummy function object: proxies a callable so both `apply` (call) and
    // `get` (further navigation) are intercepted.
    const noop = (..._args: unknown[]): unknown => undefined;
    return new Proxy(noop, {
      apply(_target, _thisArg, _args) {
        if (ASYNC_NAME.test(nodePath.slice(nodePath.lastIndexOf(".") + 1))) {
          return Promise.reject(new NotImplementedError(`${nodePath}()`, phase));
        }
        throw new NotImplementedError(`${nodePath}()`, phase);
      },
      get(_target, prop) {
        if (prop === PATH_SYMBOL) return nodePath;
        // Keep standard inspection semantics sane: never expose internals,
        // never masquerade as a thenable, defer to real function props.
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (prop === "name" || prop === "length") {
          return prop === "name" ? nodePath.slice(nodePath.lastIndexOf(".") + 1) : 0;
        }
        return makeNode(`${nodePath}.${String(prop)}`);
      },
    });
  };
  return makeNode(path) as Record<string, unknown>;
}

export class P2PClient extends TypedEventEmitter<P2PEvents> {
  readonly config: ResolvedP2PConfig;
  /** Stable local identity for this client instance. */
  readonly id: string;
  readonly metadata: PeerMetadata;

  #closed = false;

  /** Phase 2: real discovery manager (control plane, discovery only). */
  readonly #discovery: DiscoveryManager;

  /** Control-plane facades (signaling/connections implemented Phases 3–4). */
  readonly control: ControlPlaneApi;
  /** Data-plane facade (implemented Phases 5–8). */
  readonly data: DataPlaneApi;
  /** Media-plane facade (implemented Phases 9–12). */
  readonly media: MediaPlaneApi;
  /** Diagnostics facade (implemented Phase 15). */
  readonly stats: StatsManagerApi;

  #rooms = new Map<RoomId, Room>();
  #peers = new Map<string, Peer>();

  constructor(input: P2PClientOptions) {
    super();
    const { webSocketFactory, timers, random, ...configInput } = input;
    void configInput; // consumed via resolveConfig below
    this.config = resolveConfig(configInput);
    this.id = this.config.peerId ?? generateId("peer");
    this.metadata = { name: this.config.peerName, ...this.config.metadata };

    /* --------------------- Phase 2: discovery wiring -------------------- */
    this.#discovery = new DiscoveryManager({
      appId: this.config.appId,
      self: { peerId: this.id, metadata: this.metadata },
      limits: this.config.limits,
      discovery: this.config.discovery,
      reconnectBaseDelayMs: this.config.reconnectBaseDelayMs,
      reconnectMaxDelayMs: this.config.reconnectMaxDelayMs,
      reconnectAttempts: this.config.reconnectAttempts,
      ...(timers !== undefined ? { timers } : {}),
      ...(webSocketFactory !== undefined ? { webSocketFactory } : {}),
      ...(random !== undefined ? { random } : {}),
    });

    if (this.config.autoDiscover) {
      for (const url of this.config.trackers) {
        this.#discovery.addTrackerProvider(url);
      }
    }

    // Manager → public event bus mapping (spec §34 names, unchanged).
    this.#discovery.on("discovered", (info) => {
      const payload: DiscoveredPeerInfo = {
        peerId: info.peerId,
        appId: info.appId,
        sources: info.sources,
      };
      if (info.roomId !== undefined) payload.roomId = info.roomId;
      if (info.metadata !== undefined) payload.metadata = info.metadata;
      this.emit("peer:discovered", payload);
    });
    this.#discovery.on("provider-event", (ev) => {
      this.emit("discovery:event", ev);
    });
    this.#discovery.on("tracker-status", (status) => {
      const url = status.url;
      const providerId = status.providerId;
      if (status.error) {
        this.emit("tracker:error", { providerId, url, error: status.error });
        return;
      }
      if (status.connected) {
        this.emit("tracker:connected", { providerId, url });
      } else {
        this.emit("tracker:disconnected", { providerId, url });
      }
    });

    // Real discovery facade; the rest of the control plane stays a proxy
    // until Phases 3/4 replace it piecewise.
    const notReadyControl = notReady("client.control", 3) as Record<string, unknown>;
    const discoveryFacade = this.#discovery as unknown as ControlPlaneApi["discovery"];
    this.control = new Proxy(notReadyControl, {
      get(target, prop) {
        if (prop === "discovery") return discoveryFacade;
        return Reflect.get(target, prop);
      },
    }) as unknown as ControlPlaneApi;

    this.data = notReady("client.data", 5) as unknown as DataPlaneApi;
    this.media = notReady("client.media", 9) as unknown as MediaPlaneApi;
    this.stats = notReady("client.stats", 15) as unknown as StatsManagerApi;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Join a room's DISCOVERY scope (Phase 2 semantics): derive the
   * deterministic namespace, announce through registered providers and
   * collect peers. Creates NO connections, NO WebRTC objects, NO media —
   * connecting to discovered peers arrives with Phase 4 (`connectTo`) and
   * full room fan-out with Phase 13.
   */
  async joinRoom(roomId: RoomId, metadata?: RoomMetadata): Promise<Room> {
    if (this.#closed) throw new Error("client is closed");
    let room = this.#rooms.get(roomId);
    if (!room) {
      room = new Room({ id: roomId, ...(metadata ? { metadata } : {}) });
      this.#rooms.set(roomId, room);
    }
    await this.#discovery.joinRoom(roomId);
    this.emit("room:joined", { roomId, peers: [] });
    return room;
  }

  /** Leave a room's discovery scope and release tracker references. */
  async leaveRoom(roomId: RoomId): Promise<void> {
    if (!this.#rooms.has(roomId)) return;
    await this.#discovery.leaveRoom(roomId);
    this.#rooms.delete(roomId);
    this.emit("room:left", { roomId });
  }

  getRoom(roomId: RoomId): Room | undefined {
    return this.#rooms.get(roomId);
  }

  /** Directly connect to a known peer id (bypasses discovery). */
  connectTo(_peerId: string, _options?: ConnectOptions): Promise<Peer> {
    throw new NotImplementedError("P2PClient.connectTo()", 4);
  }

  disconnectFrom(peerId: string): Promise<void> {
    const peer = this.#peers.get(peerId);
    if (!peer) return Promise.resolve();
    return peer.disconnect();
  }

  getPeer(peerId: string): Peer | undefined {
    return this.#peers.get(peerId);
  }

  getPeers(): readonly Peer[] {
    return [...this.#peers.values()];
  }

  /** Update local presence status broadcast (Phase 13). */
  setPresenceStatus(_status: PresenceStatus): Promise<void> {
    throw new NotImplementedError("P2PClient.setPresenceStatus()", 13);
  }

  /** Deterministic shutdown: closes transports, providers and listeners. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // Phase 2: full discovery teardown (providers stopped/destroyed,
    // pooled tracker sockets released). Transports arrive in Phase 4.
    await this.#discovery.destroy();
    // Real teardown cascades once planes exist; today: drop peers/rooms and
    // every listener so no callback survives a closed client.
    this.#peers.clear();
    this.#rooms.clear();
    this.removeAllListeners();
  }

  /* ----------------------------- internal ------------------------------ */

  /** @internal register a peer object created by ConnectionManager later. */
  _registerPeer(peer: Peer, roomId?: RoomId): void {
    this.#peers.set(peer.id, peer);
    if (roomId) this.#rooms.get(roomId)?.peers.set(peer.id, peer);
  }
}
