/**
 * Phase 2 — WebTorrentTrackerProvider + TrackerPool behavior against an
 * in-process fake tracker (no network, no public trackers).
 */

import { describe, expect, it } from "vitest";
import type { DiscoveryEvent } from "../src/discovery/DiscoveryProvider.js";
import type { WebSocketLike } from "../src/transport/Adapter.js";
import {
  WebTorrentTrackerProvider,
  trackerPeerId,
  fromTrackerPeerId,
} from "../src/discovery/trackers/WebTorrentTrackerProvider.js";
import {
  TrackerPool,
  normalizeTrackerUrl,
  connectionKey,
} from "../src/discovery/trackers/TrackerPool.js";
import {
  buildAnnounce,
  encodeTrackerField,
  type TrackerAnnounceMessage,
} from "../src/discovery/trackers/WebTorrentTrackerProtocol.js";
import { deriveAppTopic, deriveDiscoveryTopic } from "../src/discovery/trackers/infoHash.js";

/* ----------------------------- fake tracker ------------------------------ */

interface FakeTrackerOptions {
  /** peers returned for a topic hex */
  peersByHex?: Map<string, Array<{ peerId: string; ip?: string; port?: number }>>;
  intervalSec?: number;
  failureReason?: string;
  /** reply with raw hostile text instead of a valid frame */
  rawReply?: string;
  /** close socket right after replying (normal single-topic tracker behavior) */
  closeAfterReply?: boolean;
  neverReply?: boolean;
  /** fail the connection outright */
  rejectConnect?: boolean;
}

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: TrackerAnnounceMessage[] = [];
  readonly listeners: Record<string, Set<(arg?: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };
  closed = false;
  /** set by the fake server: answer announces as they arrive */
  onSend?: (announce: TrackerAnnounceMessage) => void;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (arg?: unknown) => void): void {
    if (!this.listeners[type]) this.listeners[type] = new Set();
    this.listeners[type].add(listener);
  }
  removeEventListener(type: string, listener: (arg?: unknown) => void): void {
    this.listeners[type]?.delete(listener);
  }
  send(data: string): void {
    const announce = JSON.parse(data) as TrackerAnnounceMessage;
    this.sent.push(announce);
    // Reply synchronously at SEND time — never re-patch `send` from inside
    // an in-flight open-event dispatch (that would corrupt the pool's
    // pre-open queue flush and drop announces).
    this.onSend?.(announce);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    for (const l of [...(this.listeners["close"] ?? [])]) l({ code: 1000, reason: "" });
  }
  /* test controls */
  fireOpen(): void {
    this.readyState = 1;
    for (const l of [...(this.listeners["open"] ?? [])]) l();
  }
  fireMessage(text: string): void {
    for (const l of [...(this.listeners["message"] ?? [])]) l({ data: text });
  }
  fireClose(): void {
    this.close();
  }
}

class FakeTrackerServer {
  readonly sockets: FakeSocket[] = [];
  lastSocket?: FakeSocket;
  constructor(private readonly opts: FakeTrackerOptions = {}) {}

  factory = (url: string): FakeSocket => {
    const sock = new FakeSocket(url);
    this.sockets.push(sock);
    this.lastSocket = sock;
    if (this.opts.rejectConnect) {
      queueMicrotask(() => {
        for (const l of [...(sock.listeners["error"] ?? [])]) l(new Error("connect refused"));
        sock.fireClose();
      });
      return sock;
    }
    // Wire the auto-reply BEFORE returning the socket: every send (queued
    // or live) is answered the moment it happens.
    sock.onSend = (announce) => this.reply(sock, announce);
    queueMicrotask(() => sock.fireOpen());
    return sock;
  };

  private reply(sock: FakeSocket, announce: TrackerAnnounceMessage): void {
    if (this.opts.neverReply) return;
    if (this.opts.rawReply !== undefined) {
      sock.fireMessage(this.opts.rawReply);
      if (this.opts.closeAfterReply) sock.fireClose();
      return;
    }
    if (this.opts.failureReason !== undefined) {
      sock.fireMessage(JSON.stringify({ "failure reason": this.opts.failureReason }));
      if (this.opts.closeAfterReply) sock.fireClose();
      return;
    }
    const hex = latin1ToHex(announce.info_hash);
    const peers = this.opts.peersByHex?.get(hex) ?? [];
    sock.fireMessage(
      JSON.stringify({
        action: "announce",
        info_hash: announce.info_hash,
        interval: this.opts.intervalSec ?? 120,
        complete: peers.length + 1,
        peers: peers.map((p) => ({
          peerId: encodeTrackerField(p.peerId),
          ...(p.ip ? { ip: p.ip } : {}),
          ...(p.port ? { port: p.port } : {}),
        })),
      }),
    );
    if (this.opts.closeAfterReply) sock.fireClose();
  }
}

function latin1ToHex(field: string): string {
  let out = "";
  for (let i = 0; i < field.length; i++)
    out += field.charCodeAt(i)!.toString(16).padStart(2, "0");
  return out;
}

type ProviderCtor = ConstructorParameters<typeof WebTorrentTrackerProvider>[0];

function makeProvider(server: FakeTrackerServer, overrides: Partial<ProviderCtor> = {}) {
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextId = 1;
  const provider = new WebTorrentTrackerProvider({
    url: "ws://tracker.test:8080",
    webSocketFactory: server.factory,
    timers: {
      setTimeout: (fn, ms) => {
        const t = { fn, ms, id: nextId++ };
        timers.push(t);
        return t.id;
      },
      clearTimeout: (id) => {
        const idx = timers.findIndex((t) => t.id === id);
        if (idx >= 0) timers.splice(idx, 1);
      },
    },
    random: () => 1, // jitter factor = 1 → delay == exponential base
    ...overrides,
  });
  return { provider, timers };
}

async function tick(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const SELF = { peerId: "peer-0123456789abcdef0123456789ab" };

/* ------------------------------- lifecycle ------------------------------- */

describe("WebTorrentTrackerProvider lifecycle", () => {
  it("starts, connects and reports discovered peers on the room topic", async () => {
    const topic = deriveDiscoveryTopic("appA", "room1");
    const server = new FakeTrackerServer({
      peersByHex: new Map([[topic.hex, [{ peerId: "peer-alice" }, { peerId: "peer-bob" }]]]),
    });
    const { provider } = makeProvider(server);
    const events: DiscoveryEvent[] = [];
    provider.on("event", (ev) => events.push(ev));

    await provider.start({ appId: "appA", self: SELF, roomIds: ["room1"] });
    await tick(4);

    expect(provider.state).toBe("connected");
    // announce was actually sent with correct 20-byte fields
    expect(server.lastSocket!.sent[0]!.info_hash).toBe(topic.infoHashField);
    expect(server.lastSocket!.sent[0]!.peer_id.length).toBe(20);
    const peers = events
      .filter((e) => e.type === "peer")
      .map((e) => (e as { peer: { peerId: string } }).peer.peerId);
    expect(peers).toEqual(["peer-alice", "peer-bob"]);
    // every peer event carries the room scope + tracker hints
    for (const e of events) if (e.type === "peer") expect(e.peer.roomId).toBe("room1");

    await provider.stop();
    expect(provider.state).toBe("idle");
    // stop is idempotent
    await provider.stop();
    expect(provider.state).toBe("idle");
  });

  it("never emits self echoes (raw id, tracker field, or inverse-mapped id)", async () => {
    const topic = deriveDiscoveryTopic("appA", "room1");
    const ownField = trackerPeerId(SELF.peerId);
    const server = new FakeTrackerServer({
      peersByHex: new Map([
        [
          topic.hex,
          [
            { peerId: SELF.peerId },
            { peerId: ownField },
            { peerId: fromTrackerPeerId(ownField) },
            { peerId: "peer-real" },
          ],
        ],
      ]),
    });
    const { provider } = makeProvider(server);
    const peers: string[] = [];
    provider.on("event", (ev) => ev.type === "peer" && peers.push(ev.peer.peerId));
    await provider.start({ appId: "appA", self: SELF, roomIds: ["room1"] });
    await tick(4);
    expect(peers).toEqual(["peer-real"]);
  });

  it("announces app-wide topic when started without rooms", async () => {
    const appTopic = deriveAppTopic("appA");
    const server = new FakeTrackerServer({
      peersByHex: new Map([[appTopic.hex, [{ peerId: "peer-x" }]]]),
    });
    const { provider } = makeProvider(server);
    const peers: string[] = [];
    provider.on("event", (ev) => ev.type === "peer" && peers.push(ev.peer.peerId));
    await provider.start({ appId: "appA", self: SELF });
    await tick(4);
    expect(server.lastSocket!.url).toBe(`ws://tracker.test:8080/${appTopic.hex}`);
    expect(peers).toEqual(["peer-x"]);
  });

  it("restart works: stop then start re-announces", async () => {
    const topic = deriveDiscoveryTopic("appA", "room1");
    const server = new FakeTrackerServer({
      peersByHex: new Map([[topic.hex, [{ peerId: "peer-a" }]]]),
    });
    const { provider } = makeProvider(server);
    await provider.start({ appId: "appA", self: SELF, roomIds: ["room1"] });
    await tick(4);
    await provider.stop();
    const countBefore = server.sockets.length;
    await provider.start({ appId: "appA", self: SELF, roomIds: ["room1"] });
    await tick(4);
    expect(server.sockets.length).toBeGreaterThan(countBefore);
    expect(provider.state).toBe("connected");
  });

  it("destroy prevents any further use and kills pooled sockets", async () => {
    const server = new FakeTrackerServer();
    const { provider } = makeProvider(server);
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(4);
    await provider.destroy();
    expect(server.lastSocket!.closed).toBe(true);
    await expect(provider.start({ appId: "appA", self: SELF })).rejects.toThrow(/destroyed/);
    // destroy is idempotent
    await provider.destroy();
  });

  it("rejects non-ws urls at construction", () => {
    expect(() => new WebTorrentTrackerProvider({ url: "http://not-ws.test" })).toThrow(
      /ws:\/\/ or wss:\/\//,
    );
  });
});

/* ------------------------- reconnect / backoff --------------------------- */

describe("reconnect & backoff", () => {
  it("uses bounded exponential backoff with deterministic jitter, then fails terminally", async () => {
    const server = new FakeTrackerServer({ rejectConnect: true });
    const { provider, timers } = makeProvider(server, {
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 400,
      reconnectAttempts: 3,
    });
    const retrying: Array<{ attempt: number; delayMs: number }> = [];
    provider.on("event", (ev) =>
      ev.type === "retrying" ? retrying.push({ attempt: ev.attempt, delayMs: ev.delayMs }) : undefined,
    );
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);

    // random()=1 → jitter factor 1.0 → delays exactly exponential, capped
    expect(retrying.map((r) => r.delayMs)).toEqual([100, 200, 400]);
    expect(retrying.map((r) => r.attempt)).toEqual([1, 2, 3]);

    // run the three scheduled retries; the fourth scheduling gives up
    for (let i = 0; i < 3; i++) {
      const t = timers.shift();
      expect(t).toBeDefined();
      t!.fn();
      await tick(6);
    }
    expect(provider.state).toBe("failed");
    expect(timers.length).toBe(0); // no more reconnect timers scheduled
  });

  it("does not reconnect after stop()", async () => {
    const server = new FakeTrackerServer({ rejectConnect: true });
    const { provider, timers } = makeProvider(server, { reconnectAttempts: 5 });
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);
    expect(timers.length).toBeGreaterThan(0);
    await provider.stop();
    expect(timers.length).toBe(0); // reconnect + interval timers cleared
    const before = server.sockets.length;
    await tick(4);
    expect(server.sockets.length).toBe(before); // nothing resurrected
  });

  it("resets the backoff counter after a successful response", async () => {
    const topicR = deriveDiscoveryTopic("appA", "r");
    const topicR2 = deriveDiscoveryTopic("appA", "r2");
    const server = new FakeTrackerServer({
      peersByHex: new Map([
        [topicR.hex, []],
        [topicR2.hex, []],
      ]),
    });
    const { provider } = makeProvider(server, { reconnectBaseDelayMs: 100 });
    const retrying: number[] = [];
    provider.on("event", (ev) => ev.type === "retrying" && retrying.push(ev.delayMs));
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);
    expect(provider.state).toBe("connected");
    // second topic keeps the shared socket meaningful; then drop it
    await provider.joinRoom("r2");
    await tick(6);
    server.lastSocket!.fireClose();
    await tick(2);
    expect(provider.state).toBe("disconnected");
    expect(retrying[0]).toBe(100); // first attempt again, not escalated
  });
});

/* ----------------------- malformed/hostile frames ------------------------ */

describe("hostile tracker input", () => {
  it("survives invalid JSON with a warning event, never throws", async () => {
    const server = new FakeTrackerServer({ rawReply: "{not json", closeAfterReply: true });
    const { provider } = makeProvider(server);
    const warnings: string[] = [];
    provider.on("event", (ev) => ev.type === "warning" && warnings.push(ev.message));
    await expect(
      provider.start({ appId: "appA", self: SELF, roomIds: ["r"] }),
    ).resolves.toBeUndefined();
    await tick(6);
    expect(warnings.some((w) => /malformed/.test(w))).toBe(true);
    expect(provider.health().errors).toBeGreaterThan(0);
  });

  it("survives binary-ish garbage and non-object frames", async () => {
    for (const frame of ["", "[]", "null", '"str"', "\u0000\u0001binary"]) {
      const server = new FakeTrackerServer({ rawReply: frame, closeAfterReply: true });
      const { provider } = makeProvider(server);
      await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
      await tick(6); // must not throw/reject the process
      await provider.stop();
    }
  });

  it("converts tracker failure responses into retryable error events", async () => {
    const server = new FakeTrackerServer({
      failureReason: "you shall not pass",
      closeAfterReply: true,
    });
    const { provider } = makeProvider(server);
    const errors: Array<{ msg: string; retryable?: boolean }> = [];
    provider.on("event", (ev) =>
      ev.type === "error" ? errors.push({ msg: ev.error.message, retryable: ev.retryable }) : undefined,
    );
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);
    expect(errors[0]!.msg).toBe("you shall not pass");
    expect(errors[0]!.retryable).toBe(true);
    expect(provider.health().errors).toBeGreaterThan(0);
  });
});

/* --------------------- server-provided announce interval ----------------- */

describe("server-provided interval", () => {
  it("re-announces using the tracker's interval, not our default", async () => {
    const topic = deriveDiscoveryTopic("appA", "r");
    const server = new FakeTrackerServer({
      intervalSec: 45,
      peersByHex: new Map([[topic.hex, []]]),
    });
    const { provider, timers } = makeProvider(server);
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);
    const intervalTimer = timers.find((t) => t.ms === 45_000);
    expect(intervalTimer).toBeDefined();
    // firing it must produce a fresh announce on a reopened socket
    const before = server.sockets.length;
    intervalTimer!.fn();
    await tick(6);
    expect(server.sockets.length).toBeGreaterThan(before);
    const latest = server.sockets[server.sockets.length - 1]!;
    expect(latest.sent.length).toBeGreaterThan(0);
    expect(latin1ToHex(latest.sent[0]!.info_hash)).toBe(topic.hex);
  });

  it("floors hostile zero intervals to the protocol minimum", async () => {
    const topic = deriveDiscoveryTopic("appA", "r");
    const server = new FakeTrackerServer({
      intervalSec: 1, // below MIN_TRACKER_INTERVAL_SEC
      peersByHex: new Map([[topic.hex, []]]),
    });
    const { provider, timers } = makeProvider(server);
    await provider.start({ appId: "appA", self: SELF, roomIds: ["r"] });
    await tick(6);
    expect(timers.some((t) => t.ms === 30_000)).toBe(true);
  });
});

/* ---------------------------- TrackerPool -------------------------------- */

describe("TrackerPool", () => {
  const msg = (hex: string): TrackerAnnounceMessage =>
    buildAnnounce(deriveDiscoveryTopic("a", hex).infoHashField, encodeTrackerField("peer-me"));

  it("same tracker + same topic shares ONE physical socket with refcounting", () => {
    const server = new FakeTrackerServer();
    const pool = new TrackerPool(server.factory);
    const topic = deriveDiscoveryTopic("app", "room");
    pool.acquire("ws://T/", topic.hex, msg(topic.hex));
    pool.acquire("ws://T", topic.hex, msg(topic.hex));
    expect(pool.size).toBe(1);
    pool.release("ws://T", topic.hex);
    expect(pool.size).toBe(1); // still one live reference
    pool.release("ws://T", topic.hex);
    expect(pool.size).toBe(0); // final release closes
    expect(server.sockets[0]!.closed).toBe(true);
  });

  it("different topics on the same tracker get separate sockets and stay isolated", async () => {
    const topicA = deriveDiscoveryTopic("app", "A");
    const topicB = deriveDiscoveryTopic("app", "B");
    const server = new FakeTrackerServer({
      peersByHex: new Map([
        [topicA.hex, [{ peerId: "peer-in-A" }]],
        [topicB.hex, [{ peerId: "peer-in-B" }]],
      ]),
    });
    const pool = new TrackerPool(server.factory);
    const seenA: string[] = [];
    const seenB: string[] = [];
    pool.acquire("ws://T", topicA.hex, msg(topicA.hex));
    pool.onTopic("ws://T", topicA.hex, (ev) => {
      if (ev.kind === "response" && ev.value.kind === "announce")
        seenA.push(...ev.value.value.peers.map((p) => p.peerId));
    });
    pool.acquire("ws://T", topicB.hex, msg(topicB.hex));
    pool.onTopic("ws://T", topicB.hex, (ev) => {
      if (ev.kind === "response" && ev.value.kind === "announce")
        seenB.push(...ev.value.value.peers.map((p) => p.peerId));
    });
    await tick(8);
    expect(pool.size).toBe(2);
    expect(seenA).toEqual(["peer-in-A"]);
    expect(seenB).toEqual(["peer-in-B"]);
    // URL paths carry the topic namespace
    expect(server.sockets.map((s) => s.url)).toEqual([
      `ws://t/${topicA.hex}`,
      `ws://t/${topicB.hex}`,
    ]);
    // releasing A must not disturb B
    pool.release("ws://T", topicA.hex);
    expect(pool.size).toBe(1);
    expect(server.sockets[1]!.closed).toBe(false);
  });

  it("drops responses echoing a foreign info_hash instead of misrouting them", async () => {
    const topicA = deriveDiscoveryTopic("app", "A");
    const topicB = deriveDiscoveryTopic("app", "B");
    const server = new FakeTrackerServer({ neverReply: true });
    const pool = new TrackerPool(server.factory);
    const seenA: unknown[] = [];
    pool.acquire("ws://T", topicA.hex, msg(topicA.hex));
    pool.onTopic("ws://T", topicA.hex, (ev) => seenA.push(ev));
    await tick(4);
    // hostile/misbehaving tracker sends A's socket a frame tagged with B's hash
    server.sockets[0]!.fireMessage(
      JSON.stringify({
        action: "announce",
        info_hash: topicB.infoHashField,
        peers: [{ peerId: "leak" }],
      }),
    );
    expect(seenA.length).toBe(0);
    // and one correctly tagged with A's hash — that one IS delivered
    server.sockets[0]!.fireMessage(
      JSON.stringify({
        action: "announce",
        info_hash: topicA.infoHashField,
        peers: [{ peerId: "ok" }],
      }),
    );
    expect(seenA.length).toBe(1);
  });

  it("keys are normalized (trailing slash/case) and destroy closes everything", () => {
    const server = new FakeTrackerServer();
    const pool = new TrackerPool(server.factory);
    const topic = deriveDiscoveryTopic("app", "R");
    pool.acquire("WS://T:80/", topic.hex, msg(topic.hex));
    expect(pool.connectionKeys).toEqual([
      connectionKey(normalizeTrackerUrl("ws://t:80"), topic.hex),
    ]);
    pool.destroy();
    expect(pool.size).toBe(0);
    expect(
      server.sockets.every((s) => s.closed),
    ).toBe(true);
  });

  it("release is idempotent past zero refs", () => {
    const server = new FakeTrackerServer();
    const pool = new TrackerPool(server.factory);
    const topic = deriveDiscoveryTopic("app", "R");
    pool.acquire("ws://T", topic.hex, msg(topic.hex));
    pool.release("ws://T", topic.hex);
    pool.release("ws://T", topic.hex);
    expect(pool.size).toBe(0);
  });
});
