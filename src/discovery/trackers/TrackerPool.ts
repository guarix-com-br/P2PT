/**
 * TrackerPool — shared physical tracker connections (Phase 2, internal).
 *
 * Validated against a real WebTorrent-compatible tracker: the swarm/topic is
 * bound to the **WebSocket URL path**, so the topic namespace travels as
 * `wss://host/<40-hex-info-hash>` (the JSON body also carries the binary
 * info_hash; the path is what trackers key swarms by).
 *
 * Physical connection key = normalized tracker URL + topic/infoHash:
 * - same tracker + same topic  → ONE shared socket, reference counted;
 * - same tracker + diff topic  → separate sockets (different paths);
 * - diff tracker + same topic  → separate sockets.
 *
 * Hard rules (approved architecture):
 * - Each connection record holds exactly ONE topic: its own announce
 *   lifecycle, listeners and peer results. A response arriving on a socket
 *   can only ever be delivered to that socket's topic — cross-room leakage
 *   is structurally impossible (no global FIFO routing).
 * - Reference counting: a socket closes only when its last holder releases
 *   it; leaving room A never disturbs room B.
 * - Infrastructure module: tracker concepts do NOT leak into the public API
 *   (only `WebTorrentTrackerProvider` consumes this pool).
 */

import type { WebSocketFactory, WebSocketLike } from "../../transport/Adapter.js";
import {
  encodeMessage,
  parseTrackerResponse,
  type TrackerAnnounceMessage,
  type TrackerResponse,
} from "./WebTorrentTrackerProtocol.js";

export type PoolTopicState = "pending" | "active" | "closed";

/** What a topic listener receives: a validated response, or a parse failure. */
export type PoolTopicEvent =
  | { kind: "response"; value: TrackerResponse }
  | { kind: "malformed"; error: Error };

export interface PoolConnectionStatus {
  /** Physical connection key (normalized url + "/" + hex info hash). */
  key: string;
  /** Full socket URL including the topic path segment. */
  socketUrl: string;
  connected: boolean;
  error?: Error;
}

/** How many buffered frames a topic may hold while it has no listener. */
const MAX_BUFFERED_TOPIC_EVENTS = 16;

/** One (url, info_hash) subscription — fully independent per room/topic. */
export interface PoolTopicRecord {
  readonly key: string;
  message: TrackerAnnounceMessage;
  readonly listeners: Set<(ev: PoolTopicEvent) => void>;
  state: PoolTopicState;
  refs: number;
  /**
   * Events that arrived before any listener was attached (e.g. an extremely
   * fast tracker answering synchronously during `acquire()`). Buffered with
   * a hard cap and replayed to the next listener — nothing is ever silently
   * dropped, and delivery stays strictly within this topic.
   */
  readonly buffer: PoolTopicEvent[];
}

interface ConnectionRecord {
  readonly key: string;
  readonly socketUrl: string;
  readonly topic: PoolTopicRecord;
  socket: WebSocketLike | null;
  connecting: boolean;
  closed: boolean;
  pendingSends: string[];
  readonly statusListeners: Set<(ev: PoolConnectionStatus) => void>;
}

/** Normalize a tracker base URL for stable keying (lowercase, strip trailing "/"). */
export function normalizeTrackerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Physical connection key: tracker URL + topic namespace (hex info hash). */
export function connectionKey(normalizedUrl: string, hexInfoHash: string): string {
  return `${normalizedUrl}/${hexInfoHash.toLowerCase()}`;
}

/** Socket URL: WebTorrent trackers bind the swarm to the URL path. */
export function topicSocketUrl(normalizedUrl: string, hexInfoHash: string): string {
  return `${normalizedUrl}/${hexInfoHash.toLowerCase()}`;
}

export class TrackerPool {
  private readonly connections = new Map<string, ConnectionRecord>();

  constructor(private readonly webSocketFactory: WebSocketFactory) {}

  /** Internal test/diagnostic hook: current physical connection keys. */
  get connectionKeys(): readonly string[] {
    return [...this.connections.keys()];
  }

  /** Number of live physical connections (test/diagnostics). */
  get size(): number {
    return this.connections.size;
  }

  /** Look up a topic record without creating anything. */
  peekTopic(url: string, hexInfoHash: string): PoolTopicRecord | undefined {
    const rec = this.connections.get(connectionKey(normalizeTrackerUrl(url), hexInfoHash));
    if (!rec || rec.closed) return undefined;
    return rec.topic;
  }

  /** Acquire a reference for (url, topic) and (re)announce immediately. Idempotent create. */
  acquire(url: string, hexInfoHash: string, message: TrackerAnnounceMessage): boolean {
    const conn = this.ensureConnection(normalizeTrackerUrl(url), hexInfoHash, message);
    if (!conn) return false;
    conn.topic.message = message;
    conn.topic.refs += 1;
    this.sendAnnounce(conn);
    return true;
  }

  /** Subscribe to responses for one topic; returns unsubscribe fn. */
  onTopic(
    url: string,
    hexInfoHash: string,
    handler: (ev: PoolTopicEvent) => void,
  ): () => void {
    const conn = this.connections.get(connectionKey(normalizeTrackerUrl(url), hexInfoHash));
    if (!conn) return () => undefined;
    conn.topic.listeners.add(handler);
    // Replay anything that arrived before this listener existed (bounded).
    if (conn.topic.buffer.length > 0) {
      const buffered = conn.topic.buffer.splice(0, conn.topic.buffer.length);
      for (const ev of buffered) this.deliverEvent(conn.topic, ev);
    }
    return () => conn.topic.listeners.delete(handler);
  }

  /**
   * Release one reference. When the last ref drops, the topic is closed and
   * its physical socket is torn down (tracker-side peers expire after their
   * own interval — the ws-tracker protocol has no explicit stop verb).
   */
  release(url: string, hexInfoHash: string): void {
    const key = connectionKey(normalizeTrackerUrl(url), hexInfoHash);
    const conn = this.connections.get(key);
    if (!conn) return;
    conn.topic.refs = Math.max(0, conn.topic.refs - 1);
    if (conn.topic.refs === 0) {
      conn.topic.state = "closed";
      conn.topic.listeners.clear();
      this.closeConnection(conn);
    }
  }

  /** Re-announce every active topic on a base URL (interval refresh). */
  announceAll(url: string): void {
    const norm = normalizeTrackerUrl(url);
    for (const conn of this.connections.values()) {
      if (conn.key.startsWith(`${norm}/`)) this.sendAnnounce(conn);
    }
  }

  /** Release every (url, topic) pair held by one provider instance. */
  releaseAll(entries: Iterable<{ url: string; hexInfoHash: string }>): void {
    for (const { url, hexInfoHash } of entries) this.release(url, hexInfoHash);
  }

  /** Listen for connect/disconnect notifications for one physical connection. */
  onStatus(
    url: string,
    hexInfoHash: string,
    handler: (ev: PoolConnectionStatus) => void,
  ): () => void {
    const conn = this.connections.get(connectionKey(normalizeTrackerUrl(url), hexInfoHash));
    if (!conn) return () => undefined;
    conn.statusListeners.add(handler);
    return () => conn.statusListeners.delete(handler);
  }

  /** Force-close everything (pool teardown). */
  destroy(): void {
    for (const conn of [...this.connections.values()]) {
      conn.topic.state = "closed";
      conn.topic.listeners.clear();
      this.closeConnection(conn);
    }
    this.connections.clear();
  }

  /* ------------------------------ internals ---------------------------- */

  private ensureConnection(
    normalizedUrl: string,
    hexInfoHash: string,
    message: TrackerAnnounceMessage,
  ): ConnectionRecord | undefined {
    const key = connectionKey(normalizedUrl, hexInfoHash);
    const existing = this.connections.get(key);
    if (existing && !existing.closed) return existing;

    const topic: PoolTopicRecord = {
      key,
      message,
      listeners: new Set(),
      state: "pending",
      refs: 0,
      buffer: [],
    };
    const conn: ConnectionRecord = {
      key,
      socketUrl: topicSocketUrl(normalizedUrl, hexInfoHash),
      topic,
      socket: null,
      connecting: false,
      closed: false,
      pendingSends: [],
      statusListeners: new Set(),
    };
    this.connections.set(key, conn);
    this.openSocket(conn);
    return conn;
  }

  private openSocket(conn: ConnectionRecord): void {
    if (conn.connecting || conn.socket) return;
    conn.connecting = true;
    let socket: WebSocketLike;
    try {
      socket = this.webSocketFactory(conn.socketUrl);
    } catch (error) {
      conn.connecting = false;
      this.closeConnection(conn);
      this.emitStatus(conn, {
        key: conn.key,
        socketUrl: conn.socketUrl,
        connected: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }
    conn.socket = socket;

    socket.addEventListener("open", () => {
      conn.connecting = false;
      const queued = conn.pendingSends;
      conn.pendingSends = [];
      for (const frame of queued) this.rawSend(conn, frame);
      this.emitStatus(conn, { key: conn.key, socketUrl: conn.socketUrl, connected: true });
    });

    socket.addEventListener("message", (event) => {
      // Untrusted input discipline: binary frames and malformed JSON are
      // reported to THIS topic only; they never crash the pool.
      if (typeof event.data !== "string") {
        this.dispatchMalformed(conn, new Error("non-text frame from tracker"));
        return;
      }
      let response: TrackerResponse;
      try {
        response = parseTrackerResponse(event.data);
      } catch (error) {
        this.dispatchMalformed(conn, error instanceof Error ? error : new Error(String(error)));
        return;
      }
      // Routing boundary = the connection itself (one topic per socket).
      // If the tracker echoed an info_hash belonging to ANOTHER topic, drop
      // the frame rather than misroute it.
      const echoed = response.value.infoHashField;
      if (echoed !== undefined) {
        const echoHex = latin1Hex(echoed);
        if (echoHex && !conn.key.endsWith(`/${echoHex}`)) return;
      }
      this.deliver(conn.topic, response);
      if (response.kind === "announce") conn.topic.state = "active";
    });

    socket.addEventListener("error", (event) => {
      this.emitStatus(conn, {
        key: conn.key,
        socketUrl: conn.socketUrl,
        connected: false,
        error: event instanceof Error ? event : new Error("websocket error"),
      });
    });

    socket.addEventListener("close", () => {
      conn.socket = null;
      conn.connecting = false;
      if (conn.topic.state === "active") conn.topic.state = "pending";
      this.emitStatus(conn, { key: conn.key, socketUrl: conn.socketUrl, connected: false });
    });
  }

  private closeConnection(conn: ConnectionRecord): void {
    if (conn.closed) return;
    conn.closed = true;
    this.connections.delete(conn.key);
    try {
      conn.socket?.close();
    } catch {
      /* socket already dead — nothing to clean */
    }
    conn.socket = null;
    conn.pendingSends = [];
  }

  private sendAnnounce(conn: ConnectionRecord): void {
    if (conn.closed) return;
    const frame = encodeMessage(conn.topic.message);
    if (conn.socket && conn.socket.readyState === 1) this.rawSend(conn, frame);
    else conn.pendingSends.push(frame);
  }

  private deliver(topic: PoolTopicRecord, response: TrackerResponse): void {
    const ev: PoolTopicEvent = { kind: "response", value: response };
    if (topic.listeners.size === 0) {
      // No listener yet (e.g. fast tracker answered during acquire(), before
      // the provider attached its handler). Buffer with a hard cap; replayed
      // to the next onTopic() subscriber. Never crosses topics.
      if (topic.buffer.length < MAX_BUFFERED_TOPIC_EVENTS) topic.buffer.push(ev);
      return;
    }
    for (const listener of [...topic.listeners]) {
      try {
        listener(ev);
      } catch {
        /* a throwing consumer must not break socket plumbing */
      }
    }
  }

  /** Deliver a pre-built event (replay path) to current listeners. */
  private deliverEvent(topic: PoolTopicRecord, ev: PoolTopicEvent): void {
    for (const listener of [...topic.listeners]) {
      try {
        listener(ev);
      } catch {
        /* ignore consumer faults */
      }
    }
  }

  private rawSend(conn: ConnectionRecord, frame: string): void {
    try {
      conn.socket?.send(frame);
    } catch {
      /* transient send failures surface via close/error handlers */
    }
  }

  private dispatchMalformed(conn: ConnectionRecord, error: Error): void {
    const ev: PoolTopicEvent = { kind: "malformed", error };
    if (conn.topic.listeners.size === 0) {
      if (conn.topic.buffer.length < MAX_BUFFERED_TOPIC_EVENTS) conn.topic.buffer.push(ev);
      return;
    }
    for (const listener of [...conn.topic.listeners]) {
      try {
        listener(ev);
      } catch {
        /* ignore consumer faults */
      }
    }
  }

  private emitStatus(conn: ConnectionRecord, ev: PoolConnectionStatus): void {
    for (const l of conn.statusListeners) {
      try {
        l(ev);
      } catch {
        /* listener errors must not break socket plumbing */
      }
    }
  }
}

/** Convert a latin-1 20-byte field to lowercase hex (undefined if wrong length). */
function latin1Hex(field: string): string | undefined {
  if (field.length !== 20) return undefined;
  let out = "";
  for (let i = 0; i < 20; i++) out += field.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
