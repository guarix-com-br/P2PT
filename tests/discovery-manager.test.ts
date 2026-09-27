/**
 * DiscoveryManager behavioral tests (Phase 2).
 *
 * Everything is exercised through the manager's public/observable surface:
 * the `DiscoveryProvider` contract, its typed events, and `getDiscovered()`.
 * Deterministic mock providers + fake timers — no sockets, no network,
 * no public trackers, no real-time sleeps.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DiscoveryManager } from "../src/discovery/DiscoveryManager.js";
import type { DiscoveredPeer } from "../src/discovery/DiscoveryProvider.js";
import { MockDiscoveryProvider } from "./fixtures/MockDiscoveryProvider.js";
import { deriveDiscoveryTopic } from "../src/discovery/trackers/infoHash.js";
import { DEFAULT_LIMITS } from "../src/security/Limits.js";
import type { ResourceLimits } from "../src/security/Limits.js";
import type { TimerProvider } from "../src/transport/Adapter.js";
import type { DiscoveryManagerOptions } from "../src/control/ControlPlane.js";

const APP = "test-app";
const SELF = "peer-self00000000000000001";

/* ----------------------------- fake timers ------------------------------ */

/**
 * Deterministic clock: vitest fake timers control both `Date.now()` and
 * `setTimeout`, so TTL/rate math is fully reproducible. The returned
 * `TimerProvider` bridges the framework seam onto that same clock, and
 * `advance(ms)` fires due callbacks synchronously.
 */
function installFakeClock(startMs = 1_000_000) {
  vi.useFakeTimers({ now: startMs });
  const timers: TimerProvider = {
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return Object.assign(timers, {
    __clock: {
      now: () => Date.now(),
      advance: (ms: number) => vi.advanceTimersByTime(ms),
    } satisfies FakeClock,
  }) as TimerProvider & { __clock: FakeClock };
}

interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------ helpers --------------------------------- */

function makeOptions(overrides: Partial<DiscoveryManagerOptions> = {}): DiscoveryManagerOptions {
  const limits: ResourceLimits = overrides.limits ?? {
    ...DEFAULT_LIMITS,
    maxDiscoveredPeers: 500,
    discoveryRatePerSecond: 50,
    peerTtlMs: 180_000,
  };
  return {
    appId: APP,
    self: { peerId: SELF },
    limits,
    discovery: {
      minAnnounceIntervalSec: 30,
      maxAnnounceIntervalSec: 1800,
      numwant: 50,
      recentlyGoneCapacity: 256,
    },
    random: () => 0.5,
    ...overrides,
  };
}

function peer(id: string, extra: Partial<DiscoveredPeer> = {}): DiscoveredPeer {
  return { peerId: id, appId: APP, ...extra };
}

async function started(
  manager: DiscoveryManager,
  roomIds: string[] = [],
): Promise<void> {
  await manager.start({ appId: APP, roomIds });
}

function collect<T>(manager: DiscoveryManager, event: string): T[] {
  const out: T[] = [];
  (manager.on as (e: string, h: (p: T) => void) => void)(event, (p) => out.push(p));
  return out;
}

/* =========================== 1. provider lifecycle ====================== */

describe("DiscoveryManager — provider lifecycle", () => {
  it("registers providers and starts them with the current scope", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:a");
    m.addProvider(p);
    expect(m.providerIds).toEqual(["mock:a"]);
    await started(m, ["room-1"]);
    expect(p.calls).toContain("start");
    expect(p.startedScopes).toEqual([["room-1"]]);
    expect(p.state).toBe("connected");
    await m.destroy();
  });

  it("rejects duplicate provider ids and use after stop", async () => {
    const m = new DiscoveryManager(makeOptions());
    m.addProvider(new MockDiscoveryProvider("mock:d"));
    expect(() => m.addProvider(new MockDiscoveryProvider("mock:d"))).toThrow(/duplicate/);
    await m.stop();
    expect(() => m.addProvider(new MockDiscoveryProvider("mock:e"))).toThrow(/stopped/);
  });

  it("propagates provider state changes as normalized provider-event/tracker-status", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:s");
    m.addProvider(p);
    const providerEvents = collect<{ type: string; providerId?: string; state?: string }>(
      m,
      "provider-event",
    );
    const trackerStatus = collect<{ connected: boolean; url: string }>(m, "tracker-status");
    await started(m);
    expect(providerEvents.some((e) => e.type === "state" && e.state === "connected")).toBe(true);
    // Non-tracker mock must not emit tracker-status (no url duck-type match).
    expect(trackerStatus.length).toBe(0);
    await m.destroy();
  });

  it("isolates provider failure: a broken provider does not stop others", async () => {
    const m = new DiscoveryManager(makeOptions());
    const bad = new MockDiscoveryProvider("mock:bad");
    bad.failOnStart = true;
    const good = new MockDiscoveryProvider("mock:good");
    m.addProvider(bad);
    m.addProvider(good);
    const errors = collect<{ type: string; providerId: string }>(m, "provider-event");
    await started(m); // must not reject even though one provider throws
    expect(good.state).toBe("connected");
    expect(errors.some((e) => e.type === "error" && e.providerId === "mock:bad")).toBe(true);
    // Good provider keeps working after the bad one failed.
    good.emitPeer(peer("peer-good1"));
    expect(m.getDiscovered().map((x) => x.peerId)).toEqual(["peer-good1"]);
    await m.destroy();
  });

  it("late-registered provider auto-starts with the CURRENT room scope", async () => {
    const m = new DiscoveryManager(makeOptions());
    const first = new MockDiscoveryProvider("mock:first");
    m.addProvider(first);
    await started(m, ["room-live"]);
    const late = new MockDiscoveryProvider("mock:late");
    m.addProvider(late);
    await vi.waitFor(() => expect(late.state).toBe("connected"));
    expect(late.startedScopes).toEqual([["room-live"]]);
    await m.destroy();
  });

  it("removeProvider stops+destroys it and drops exclusively-sourced peers", async () => {
    const m = new DiscoveryManager(makeOptions());
    const a = new MockDiscoveryProvider("mock:a");
    const b = new MockDiscoveryProvider("mock:b");
    m.addProvider(a);
    m.addProvider(b);
    await started(m);
    a.emitPeer(peer("peer-only-a"));
    b.emitPeer(peer("peer-shared", { hints: { via: "b" } }));
    a.emitPeer(peer("peer-shared", { hints: { via: "a" } }));
    expect(m.getDiscovered()).toHaveLength(2);
    await m.removeProvider("mock:a");
    expect(a.calls).toContain("stop");
    expect(a.calls).toContain("destroy");
    const remaining = m.getDiscovered();
    expect(remaining.map((x) => x.peerId)).toEqual(["peer-shared"]);
    expect(remaining[0]!.hints?.sources).toEqual(["mock:b"]);
    // Removing an unknown provider is a no-op.
    await expect(m.removeProvider("mock:nope")).resolves.toBeUndefined();
    await m.destroy();
  });

  it("stop()/destroy() are idempotent and destroy prevents further processing", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:i");
    m.addProvider(p);
    await started(m);
    await m.stop();
    await m.stop(); // idempotent
    expect(p.calls.filter((c) => c === "stop").length).toBeGreaterThanOrEqual(1);
    await m.destroy();
    await m.destroy(); // idempotent
    expect(p.calls.filter((c) => c === "destroy").length).toBe(1);
    // Post-destroy emissions are ignored safely (listeners were removed by
    // destroy AND the manager refuses new hits).
    p.emitPeer(peer("peer-after"));
    expect(m.getDiscovered()).toHaveLength(0);
    expect(m.started).toBe(false);
  });

  it("clears discovered peers on stop", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:c");
    m.addProvider(p);
    await started(m);
    p.emitPeer(peer("peer-x"));
    expect(m.getDiscovered()).toHaveLength(1);
    await m.stop();
    expect(m.getDiscovered()).toHaveLength(0);
  });
});

/* ======================== 2. discovery normalization ==================== */

describe("DiscoveryManager — normalization", () => {
  it("publishes validated peer fields and source metadata", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:n");
    m.addProvider(p);
    await started(m, ["room-9"]);
    const discovered = collect<{
      peerId: string;
      appId: string;
      roomId?: string;
      metadata?: Record<string, unknown>;
      sources: readonly string[];
    }>(m, "discovered");
    p.emitPeer(
      peer("peer-norm", {
        roomId: "room-9",
        metadata: { name: "Norm", active: true, level: 3 },
        hints: { interval: 42 },
      }),
    );
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      peerId: "peer-norm",
      appId: APP,
      roomId: "room-9",
      metadata: { name: "Norm", active: true, level: 3 },
      sources: ["mock:n"],
    });
    const snap = m.getDiscovered()[0]!;
    expect(snap.hints?.sources).toEqual(["mock:n"]);
    await m.destroy();
  });

  it("ignores self-echo hits matching the local peer id", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:self");
    m.addProvider(p);
    await started(m);
    const discovered = collect<unknown>(m, "discovered");
    p.emitPeer(peer(SELF));
    expect(discovered).toHaveLength(0);
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });
});

/* ===================== 3. cross-provider deduplication =================== */

describe("DiscoveryManager — deduplication", () => {
  it("same logical peer from two providers yields ONE entry with merged sources", async () => {
    const m = new DiscoveryManager(makeOptions());
    const a = new MockDiscoveryProvider("prov-a");
    const b = new MockDiscoveryProvider("prov-b");
    m.addProvider(a);
    m.addProvider(b);
    await started(m, ["room-d"]);
    const discovered = collect<{ sources: readonly string[] }>(m, "discovered");
    a.emitPeer(peer("peer-dupe", { roomId: "room-d", hints: { s: 1 } }));
    b.emitPeer(peer("peer-dupe", { roomId: "room-d", hints: { s: 2 } }));
    expect(discovered).toHaveLength(1); // no re-fire without metadata change
    const entries = m.getDiscovered();
    expect(entries).toHaveLength(1);
    expect([...entries[0]!.hints!.sources as string[]].sort()).toEqual(["prov-a", "prov-b"]);
    await m.destroy();
  });

  it("identity includes roomId: same peerId in different rooms stays distinct", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:r");
    m.addProvider(p);
    await started(m, ["roomA", "roomB"]);
    p.emitPeer(peer("peer-multi", { roomId: "roomA" }));
    p.emitPeer(peer("peer-multi", { roomId: "roomB" }));
    const view = m.getDiscovered();
    expect(view).toHaveLength(2);
    expect(new Set(view.map((v) => v.roomId))).toEqual(new Set(["roomA", "roomB"]));
    await m.destroy();
  });

  it("foreign appId hits never enter our namespace", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:f");
    m.addProvider(p);
    await started(m);
    const discovered = collect<unknown>(m, "discovered");
    p.emitPeer({ peerId: "peer-alien", appId: "other-app" });
    expect(discovered).toHaveLength(0);
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });

  it("hits for rooms outside declared scope are dropped", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:oos");
    m.addProvider(p);
    await started(m, ["mine"]);
    const discovered = collect<unknown>(m, "discovered");
    p.emitPeer(peer("peer-stranger", { roomId: "not-mine" }));
    expect(discovered).toHaveLength(0);
    await m.destroy();
  });
});

/* ============================== 7. TTL ================================== */

describe("DiscoveryManager — TTL expiration & refresh", () => {
  it("expires a peer after peerTtlMs and emits expired", async () => {
    const timers = installFakeClock();
    const m = new DiscoveryManager(
      makeOptions({
        timers,
        limits: { ...DEFAULT_LIMITS, peerTtlMs: 10_000, maxDiscoveredPeers: 500, discoveryRatePerSecond: 50 },
      }),
    );
    const p = new MockDiscoveryProvider("mock:ttl");
    m.addProvider(p);
    await started(m);
    const expired = collect<{ peerId: string }>(m, "expired");
    p.emitPeer(peer("peer-ttl"));
    expect(m.getDiscovered()).toHaveLength(1);
    timers.__clock.advance(5_000); // sweep tick at t+5s: alive (5s < TTL)
    expect(m.getDiscovered()).toHaveLength(1);
    timers.__clock.advance(6_000); // deadline passed at t+10s…
    timers.__clock.advance(4_000); // …the next sweep tick (t+10s) fires in this span and removes it
    expect(expired.map((e) => e.peerId)).toEqual(["peer-ttl"]);
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });

  it("rediscovery refreshes TTL instead of duplicating", async () => {
    const timers = installFakeClock();
    const m = new DiscoveryManager(
      makeOptions({
        timers,
        limits: { ...DEFAULT_LIMITS, peerTtlMs: 10_000, maxDiscoveredPeers: 500, discoveryRatePerSecond: 50 },
      }),
    );
    const p = new MockDiscoveryProvider("mock:refresh");
    m.addProvider(p);
    await started(m);
    const discovered = collect<unknown>(m, "discovered");
    p.emitPeer(peer("peer-refresh"));
    timers.__clock.advance(8_000); // sweep ticks ran at 5s while alive
    p.emitPeer(peer("peer-refresh")); // refresh — same identity
    expect(m.getDiscovered()).toHaveLength(1);
    expect(discovered).toHaveLength(1); // no duplicate fire (metadata unchanged)
    timers.__clock.advance(7_000); // ticks @10s,15s — refreshed at 8s, still alive
    expect(m.getDiscovered()).toHaveLength(1);
    timers.__clock.advance(5_000); // tick @20s — 12s after refresh > TTL → expired
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });

  it("metadata change on rediscovery re-fires discovered with updated sources", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:meta");
    m.addProvider(p);
    await started(m);
    const discovered = collect<{ metadata?: Record<string, unknown> }>(m, "discovered");
    p.emitPeer(peer("peer-m", { metadata: { name: "old" } }));
    p.emitPeer(peer("peer-m", { metadata: { name: "new" } }));
    expect(discovered).toHaveLength(2);
    expect(discovered[1]!.metadata).toMatchObject({ name: "new" });
    await m.destroy();
  });
});

/* ========================= 9. rate limiting ============================= */

describe("DiscoveryManager — rate limiting", () => {
  it("enforces discoveryRatePerSecond with a sliding window and recovers", async () => {
    const timers = installFakeClock();
    const m = new DiscoveryManager(
      makeOptions({
        timers,
        limits: { ...DEFAULT_LIMITS, discoveryRatePerSecond: 5, maxDiscoveredPeers: 1000, peerTtlMs: 180_000 },
      }),
    );
    const p = new MockDiscoveryProvider("mock:rate");
    m.addProvider(p);
    await started(m);
    const discovered = collect<unknown>(m, "discovered");
    for (let i = 0; i < 10; i++) p.emitPeer(peer(`peer-r${i}`));
    expect(discovered).toHaveLength(5); // only rate allowance accepted
    expect(m.droppedDueToRate).toBe(5);
    expect(m.getDiscovered()).toHaveLength(5);
    // Advance the window → legitimate events accepted again.
    timers.__clock.advance(1_100);
    p.emitPeer(peer("peer-after-window"));
    expect(discovered).toHaveLength(6);
    await m.destroy();
  });

  it("rate budget is global: switching providers cannot bypass it", async () => {
    const timers = installFakeClock();
    const m = new DiscoveryManager(
      makeOptions({
        timers,
        limits: { ...DEFAULT_LIMITS, discoveryRatePerSecond: 4, maxDiscoveredPeers: 1000, peerTtlMs: 180_000 },
      }),
    );
    const a = new MockDiscoveryProvider("rate-a");
    const b = new MockDiscoveryProvider("rate-b");
    m.addProvider(a);
    m.addProvider(b);
    await started(m);
    a.emitPeer(peer("peer-a1"));
    a.emitPeer(peer("peer-a2"));
    b.emitPeer(peer("peer-b1"));
    b.emitPeer(peer("peer-b2"));
    b.emitPeer(peer("peer-b3")); // 5th hit in the same window → blocked
    expect(m.getDiscovered()).toHaveLength(4);
    expect(m.droppedDueToRate).toBe(1);
    await m.destroy();
  });

  it("rejected malformed hits do not consume rate capacity", async () => {
    const timers = installFakeClock();
    const m = new DiscoveryManager(
      makeOptions({
        timers,
        limits: { ...DEFAULT_LIMITS, discoveryRatePerSecond: 3, maxDiscoveredPeers: 1000, peerTtlMs: 180_000 },
      }),
    );
    const p = new MockDiscoveryProvider("mock:mix");
    m.addProvider(p);
    await started(m);
    // 10 malformed hits first — must not exhaust the window…
    for (let i = 0; i < 10; i++) p.emitRaw({ type: "peer", peer: { bogus: true } as never });
    // …then 3 valid ones fit exactly inside the allowance.
    p.emitPeer(peer("peer-v1"));
    p.emitPeer(peer("peer-v2"));
    p.emitPeer(peer("peer-v3"));
    expect(m.getDiscovered()).toHaveLength(3);
    expect(m.droppedDueToRate).toBe(0);
    await m.destroy();
  });
});

/* ======================= 10. max discovered peers ======================= */

describe("DiscoveryManager — max discovered peers", () => {
  it("caps stored peers at maxDiscoveredPeers and warns on overflow", async () => {
    const m = new DiscoveryManager(
      makeOptions({
        limits: { ...DEFAULT_LIMITS, maxDiscoveredPeers: 3, discoveryRatePerSecond: 100, peerTtlMs: 180_000 },
      }),
    );
    const p = new MockDiscoveryProvider("mock:cap");
    m.addProvider(p);
    await started(m);
    const warnings = collect<{ message: string }>(m, "provider-event");
    for (let i = 0; i < 6; i++) p.emitPeer(peer(`peer-cap${i}`));
    expect(m.getDiscovered()).toHaveLength(3);
    expect(warnings.some((w) => w.type === "warning" && /maxDiscoveredPeers/.test(w.message))).toBe(
      true,
    );
    // Existing peers can still be refreshed while the cap holds.
    p.emitPeer(peer("peer-cap0"));
    expect(m.getDiscovered()).toHaveLength(3);
    await m.destroy();
  });
});

/* ==================== 11. malformed / hostile input ===================== */

describe("DiscoveryManager — hostile input safety", () => {
  const hostileHits: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["string", "just-a-string"],
    ["array", []],
    ["missing peerId", { appId: APP }],
    ["invalid peerId chars", { peerId: "peer<script>", appId: APP }],
    ["peerId too long", { peerId: `peer-${"x".repeat(100)}`, appId: APP }],
    ["invalid appId", { peerId: "peer-ok", appId: "app with spaces!" }],
    ["invalid roomId", { peerId: "peer-ok", appId: APP, roomId: "rooms/../etc" }],
    ["metadata not object", { peerId: "peer-ok", appId: APP, metadata: "hello" }],
    ["metadata oversized value", { peerId: "peer-ok", appId: APP, metadata: { name: "z".repeat(1000) } }],
    ["metadata too many keys", {
      peerId: "peer-ok",
      appId: APP,
      metadata: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 1])),
    }],
    ["metadata nested object", { peerId: "peer-ok", appId: APP, metadata: { deep: { x: 1 } } }],
    ["metadata NaN", { peerId: "peer-ok", appId: APP, metadata: { n: Number.NaN } }],
    ["hints array", { peerId: "peer-ok", appId: APP, hints: [1, 2, 3] }],
    ["hints too large", { peerId: "peer-ok", appId: APP, hints: { blob: "y".repeat(5000) } }],
  ];

  it.each(hostileHits)("survives hostile hit (%s) without crashing or emitting", async (_name, raw) => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:evil");
    m.addProvider(p);
    await started(m);
    const discovered = collect<unknown>(m, "discovered");
    expect(() => p.emitRaw({ type: "peer", peer: raw as DiscoveredPeer })).not.toThrow();
    expect(discovered).toHaveLength(0);
    expect(m.getDiscovered()).toHaveLength(0);
    // Manager remains fully operational afterwards:
    p.emitPeer(peer("peer-survivor"));
    expect(discovered).toHaveLength(1);
    await m.destroy();
  });

  it("a provider whose on() throws cannot take down registration or the manager", () => {
    const evil: DiscoveredPeer = { peerId: "peer-z", appId: APP };
    const throwing = {
      id: "mock:thrower",
      state: "idle" as const,
      on: () => {
        throw new Error("boom");
      },
      start: async () => {},
      stop: async () => {},
    };
    const m = new DiscoveryManager(makeOptions());
    expect(() => m.addProvider(throwing as never)).toThrow("boom"); // surfaces but manager survives
    // A good provider registered afterwards still works:
    const good = new MockDiscoveryProvider("mock:after");
    m.addProvider(good);
    good.emitPeer(evil);
    expect(m.getDiscovered().map((x) => x.peerId)).toEqual(["peer-z"]);
  });

  it("malformed peer-gone events are ignored safely", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:gone");
    m.addProvider(p);
    await started(m);
    p.emitPeer(peer("peer-g"));
    expect(() =>
      p.emitRaw({ type: "peer-gone", peerId: 42 as never }),
    ).not.toThrow();
    expect(m.getDiscovered()).toHaveLength(1); // untouched by junk gone-event
    // Valid gone from the only source removes the entry.
    p.emitRaw({ type: "peer-gone", peerId: "peer-g" });
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });

  it("peer-gone from one provider keeps multi-source peers alive", async () => {
    const m = new DiscoveryManager(makeOptions());
    const a = new MockDiscoveryProvider("gone-a");
    const b = new MockDiscoveryProvider("gone-b");
    m.addProvider(a);
    m.addProvider(b);
    await started(m);
    a.emitPeer(peer("peer-shared-gone"));
    b.emitPeer(peer("peer-shared-gone"));
    a.emitRaw({ type: "peer-gone", peerId: "peer-shared-gone" });
    expect(m.getDiscovered().map((x) => x.peerId)).toEqual(["peer-shared-gone"]);
    b.emitRaw({ type: "peer-gone", peerId: "peer-shared-gone" });
    expect(m.getDiscovered()).toHaveLength(0);
    await m.destroy();
  });
});

/* ============================ 12. room lifecycle ======================== */

describe("DiscoveryManager — room lifecycle", () => {
  it("joinRoom uses incremental provider commands when supported", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:scope");
    m.addProvider(p);
    await started(m);
    await m.joinRoom("room-x");
    expect(p.joinedRooms).toEqual(["room-x"]);
    expect(m.rooms).toContain("room-x");
    // Repeated join is a no-op.
    await m.joinRoom("room-x");
    expect(p.joinedRooms).toEqual(["room-x"]);
    await m.destroy();
  });

  it("providers without scope commands are restarted with the widened set", async () => {
    const m = new DiscoveryManager(makeOptions());
    const plain = new MockDiscoveryProvider("mock:plain");
    // Instance-level undefined shadows the prototype methods, so the
    // manager's `typeof provider.joinRoom === "function"` check fails and
    // exercises the stop+restart fallback path.
    Object.assign(plain, { joinRoom: undefined, leaveRoom: undefined });
    m.addProvider(plain);
    await started(m, ["r1"]);
    await m.joinRoom("r2");
    // The widened-scope restart is async (fire-and-forget fallback path);
    // drain the microtask queue deterministically before asserting.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(plain.calls).toEqual(["start", "stop", "restart"]);
    expect(plain.startedScopes.at(-1)).toEqual(["r1", "r2"]);
    await m.destroy();
  });

  it("leaveRoom drops that room's peers immediately and leaves other rooms intact", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:leave");
    m.addProvider(p);
    await started(m, ["keep", "drop"]);
    p.emitPeer(peer("peer-keep", { roomId: "keep" }));
    p.emitPeer(peer("peer-drop", { roomId: "drop" }));
    expect(m.getDiscovered()).toHaveLength(2);
    const expired = collect<{ peerId: string }>(m, "expired");
    await m.leaveRoom("drop");
    expect(p.leftRooms).toEqual(["drop"]);
    expect(m.getDiscovered().map((x) => x.peerId)).toEqual(["peer-keep"]);
    expect(expired.map((e) => e.peerId)).toEqual(["peer-drop"]);
    // Repeated leave is a no-op.
    await m.leaveRoom("drop");
    expect(p.leftRooms).toEqual(["drop"]);
    await m.destroy();
  });

  it("rediscovery into a left room is rejected; rejoining starts clean", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:rejoin");
    m.addProvider(p);
    await started(m, ["temp"]);
    p.emitPeer(peer("peer-temp", { roomId: "temp" }));
    await m.leaveRoom("temp");
    const discovered = collect<unknown>(m, "discovered");
    p.emitPeer(peer("peer-stale", { roomId: "temp" })); // out of scope now
    expect(discovered).toHaveLength(0);
    await m.joinRoom("temp");
    expect(m.getDiscovered()).toHaveLength(0); // previous peers purged
    p.emitPeer(peer("peer-new", { roomId: "temp" }));
    expect(discovered).toHaveLength(1);
    await m.destroy();
  });

  it("room scoping matches the centralized deriveDiscoveryTopic namespace", async () => {
    // The manager delegates topic derivation to infoHash.ts — verify the
    // helper itself is deterministic/isolated for the same inputs used here.
    const t1 = deriveDiscoveryTopic(APP, "room-A");
    const t2 = deriveDiscoveryTopic(APP, "room-A");
    const t3 = deriveDiscoveryTopic(APP, "room-B");
    expect(t1.hex).toBe(t2.hex);
    expect(t1.hex).not.toBe(t3.hex);
    expect(t1.hex).toMatch(/^[0-9a-f]{40}$/);
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:t");
    m.addProvider(p);
    await started(m, ["room-A"]);
    expect(p.startedScopes).toEqual([["room-A"]]);
    await m.destroy();
  });

  it("start() on an already-running manager reconciles room scope", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:recon");
    m.addProvider(p);
    await started(m, ["one"]);
    await m.start({ appId: APP, roomIds: ["two"] });
    expect(new Set(m.rooms)).toEqual(new Set(["one", "two"]));
    expect(p.joinedRooms).toEqual(["two"]);
    await m.destroy();
  });

  it("start() rejects a foreign appId", async () => {
    const m = new DiscoveryManager(makeOptions());
    await expect(m.start({ appId: "someone-elses-app" })).rejects.toThrow(/appId mismatch/);
    await m.destroy();
  });
});

/* ============================= 13. events =============================== */

describe("DiscoveryManager — public event compatibility", () => {
  it("emits tracker-status with URL for tracker-like providers (public tracker:* mapping)", async () => {
    const m = new DiscoveryManager(makeOptions());
    const pseudoTracker = new MockDiscoveryProvider("tracker:wss://example/announce");
    Object.defineProperty(pseudoTracker, "url", { value: "wss://example/announce" });
    m.addProvider(pseudoTracker);
    const status = collect<{ url: string; connected: boolean }>(m, "tracker-status");
    await started(m);
    expect(status).toContainEqual({
      providerId: "tracker:wss://example/announce",
      url: "wss://example/announce",
      connected: true,
    });
    await m.stop();
    expect(status.at(-1)).toMatchObject({ connected: false });
    await m.destroy();
  });

  it("provider error events pass through normalized with retryable flag", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:err");
    m.addProvider(p);
    await started(m);
    const providerEvents = collect<{ type: string; providerId: string; retryable?: boolean }>(
      m,
      "provider-event",
    );
    p.emitRaw({ type: "error", error: new Error("socket died"), retryable: true });
    expect(
      providerEvents.some(
        (e) => e.type === "error" && e.providerId === "mock:err" && e.retryable === true,
      ),
    ).toBe(true);
    await m.destroy();
  });

  it("warning and retrying variants pass through untouched (additive Phase-2 events)", async () => {
    const m = new DiscoveryManager(makeOptions());
    const p = new MockDiscoveryProvider("mock:warn");
    m.addProvider(p);
    await started(m);
    const events = collect<{ type: string; message?: string; attempt?: number }>(
      m,
      "provider-event",
    );
    p.emitRaw({ type: "warning", message: "odd frame" });
    p.emitRaw({ type: "retrying", attempt: 2, delayMs: 500 });
    expect(events.some((e) => e.type === "warning" && e.message === "odd frame")).toBe(true);
    expect(events.some((e) => e.type === "retrying" && e.attempt === 2)).toBe(true);
    await m.destroy();
  });
});
