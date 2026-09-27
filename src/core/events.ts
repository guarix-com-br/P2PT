/**
 * Strongly-typed event system (spec §34).
 *
 * `TypedEventEmitter` is a small, allocation-light implementation with no
 * dependencies. Event names and payload shapes are fixed by the
 * `P2PEvents` map below so that `on`/`once`/`emit` are checked at compile
 * time. Only the public events from the spec are exposed; internal wiring
 * never travels on this bus.
 */

import type { ConnectionState } from "../transport/Transport.js";
import type { PeerMetadata } from "./Peer.js";
import type { RoomId } from "./Room.js";
import type { Message, RpcRequestInfo, RpcResponseInfo } from "../data/DataPlane.js";
import type {
  FileTransferProgress,
  TransferErrorInfo,
  TransferId,
  TransferMetadata,
} from "../transfer/types.js";
import type { Capability } from "../capability/types.js";
import type { PresenceRecord } from "../presence/types.js";
import type { DiscoveryEvent } from "../discovery/DiscoveryProvider.js";

/* ------------------------------------------------------------------ */
/* Event map                                                          */
/* ------------------------------------------------------------------ */

export interface TrackerConnectedEvent {
  providerId: string;
  url: string;
}
export interface TrackerDisconnectedEvent {
  providerId: string;
  url: string;
  reason?: string;
}
export interface TrackerErrorEvent {
  providerId: string;
  url: string;
  error: Error;
}

export interface PeerConnectingEvent {
  peerId: string;
  roomId?: RoomId;
}
export interface PeerConnectedEvent {
  peerId: string;
  roomId?: RoomId;
  metadata?: PeerMetadata;
  capabilities: Capability[];
}
export interface PeerDisconnectedEvent {
  peerId: string;
  roomId?: RoomId;
  reason?: string;
}
export interface PeerErrorEvent {
  peerId: string;
  error: Error;
}

export interface RoomJoinedEvent {
  roomId: RoomId;
  peers: string[];
}
export interface RoomLeftEvent {
  roomId: RoomId;
}

export interface ConnectionStateChangeEvent {
  peerId: string;
  state: ConnectionState;
  previous: ConnectionState;
}

export interface MediaStartedEvent {
  peerId: string;
  trackId: string;
  kind: "audio" | "video" | "screen";
}
export interface MediaStoppedEvent {
  peerId: string;
  trackId: string;
  kind: "audio" | "video" | "screen";
  reason?: string;
}

export interface FileStartedEvent {
  transferId: TransferId;
  peerId: string;
  metadata: TransferMetadata;
}
export interface FileProgressEvent extends FileTransferProgress {
  transferId: TransferId;
  peerId: string;
}
export interface FilePausedEvent {
  transferId: TransferId;
  peerId: string;
}
export interface FileResumedEvent {
  transferId: TransferId;
  peerId: string;
}
export interface FileCompletedEvent {
  transferId: TransferId;
  peerId: string;
  bytesTransferred: number;
  durationMs: number;
}
export interface FileErrorEvent {
  transferId: TransferId;
  peerId: string;
  error: TransferErrorInfo;
}

/**
 * The complete public event surface of the framework (spec §34).
 * Keys are event names, values are listener payload types.
 */
export interface P2PEvents {
  /* discovery / trackers */
  "tracker:connected": TrackerConnectedEvent;
  "tracker:disconnected": TrackerDisconnectedEvent;
  "tracker:error": TrackerErrorEvent;
  /** Spec §34 name: fired for every hit reported by a discovery provider. */
  "peer:discovered": DiscoveredPeerInfo;
  /** Lower-level provider stream (state changes, peer-gone, raw errors). */
  "discovery:event": DiscoveryEvent;

  /* peer lifecycle */
  "peer:connecting": PeerConnectingEvent;
  "peer:connected": PeerConnectedEvent;
  "peer:disconnected": PeerDisconnectedEvent;
  "peer:error": PeerErrorEvent;

  /* rooms */
  "room:joined": RoomJoinedEvent;
  "room:left": RoomLeftEvent;

  /* data plane */
  message: Message;
  "rpc:request": RpcRequestInfo;
  "rpc:response": RpcResponseInfo;

  /* file transfer */
  "file:started": FileStartedEvent;
  "file:progress": FileProgressEvent;
  "file:paused": FilePausedEvent;
  "file:resumed": FileResumedEvent;
  "file:completed": FileCompletedEvent;
  "file:error": FileErrorEvent;

  /* media plane */
  "audio:started": MediaStartedEvent;
  "audio:stopped": MediaStoppedEvent;
  "video:started": MediaStartedEvent;
  "video:stopped": MediaStoppedEvent;
  "screen:started": MediaStartedEvent;
  "screen:stopped": MediaStoppedEvent;

  /* control plane extras */
  "connection:statechange": ConnectionStateChangeEvent;
  "presence:update": PresenceRecord;

  /* client lifecycle */
  error: Error;
}

/** Minimal info carried by a discovery hit before a connection exists. */
export interface DiscoveredPeerInfo {
  peerId: string;
  roomId?: RoomId;
  appId: string;
  metadata?: PeerMetadata;
  /** Phase 2 (additive): providers that currently hold this logical peer. */
  sources?: readonly string[];
}

export type EventName = keyof P2PEvents;
export type EventPayload<K extends EventName> = P2PEvents[K];
export type Listener<K extends EventName> = (payload: EventPayload<K>) => void;

/* ------------------------------------------------------------------ */
/* Emitter implementation                                             */
/* ------------------------------------------------------------------ */

type AnyListener = (payload: unknown) => void;

interface ListenerEntry {
  fn: AnyListener;
  once: boolean;
  /** Original (unwrapped) listener so `off()` can match `once` registrations. */
  original: AnyListener;
}

/**
 * Typed emitter with deterministic listener order (insertion order),
 * safe re-entrant emission and full removal semantics.
 *
 * Design decisions:
 * - listeners are stored per event name in a `Map<string, Set>`;
 * - `off()` during emission takes effect for later dispatch steps only
 *   (snapshot iteration), matching DOM EventTarget behavior;
 * - an `"error"` listener is optional; unhandled `error` payloads are
 *   rethrown asynchronously so they surface in the host environment.
 */
export class TypedEventEmitter<Events extends object = P2PEvents> {
  private readonly listeners = new Map<keyof Events & string, Set<ListenerEntry>>();

  on<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    return this.add(event, listener, false);
  }

  once<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    return this.add(event, listener, true);
  }

  off<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    for (const entry of set) {
      if (entry.fn === listener || entry.original === listener) {
        set.delete(entry);
        break;
      }
    }
    if (set.size === 0) this.listeners.delete(event);
    return this;
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      if (event === ("error" as keyof Events & string)) {
        // Mirror Node semantics: unhandled 'error' must not be swallowed.
        throw payload instanceof Error ? payload : new Error(String(payload));
      }
      return false;
    }
    let called = false;
    // Snapshot so mutation during iteration is well-defined.
    for (const entry of [...set]) {
      if (entry.once) {
        const current = this.listeners.get(event);
        current?.delete(entry);
        if (current && current.size === 0) this.listeners.delete(event);
      }
      try {
        entry.fn(payload);
        called = true;
      } catch (err) {
        // A throwing listener must not break the remaining dispatch chain.
        queueMicrotask(() => {
          const errorKey = "error" as keyof Events & string;
          if (this.listeners.has(errorKey)) {
            this.emit(errorKey, err as Events[typeof errorKey]);
          } else {
            throw err;
          }
        });
        called = true;
      }
    }
    return called;
  }

  listenerCount<K extends keyof Events & string>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Remove all listeners for one event, or every listener when omitted. */
  removeAllListeners<K extends keyof Events & string>(event?: K): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  private add<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
    once: boolean,
  ): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = listener as unknown as AnyListener;
    set.add({ fn: wrapped, once, original: wrapped });
    return this;
  }
}
