/**
 * WebTorrentTrackerProvider — native WebSocket-tracker discovery provider
 * (Phase 2).
 *
 * Talks to WebTorrent-compatible trackers through the JSON-over-WebSocket
 * announce protocol implemented in `WebTorrentTrackerProtocol.ts`. The
 * tracker is used **for discovery only**: no signaling (`int`) messages, no
 * WebRTC, no DataChannels ever pass through this class.
 *
 * Responsibilities (per approved architecture):
 * - provider-specific lifecycle: start/stop/destroy, reconnect with
 *   exponential backoff + jitter, server-provided announce interval;
 * - topic registration against a shared `TrackerPool` (one socket per URL);
 * - conversion of tracker responses into normalized `DiscoveryEvent`s.
 */

import type { PeerMetadata } from "../../core/Peer.js";
import type { RoomId } from "../../core/Room.js";
import type { TimerProvider, WebSocketFactory } from "../../transport/Adapter.js";
import { DEFAULT_TIMERS, resolveWebSocketFactory } from "../../transport/Adapter.js";
import {
  encodeTrackerField,
  buildAnnounce,
  type TrackerAnnounceMessage,
  type TrackerResponse,
} from "./WebTorrentTrackerProtocol.js";
import { deriveAppTopic, deriveDiscoveryTopic, isValidNamespaceId } from "./infoHash.js";
import { TrackerPool } from "./TrackerPool.js";
import type {
  DiscoveredPeer,
  DiscoveryEvent,
  DiscoveryProvider,
  DiscoveryProviderEvents,
  DiscoveryProviderState,
  DiscoveryStartOptions,
} from "../DiscoveryProvider.js";

export interface TrackerHealth {
  url: string;
  state: DiscoveryProviderState;
  topics: number;
  peersSeen: number;
  errors: number;
  lastAnnounceAt?: number;
}

export interface WebTorrentTrackerProviderOptions {
  /** Tracker URL (ws:// or wss://). */
  url: string;
  /** Injected for Node environments without a global WebSocket / tests. */
  webSocketFactory?: WebSocketFactory;
  timers?: TimerProvider;
  /** Cap on peers requested per announce (default 50). */
  numwant?: number;
  /** Backoff policy inherited from client config. */
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectAttempts?: number;
  /** Deterministic jitter source (tests inject a constant). */
  random?: () => number;
  /** Shared pool; one per client so multiple providers reuse sockets. */
  pool?: TrackerPool;
}

interface TopicBinding {
  roomId?: RoomId;
  /** lowercase 40-hex namespace — pool routing identity */
  hex: string;
  /** exactly-20-byte latin-1 field carried in the announce body */
  infoHashField: string;
  message?: TrackerAnnounceMessage;
  unsub: () => void;
  unsubStatus: () => void;
}

export class WebTorrentTrackerProvider implements DiscoveryProvider {
  readonly id: string;
  readonly url: string;

  #state: DiscoveryProviderState = "idle";
  #pool: TrackerPool | null = null;
  #ownsPool: boolean;
  #options: DiscoveryStartOptions | null = null;
  readonly #topics = new Map<string, TopicBinding>(); // topicKey → binding
  readonly #listeners = new Set<(ev: DiscoveryEvent) => void>();
  #announceTimer: unknown = null;
  #reconnectTimer: unknown = null;
  #reconnectAttempt = 0;
  #lastReconnectDelayMs = 0;
  #stopped = true;
  #destroyed = false;
  #intervalSec = 180;
  #peersSeen = 0;
  #errors = 0;
  /** topic responses received during the current announce round */
  #answeredRound = 0;
  /** interval refresh pending → suppress duplicate schedules in the same round */
  #refreshScheduled = false;
  #lastAnnounceAt: number | undefined;

  #factory: WebSocketFactory | undefined;
  #timers: TimerProvider;
  #numwant: number;
  #baseDelayMs: number;
  #maxDelayMs: number;
  #maxAttempts: number;
  #random: () => number;

  constructor(options: WebTorrentTrackerProviderOptions) {
    if (!/^wss?:\/\//i.test(options.url)) {
      throw new Error(`tracker url must be ws:// or wss://: ${JSON.stringify(options.url)}`);
    }
    this.url = options.url;
    this.id = `tracker:${hashUrl(options.url)}`;
    this.#factory = resolveWebSocketFactory(options.webSocketFactory);
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#numwant = options.numwant ?? 50;
    this.#baseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.#maxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.#maxAttempts = options.reconnectAttempts ?? 5;
    this.#random = options.random ?? Math.random;
    this.#ownsPool = options.pool === undefined;
    if (options.pool) this.#pool = options.pool;
  }

  get state(): DiscoveryProviderState {
    return this.#state;
  }

  /** @internal diagnostics for tests: last scheduled reconnect delay (ms). */
  get lastReconnectDelayMs(): number {
    return this.#lastReconnectDelayMs;
  }

  health(): TrackerHealth {
    const h: TrackerHealth = {
      url: this.url,
      state: this.#state,
      topics: this.#topics.size,
      peersSeen: this.#peersSeen,
      errors: this.#errors,
    };
    if (this.#lastAnnounceAt !== undefined) h.lastAnnounceAt = this.#lastAnnounceAt;
    return h;
  }

  on(event: "event", handler: (payload: DiscoveryEvent) => void): () => void {
    if (event !== "event") return () => undefined;
    this.#listeners.add(handler as (ev: DiscoveryEvent) => void);
    return () => this.#listeners.delete(handler as (ev: DiscoveryEvent) => void);
  }

  async start(options: DiscoveryStartOptions): Promise<void> {
    if (this.#destroyed) throw new Error("provider destroyed");
    if (!isValidNamespaceId(options.appId)) throw new Error("invalid appId for tracker discovery");
    this.#options = options;
    this.#stopped = false;
    this.#pool ??= new TrackerPool(this.#requireFactory());
    // A shared pool may already hold a live socket for one of the topics we
    // are about to join (e.g. a sibling tracker provider on the same client).
    // Treat that as connected from the start — the physical connection is
    // real regardless of which provider opened it.
    const alreadyLive = (options.roomIds?.length ?? 0) > 0
      ? options.roomIds!.some((r) =>
          this.#pool!.peekTopic(this.url, deriveDiscoveryTopic(options.appId, r).hex) !== undefined,
        )
      : this.#pool.peekTopic(this.url, deriveAppTopic(options.appId).hex) !== undefined;
    this.#setState(alreadyLive ? "connected" : "connecting");
    for (const roomId of options.roomIds ?? []) {
      await this.joinRoom(roomId);
    }
    if ((options.roomIds?.length ?? 0) === 0) {
      // No rooms yet: announce app-wide presence so room-less peers can
      // still find each other.
      await this.#joinTopic(undefined);
    }
    // If the socket never opened synchronously, schedule a retry.
    if (this.#state === "connecting") this.#scheduleReconnect();
  }

  async stop(): Promise<void> {
    if (this.#stopped && this.#state === "idle") return;
    this.#stopped = true;
    this.#clearTimers();
    for (const key of [...this.#topics.keys()]) this.#leaveBinding(key);
    this.#setState("idle");
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    await this.stop();
    if (this.#ownsPool) this.#pool?.destroy();
    this.#pool = null;
    this.#listeners.clear();
  }

  async joinRoom(roomId?: RoomId): Promise<void> {
    if (this.#destroyed || !this.#options) throw new Error("provider not started");
    if (roomId !== undefined && !isValidNamespaceId(roomId)) {
      throw new Error(`invalid roomId: ${JSON.stringify(roomId.slice(0, 80))}`);
    }
    await this.#joinTopic(roomId);
  }

  async leaveRoom(roomId?: RoomId): Promise<void> {
    this.#leaveBinding(roomId ?? APP_SCOPE);
  }

  /** @internal topic bindings (used for pool scoping & diagnostics). */
  get activeTopics(): readonly { roomId?: RoomId; hex: string; infoHashField: string }[] {
    return [...this.#topics.values()].map((t) => ({
      roomId: t.roomId,
      hex: t.hex,
      infoHashField: t.infoHashField,
    }));
  }

  async announce(): Promise<void> {
    if (this.#destroyed || this.#topics.size === 0) return;
    const pool = this.#pool;
    if (!pool) return;
    // Re-acquire each live topic: if the pooled socket was closed since the
    // last announce (single-topic case above), acquire() transparently
    // reopens it and sends the announce; otherwise it just re-announces.
    for (const binding of this.#topics.values()) {
      if (!binding.message) continue;
      pool.acquire(this.url, binding.hex, binding.message);
    }
    this.#lastAnnounceAt = Date.now();
    // A tracker that answers announces at all keeps us "connected" — a
    // socket close after that is normal single-swarm protocol behavior, not
    // an outage. Only escalate to reconnect when NO topic got any answer
    // during this round (e.g. connect refused / silent-dead tracker).
    const answered = this.#answeredRound;
    this.#answeredRound = 0;
    if (answered > 0) {
      this.#reconnectAttempt = 0;
      this.#setState("connected");
      this.#clearReconnectTimer();
    } else if (this.#state !== "connected") {
      this.#scheduleReconnect();
    }
    this.#scheduleIntervalRefresh();
  }

  /* ------------------------------ internals ---------------------------- */

  #requireFactory(): WebSocketFactory {
    if (!this.#factory) {
      throw new Error(
        "no WebSocket implementation available — pass options.webSocketFactory (Node < 22) ",
      );
    }
    return this.#factory;
  }

  async #joinTopic(roomId?: RoomId): Promise<void> {
    const opts = this.#options!;
    const topic =
      roomId === undefined
        ? deriveAppTopic(opts.appId)
        : deriveDiscoveryTopic(opts.appId, roomId);
    const key = roomId ?? APP_SCOPE;
    const peerIdField = encodeTrackerField(trackerPeerId(opts.self.peerId));
    const message = buildAnnounce(topic.infoHashField, peerIdField, {
      numwant: this.#numwant,
    });
    const pool = (this.#pool ??= new TrackerPool(this.#requireFactory()));
    const existing = this.#topics.get(key);
    if (existing) {
      // Re-acquire refreshes the announce payload; binding stays intact.
      pool.acquire(this.url, existing.hex, existing.message ?? message);
      return;
    }
    const infoHashField = topic.infoHashField;
    const unsub = pool.onTopic(this.url, topic.hex, (ev) => {
      if (ev.kind === "malformed") {
        this.#handleMalformed(ev.error);
        return;
      }
      this.#handleResponse(roomId, ev.value);
    });
    // Register the topic BEFORE acquiring: acquire() opens the socket and
    // announces synchronously, so late listener registration would race
    // with fast (fake/immediate) trackers and drop the first response.
    this.#topics.set(key, {
      roomId,
      hex: topic.hex,
      infoHashField,
      message,
      unsub,
      unsubStatus: () => undefined,
    });
    const unsubStatus = pool.onStatus(this.url, topic.hex, (ev) =>
      this.#onSocketStatus(ev.connected, ev.error),
    );
    this.#topics.get(key)!.unsubStatus = unsubStatus;
    // If a sibling provider already holds this pooled connection, our fresh
    // `onTopic` subscription never saw the earlier announce response —
    // acquire() re-announces on the live socket so we still learn the
    // current swarm membership. For a brand-new connection, acquire() opens
    // the socket and announces immediately.
    pool.acquire(this.url, topic.hex, message);
    this.#lastAnnounceAt = Date.now();
    this.#scheduleIntervalRefresh();
    if (this.#answeredRound > 0 && this.#state === "connecting") {
      // Fast trackers can answer during acquire(), before the open-status
      // event fires — the response itself proves the connection is live.
      this.#setState("connected");
      this.#clearReconnectTimer();
    }
    if (this.#state === "disconnected" || this.#state === "failed") {
      this.#setState("connecting");
      this.#scheduleReconnect();
    }
  }

  #leaveBinding(key: string): void {
    const binding = this.#topics.get(key);
    if (!binding) return;
    binding.unsub();
    binding.unsubStatus();
    this.#topics.delete(key);
    this.#pool?.release(this.url, binding.hex);
  }

  #handleResponse(roomId: RoomId | undefined, response: TrackerResponse): void {
    this.#answeredRound += 1;
    if (response.kind === "failure") {
      this.#errors += 1;
      // A responding tracker is reachable — the swarm itself rejected us.
      // Surface a retryable error but do NOT enter the socket-reconnect
      // backoff loop; the interval refresh will re-announce anyway.
      this.#reconnectAttempt = 0;
      this.#setState("connected");
      this.#clearReconnectTimer();
      this.#emit({ type: "error", error: new Error(response.value.failureReason), retryable: true });
      return;
    }
    this.#reconnectAttempt = 0;
    this.#intervalSec = response.value.intervalSec;
    if (this.#state !== "connected") this.#setState("connected");
    const opts = this.#options!;
    const ownField = trackerPeerId(opts.self.peerId);
    for (const entry of response.value.peers) {
      // Never report ourselves: trackers echo our announce verbatim, and
      // other clients may also report us by our raw framework id.
      if (
        entry.peerId === opts.self.peerId ||
        entry.peerId === ownField ||
        fromTrackerPeerId(entry.peerId) === opts.self.peerId
      ) {
        continue;
      }
      const peer: DiscoveredPeer = {
        peerId: entry.peerId,
        appId: opts.appId,
      };
      if (roomId !== undefined) peer.roomId = roomId;
      // Derive a stable display name from the decoded tracker peer id so
      // cross-provider dedup compares meaningful metadata, not constants.
      const metadata: PeerMetadata = { name: entry.peerId.slice(0, 24) };
      peer.hints = { source: "tracker", url: this.url };
      if (entry.ip !== undefined || entry.port !== undefined) {
        peer.hints["address"] = `${entry.ip ?? "?"}:${entry.port ?? "?"}`;
      }
      peer.metadata = metadata;
      this.#peersSeen += 1;
      this.#emit({ type: "peer", peer });
    }
  }

  #handleMalformed(error: Error): void {
    // A malformed frame still proves the tracker is answering — count it as
    // an answered round so reconnect escalation only happens for silent or
    // refusing connections.
    this.#answeredRound += 1;
    this.#errors += 1;
    this.#emit({ type: "warning", message: `malformed tracker frame: ${error.message}` });
  }

  #onSocketStatus(connected: boolean, error?: Error): void {
    if (this.#stopped || this.#destroyed) return;
    if (connected) {
      this.#reconnectAttempt = 0;
      this.#setState("connected");
      this.#clearReconnectTimer();
      // Re-announce every live topic on the freshly opened socket.
      this.#pool?.announceAll(this.url);
      this.#scheduleIntervalRefresh();
    } else {
      if (error) this.#errors += 1;
      // With a single active topic the pool closes the physical socket as
      // soon as our announce completes (the tracker answers then ends the
      // swarm connection) — that is normal protocol behavior, NOT a
      // tracker outage. Only treat close as "disconnected" when other
      // topics still expect this socket to be alive; otherwise the next
      // acquire()/announce() transparently reopens it.
      if (this.#topics.size > 1 && this.#state !== "failed") {
        this.#setState("disconnected");
        this.#scheduleReconnect();
      }
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#destroyed || this.#reconnectTimer !== null) return;
    if (this.#reconnectAttempt >= this.#maxAttempts) {
      this.#setState("failed");
      this.#emit({
        type: "error",
        error: new Error(`tracker ${this.url}: giving up after ${this.#maxAttempts} attempts`),
        retryable: false,
      });
      return;
    }
    const exp = Math.min(
      this.#maxDelayMs,
      this.#baseDelayMs * 2 ** this.#reconnectAttempt,
    );
    // Full-jitter backoff: delay ∈ [0.5·exp, exp]. random()=1 → factor 1
    // (deterministic exponential for tests); random()=0 → half delay.
    const jitter = 0.5 + this.#random() * 0.5; // half-deterministic backoff
    this.#reconnectAttempt += 1;
    this.#lastReconnectDelayMs = Math.round(exp * jitter);
    this.#emit({ type: "retrying", attempt: this.#reconnectAttempt, delayMs: this.#lastReconnectDelayMs });
    this.#reconnectTimer = this.#timers.setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#stopped || this.#destroyed) return;
      // Don't escalate while the tracker keeps answering announces (even if
      // individual sockets come and go between rounds).
      if (this.#state === "connected") return;
      this.#setState("connecting");
      // ensureSocket inside acquire() transparently reopens a closed pool
      // socket; re-acquire every live topic.
      for (const binding of this.#topics.values()) {
        if (!binding.message) continue;
        this.#pool?.acquire(this.url, binding.hex, binding.message);
      }
      if (this.#topics.size === 0) {
        // Nothing left to announce — drop back to idle cleanly.
        this.#setState("idle");
      }
    }, this.#lastReconnectDelayMs);
  }

  #scheduleIntervalRefresh(): void {
    if (this.#announceTimer !== null || this.#stopped || this.#destroyed) return;
    // One refresh per announce round: responses arriving on several topics
    // (or socket reopen notifications) must not stack duplicate timers.
    if (this.#refreshScheduled) return;
    this.#refreshScheduled = true;
    const ms = this.#intervalSec * 1000;
    this.#announceTimer = this.#timers.setTimeout(() => {
      this.#announceTimer = null;
      this.#refreshScheduled = false;
      if (this.#stopped || this.#destroyed) return;
      void this.announce();
    }, ms);
  }

  #clearTimers(): void {
    if (this.#announceTimer !== null) {
      this.#timers.clearTimeout(this.#announceTimer);
      this.#announceTimer = null;
    }
    this.#refreshScheduled = false;
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #setState(next: DiscoveryProviderState): void {
    if (this.#state === next) return;
    const previous = this.#state;
    this.#state = next;
    this.#emit({ type: "state", state: next, previous });
  }

  #emit(ev: DiscoveryEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(ev);
      } catch {
        /* a throwing consumer must not break the provider */
      }
    }
  }
}

/** Sentinel key for the app-wide (room-less) topic binding. */
const APP_SCOPE = "__app__";

/**
 * Map a framework peer id onto the tracker's fixed 20-byte `peer_id` field.
 *
 * Framework ids look like `peer-<24 hex>` (29 chars); the entropy lives
 * entirely in the hex part, so we drop the constant `peer-` prefix and keep
 * `-<24 hex…>` truncated to exactly 20 chars (the leading `-` marks our
 * scheme; 19 hex chars ≈ 2^76 space — collision probability inside one room
 * is negligible for random ids). Peers using other id shapes are matched by
 * their decoded echo; Phase 3 signaling re-establishes exact identity over
 * the transport anyway.
 */
export function trackerPeerId(peerId: string): string {
  const stripped = peerId.startsWith("peer-") ? peerId.slice(5) : peerId;
  return `-${stripped}`.slice(0, 20);
}

/** Best-effort inverse of `trackerPeerId` for our own id scheme. */
export function fromTrackerPeerId(fieldPeerId: string): string {
  const body = fieldPeerId.startsWith("-") ? fieldPeerId.slice(1) : fieldPeerId;
  return `peer-${body}`;
}

/** The (url, topic-hex) pairs currently held by this provider instance. */
export function trackerTopicEntries(
  provider: WebTorrentTrackerProvider,
): { url: string; hexInfoHash: string }[] {
  return provider.activeTopics.map((t) => ({ url: provider.url, hexInfoHash: t.hex }));
}

/** Short stable non-cryptographic fingerprint used for provider ids. */
function hashUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
