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
import { TypedEventEmitter, type P2PEvents } from "./events.js";
// Peer/Room are only used as types here; instances are created by the
// ConnectionManager (Phase 4) and joinRoom() (Phase 13).
import type { Peer, PeerMetadata } from "./Peer.js";
import type { Room, RoomId, RoomMetadata } from "./Room.js";
import {
  resolveConfig,
  type P2PConfigInput,
  type ResolvedP2PConfig,
} from "../config/Config.js";
import type { DataPlaneApi } from "../data/DataPlane.js";
import type { MediaPlaneApi } from "../media/MediaPlane.js";
import type { ControlPlaneApi } from "../control/ControlPlane.js";
import type { StatsManagerApi } from "../stats/StatsManager.js";
import type { PresenceStatus } from "../presence/types.js";

export interface ConnectOptions {
  roomId?: RoomId;
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

  /** Control-plane facades (implemented Phases 2–4, 13). */
  readonly control: ControlPlaneApi;
  /** Data-plane facade (implemented Phases 5–8). */
  readonly data: DataPlaneApi;
  /** Media-plane facade (implemented Phases 9–12). */
  readonly media: MediaPlaneApi;
  /** Diagnostics facade (implemented Phase 15). */
  readonly stats: StatsManagerApi;

  #rooms = new Map<RoomId, Room>();
  #peers = new Map<string, Peer>();

  constructor(input: P2PConfigInput) {
    super();
    this.config = resolveConfig(input);
    this.id = this.config.peerId ?? generateId("peer");
    this.metadata = { name: this.config.peerName, ...this.config.metadata };

    this.control = notReady("client.control", 2) as unknown as ControlPlaneApi;
    this.data = notReady("client.data", 5) as unknown as DataPlaneApi;
    this.media = notReady("client.media", 9) as unknown as MediaPlaneApi;
    this.stats = notReady("client.stats", 15) as unknown as StatsManagerApi;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Join a room: announces membership through discovery and connects to
   * existing members. Implemented in Phase 13 on top of Phases 2–4.
   */
  joinRoom(_roomId: RoomId, _metadata?: RoomMetadata): Promise<Room> {
    throw new NotImplementedError("P2PClient.joinRoom()", 13);
  }

  leaveRoom(_roomId: RoomId): Promise<void> {
    throw new NotImplementedError("P2PClient.leaveRoom()", 13);
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
