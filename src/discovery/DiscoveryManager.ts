/**
 * DiscoveryManager — cross-provider discovery coordination (Phase 2).
 *
 * The manager is the ONLY place where discovery state becomes framework
 * state. Providers stay protocol-focused; everything that spans providers
 * lives here:
 *
 *  - provider registration & lifecycle (start/stop/remove, failure
 *    isolation: one broken provider never takes down the others);
 *  - room scope tracking (joinRoom/leaveRoom while running);
 *  - validation of every untrusted provider hit (`validate.ts`);
 *  - deduplication by logical identity `appId + roomId + peerId` — a peer
 *    seen through three providers is ONE logical peer with source metadata;
 *  - TTL expiry and rediscovery refresh;
 *  - rate limiting and max-discovered-peers enforcement;
 *  - normalized public events (`discovered`, `expired`,
 *    `provider-event`, `tracker-status`).
 *
 * It performs no signaling, opens no WebRTC objects and never touches
 * DataChannels — those belong to later phases and other planes.
 */

import { TypedEventEmitter } from "../core/events.js";
import type { RoomId } from "../core/Room.js";
import type { PeerMetadata } from "../core/Peer.js";
import type {
  DiscoveredPeerInfoPayload,
  DiscoveryManagerApi,
  DiscoveryManagerEvents,
  DiscoveryManagerOptions,
} from "../control/ControlPlane.js";
import type { TimerProvider, WebSocketFactory } from "../transport/Adapter.js";
import { DEFAULT_TIMERS } from "../transport/Adapter.js";
import type {
  DiscoveredPeer,
  DiscoveryEvent,
  DiscoveryProvider,
} from "./DiscoveryProvider.js";
import { validateDiscoveredPeer } from "./validate.js";
import { TrackerPool } from "./trackers/TrackerPool.js";
import {
  WebTorrentTrackerProvider,
  trackerPeerId,
} from "./trackers/WebTorrentTrackerProvider.js";
import { encodeTrackerField } from "./trackers/WebTorrentTrackerProtocol.js";

/** How often the TTL sweeper runs (ms). */
const SWEEP_INTERVAL_MS = 5_000;
/** Sliding-window rate limit granularity (ms). */
const RATE_WINDOW_MS = 1_000;

interface PeerEntry {
  key: string;
  peerId: string;
  appId: string;
  roomId?: RoomId;
  metadata?: PeerMetadata;
  /** provider id → most recent raw hints from that provider. */
  readonly sources: Map<string, Record<string, unknown> | undefined>;
  lastSeenAt: number;
  firstSeenAt: number;
}

export class DiscoveryManager
  extends TypedEventEmitter<DiscoveryManagerEvents>
  implements DiscoveryManagerApi
{
  readonly #options: DiscoveryManagerOptions;
  readonly #providers = new Map<string, DiscoveryProvider>();
  readonly #unsubs = new Map<string, () => void>();
  readonly #peers = new Map<string, PeerEntry>();
  /** Bounded FIFO of recently expired keys — suppresses gone-storms. */
  readonly #recentlyGone: string[] = [];
  readonly #timers: TimerProvider;
  readonly #random: () => number;
  #roomIds = new Set<RoomId>();
  #started = false;
  #stopped = false;
  #rateWindowStart = 0;
  #rateWindowCount = 0;
  #droppedDueToRate = 0;
  #sweepTimer: unknown = null;

  /** Shared tracker socket pool for auto-created providers (one per URL). */
  #pool: TrackerPool | null = null;

  constructor(options: DiscoveryManagerOptions) {
    super();
    this.#options = options;
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#random = options.random ?? Math.random;
  }

  get started(): boolean {
    return this.#started && !this.#stopped;
  }

  /** Provider ids currently registered (diagnostics/tests). */
  get providerIds(): readonly string[] {
    return [...this.#providers.keys()];
  }

  /** Rooms currently in discovery scope. */
  get rooms(): readonly RoomId[] {
    return [...this.#roomIds];
  }

  /* ------------------------- DiscoveryManagerApi ------------------------ */

  addProvider(provider: DiscoveryProvider): void {
    if (this.#stopped) throw new Error("discovery manager is stopped");
    if (this.#providers.has(provider.id)) {
      throw new Error(`duplicate discovery provider id: ${provider.id}`);
    }
    this.#providers.set(provider.id, provider);
    const unsub = provider.on("event", (ev) => this.#onProviderEvent(provider, ev));
    this.#unsubs.set(provider.id, unsub);
    // Late registration while running: start it with the current scope.
    if (this.#started) {
      void this.#safeStart(provider).catch(() => undefined);
    }
  }

  async removeProvider(id: string): Promise<void> {
    const provider = this.#providers.get(id);
    if (!provider) return;
    this.#providers.delete(id);
    this.#unsubs.get(id)?.();
    this.#unsubs.delete(id);
    try {
      await provider.stop();
    } catch {
      /* stop failures must not block removal */
    }
    try {
      await provider.destroy?.();
    } catch {
      /* ditto */
    }
    // Drop entries sourced exclusively by this provider.
    for (const [key, entry] of [...this.#peers]) {
      entry.sources.delete(id);
      if (entry.sources.size === 0) this.#removeEntry(key, entry, "provider-removed");
    }
  }

  async start(opts: { appId: string; roomIds?: readonly RoomId[] }): Promise<void> {
    if (opts.appId !== this.#options.appId) {
      throw new Error(
        `discovery appId mismatch: manager bound to ${JSON.stringify(this.#options.appId)}`,
      );
    }
    if (this.#started) {
      // Idempotent-ish restart: just reconcile the room scope.
      for (const roomId of opts.roomIds ?? []) await this.joinRoom(roomId);
      return;
    }
    this.#started = true;
    this.#stopped = false;
    for (const roomId of opts.roomIds ?? []) this.#roomIds.add(roomId);
    const starts = [...this.#providers.values()].map((p) =>
      this.#safeStart(p).catch(() => undefined),
    );
    await Promise.all(starts);
    this.#ensureSweeper();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#started = false;
    if (this.#sweepTimer !== null) {
      this.#timers.clearTimeout(this.#sweepTimer);
      this.#sweepTimer = null;
    }
    const stops = [...this.#providers.values()].map(async (p) => {
      try {
        await p.stop();
      } catch {
        /* provider stop errors are isolated */
      }
    });
    await Promise.all(stops);
    this.#peers.clear();
    this.#recentlyGone.length = 0;
  }

  getDiscovered(): readonly DiscoveredPeer[] {
    const now = this.#timers.now();
    const out: DiscoveredPeer[] = [];
    for (const entry of this.#peers.values()) {
      if (now - entry.lastSeenAt > this.#options.limits.peerTtlMs) continue;
      const peer: DiscoveredPeer = {
        peerId: entry.peerId,
        appId: entry.appId,
      };
      if (entry.roomId !== undefined) peer.roomId = entry.roomId;
      if (entry.metadata !== undefined) peer.metadata = entry.metadata;
      peer.hints = { sources: [...entry.sources.keys()] };
      out.push(peer);
    }
    return out;
  }

  /* --------------------------- room scoping ----------------------------- */

  /** Add a room to the discovery scope (announce + collect peers only). */
  async joinRoom(roomId: RoomId): Promise<void> {
    if (this.#stopped) throw new Error("discovery manager is stopped");
    if (!this.#started) {
      await this.start({ appId: this.#options.appId, roomIds: [roomId] });
      return;
    }
    if (this.#roomIds.has(roomId)) return;
    this.#roomIds.add(roomId);
    const failures: unknown[] = [];
    for (const provider of this.#providers.values()) {
      try {
        if (typeof provider.joinRoom === "function") {
          await provider.joinRoom(roomId);
        } else {
          // Fallback (backward compatible): restart with the widened scope.
          await provider.stop();
          await provider.start(this.#startOptions());
        }
      } catch (error) {
        failures.push(error); // isolated: other providers keep working
      }
    }
    if (failures.length > 0 && failures.length === this.#providers.size) {
      throw failures[0];
    }
  }

  /** Remove a room from scope; drop its discovered entries immediately. */
  async leaveRoom(roomId: RoomId): Promise<void> {
    if (!this.#roomIds.delete(roomId)) return;
    // Notify providers that implement incremental scope commands; providers
    // without them are restarted with the narrowed scope (backward compat).
    const failures: unknown[] = [];
    for (const provider of this.#providers.values()) {
      try {
        if (typeof provider.leaveRoom === "function") {
          await provider.leaveRoom(roomId);
        } else {
          await provider.stop();
          await provider.start(this.#startOptions());
        }
      } catch (error) {
        failures.push(error);
      }
    }
    // Drop every entry belonging to the left room right away — a peer
    // discovered in room A must never linger into room B's view.
    for (const [key, entry] of [...this.#peers]) {
      if (entry.roomId === roomId) this.#removeEntry(key, entry, "room-left");
    }
    if (failures.length > 0 && failures.length === this.#providers.size) {
      throw failures[0];
    }
  }

  /* ------------------------------ teardown ------------------------------ */

  #destroyed = false;

  /** Full shutdown: stop providers, destroy them, release pooled sockets. */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    await this.stop();
    for (const provider of this.#providers.values()) {
      try {
        await provider.destroy?.();
      } catch {
        /* best effort */
      }
    }
    this.#pool?.destroy();
    this.#pool = null;
    this.removeAllListeners();
  }

  /* ------------------------------- helpers ------------------------------ */

  /** Create + register a native WebTorrent tracker provider from config. */
  addTrackerProvider(url: string): WebTorrentTrackerProvider {
    if (!this.#pool) {
      const factory: WebSocketFactory | undefined =
        this.#options.webSocketFactory ?? defaultWebSocketFactory();
      if (!factory) {
        throw new Error(
          "no WebSocket implementation available — inject config webSocketFactory",
        );
      }
      this.#pool = new TrackerPool(factory);
    }
    const provider = new WebTorrentTrackerProvider({
      url,
      pool: this.#pool,
      timers: this.#timers,
      numwant: this.#options.discovery.numwant,
      reconnectBaseDelayMs: this.#options.reconnectBaseDelayMs,
      reconnectMaxDelayMs: this.#options.reconnectMaxDelayMs,
      reconnectAttempts: this.#options.reconnectAttempts,
      random: this.#random,
    });
    this.addProvider(provider);
    return provider;
  }

  #startOptions() {
    return {
      appId: this.#options.appId,
      self: this.#options.self,
      ...(this.#roomIds.size > 0 ? { roomIds: [...this.#roomIds] } : {}),
    };
  }

  #safeStart(provider: DiscoveryProvider): Promise<void> {
    try {
      return Promise.resolve(provider.start(this.#startOptions())).catch((error) => {
        this.#emitProviderEvent(provider.id, {
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          retryable: true,
        });
      });
    } catch (error) {
      this.#emitProviderEvent(provider.id, {
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
        retryable: true,
      });
      return Promise.resolve();
    }
  }

  #ensureSweeper(): void {
    if (this.#sweepTimer !== null) return;
    const tick = () => {
      this.#sweepTimer = null;
      if (this.#stopped) return;
      this.#sweep();
      this.#sweepTimer = this.#timers.setTimeout(tick, SWEEP_INTERVAL_MS);
    };
    this.#sweepTimer = this.#timers.setTimeout(tick, SWEEP_INTERVAL_MS);
  }

  #sweep(): void {
    const now = this.#timers.now();
    const ttl = this.#options.limits.peerTtlMs;
    for (const [key, entry] of [...this.#peers]) {
      if (now - entry.lastSeenAt > ttl) this.#removeEntry(key, entry, "ttl-expired");
    }
  }

  #onProviderEvent(provider: DiscoveryProvider, ev: DiscoveryEvent): void {
    switch (ev.type) {
      case "peer":
        this.#handlePeerHit(provider.id, ev.peer);
        break;
      case "peer-gone":
        this.#handlePeerGone(provider.id, ev.peerId, ev.roomId);
        break;
      case "state": {
        this.#emitProviderEvent(provider.id, ev);
        const url = trackerUrlOf(provider);
        if (url !== undefined) {
          const connected = ev.state === "connected";
          if (connected || ev.previous === "connected") {
            this.emit("tracker-status", { providerId: provider.id, url, connected });
          }
        }
        break;
      }
      case "error": {
        this.#emitProviderEvent(provider.id, ev);
        const url = trackerUrlOf(provider);
        if (url !== undefined) {
          this.emit("tracker-status", {
            providerId: provider.id,
            url,
            connected: provider.state === "connected",
            error: ev.error,
          });
        }
        break;
      }
      default:
        // warning / retrying and any future variants: pass through raw.
        this.#emitProviderEvent(provider.id, ev);
    }
  }

  #emitProviderEvent(providerId: string, ev: DiscoveryEvent): void {
    this.emit("provider-event", { ...ev, providerId });
  }

  #allowRate(): boolean {
    const now = this.#timers.now();
    if (now - this.#rateWindowStart >= RATE_WINDOW_MS) {
      this.#rateWindowStart = now;
      this.#rateWindowCount = 0;
    }
    this.#rateWindowCount += 1;
    if (this.#rateWindowCount > this.#options.limits.discoveryRatePerSecond) {
      this.#droppedDueToRate += 1;
      return false;
    }
    return true;
  }

  #dedupeKey(appId: string, roomId: RoomId | undefined, peerId: string): string {
    return `${appId}:${roomId ?? "-"}:${peerId}`;
  }

  #handlePeerHit(providerId: string, raw: unknown): void {
    const result = validateDiscoveredPeer(raw);
    if (!result.ok || result.value === undefined) {
      // Untrusted data: drop the hit, warn once per reason per window.
      this.#emitProviderEvent(providerId, {
        type: "warning",
        message: `rejected peer hit: ${result.reason}`,
      });
      return;
    }
    const peer = result.value;
    if (peer.peerId === this.#options.self.peerId) return; // ignore self echo
    if (peer.appId !== this.#options.appId) return; // foreign app namespace
    if (peer.roomId !== undefined && !this.#roomIds.has(peer.roomId)) {
      return; // hit outside our declared scope (also covers stale-room races)
    }

    const key = this.#dedupeKey(peer.appId, peer.roomId, peer.peerId);
    const existing = this.#peers.get(key);
    if (existing) {
      // Rediscovery: refresh TTL + merge source metadata. No re-fire of
      // `discovered` unless metadata actually changed (cheap debounce).
      existing.lastSeenAt = this.#timers.now();
      existing.sources.set(providerId, peer.hints);
      if (metadataChanged(existing.metadata, peer.metadata)) {
        existing.metadata = peer.metadata;
        this.#fire("discovered", existing);
      }
      return;
    }

    // New logical peer: enforce global discovered-peer ceiling.
    if (this.#peers.size >= this.#options.limits.maxDiscoveredPeers) {
      this.#emitProviderEvent(providerId, {
        type: "warning",
        message: `maxDiscoveredPeers (${this.#options.limits.maxDiscoveredPeers}) reached; hit dropped`,
      });
      return;
    }
    if (!this.#allowRate()) return; // flood control

    const entry: PeerEntry = {
      key,
      peerId: peer.peerId,
      appId: peer.appId,
      lastSeenAt: this.#timers.now(),
      firstSeenAt: this.#timers.now(),
      sources: new Map([[providerId, peer.hints]]),
    };
    if (peer.roomId !== undefined) entry.roomId = peer.roomId;
    if (peer.metadata !== undefined) entry.metadata = peer.metadata;
    this.#peers.set(key, entry);
    this.#forgetGone(key);
    this.#fire("discovered", entry);
  }

  #handlePeerGone(providerId: string, rawPeerId: unknown, roomId?: unknown): void {
    if (typeof rawPeerId !== "string") return;
    const room = typeof roomId === "string" ? roomId : undefined;
    const key = this.#dedupeKey(this.#options.appId, room, rawPeerId);
    const entry = this.#peers.get(key);
    if (!entry) return;
    entry.sources.delete(providerId);
    if (entry.sources.size === 0) this.#removeEntry(key, entry, "provider-gone");
  }

  #removeEntry(key: string, entry: PeerEntry, _reason: string): void {
    this.#peers.delete(key);
    this.#rememberGone(key);
    this.#fire("expired", entry);
  }

  #rememberGone(key: string): void {
    this.#recentlyGone.push(key);
    const cap = this.#options.discovery.recentlyGoneCapacity;
    while (this.#recentlyGone.length > cap) this.#recentlyGone.shift();
  }

  #forgetGone(key: string): void {
    const idx = this.#recentlyGone.indexOf(key);
    if (idx >= 0) this.#recentlyGone.splice(idx, 1);
  }

  #fire(event: "discovered" | "expired", entry: PeerEntry): void {
    const payload: DiscoveredPeerInfoPayload = {
      peerId: entry.peerId,
      appId: entry.appId,
      sources: [...entry.sources.keys()],
    };
    if (entry.roomId !== undefined) payload.roomId = entry.roomId;
    if (entry.metadata !== undefined) payload.metadata = entry.metadata;
    this.emit(event, payload);
  }

  /** Diagnostics: hits dropped by the rate limiter since construction. */
  get droppedDueToRate(): number {
    return this.#droppedDueToRate;
  }
}

function metadataChanged(
  a: PeerMetadata | undefined,
  b: PeerMetadata | undefined,
): boolean {
  if (a === undefined || b === undefined) return a !== b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return true;
  return ak.some((k) => a[k] !== b[k]);
}

/** Duck-type detection for tracker providers so `tracker:*` events carry
 *  their URL without importing concrete classes into the event layer. */
function trackerUrlOf(provider: DiscoveryProvider): string | undefined {
  const url = (provider as { url?: unknown }).url;
  return typeof url === "string" && /^wss?:\/\//i.test(url) ? url : undefined;
}

function defaultWebSocketFactory(): WebSocketFactory | undefined {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof candidate !== "function") return undefined;
  return (url: string) =>
    new (candidate as new (u: string) => ReturnType<WebSocketFactory>)(url);
}

/** Re-exported for P2PClient convenience: the tracker-visible peer id field
 *  derived from a framework id (kept next to its only non-test consumer). */
export { trackerPeerId, encodeTrackerField };
