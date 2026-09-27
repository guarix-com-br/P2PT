import { describe, expect, it } from "vitest";
import { resolveConfig, DEFAULT_ICE_SERVERS } from "../src/config/Config.js";
import { ConfigValidationError } from "../src/core/errors.js";
import { DEFAULT_LIMITS } from "../src/security/Limits.js";

const base = { appId: "test-app" };

describe("resolveConfig", () => {
  it("applies documented defaults", () => {
    const cfg = resolveConfig(base);
    expect(cfg.appId).toBe("test-app");
    expect(cfg.peerName).toBe("peer");
    expect(cfg.trackers).toEqual([]);
    expect(cfg.iceServers).toEqual(DEFAULT_ICE_SERVERS);
    expect(cfg.requestTimeoutMs).toBe(10_000);
    expect(cfg.reconnectAttempts).toBe(5);
    expect(cfg.limits).toEqual(DEFAULT_LIMITS);
  });

  it("merges partial limits over defaults without mutating them", () => {
    const cfg = resolveConfig({ ...base, limits: { maxPeers: 8 } });
    expect(cfg.limits.maxPeers).toBe(8);
    expect(cfg.limits.maxMessageSize).toBe(DEFAULT_LIMITS.maxMessageSize);
    expect(DEFAULT_LIMITS.maxPeers).toBe(20);
  });

  it("collects every problem into one ConfigValidationError", () => {
    let caught: ConfigValidationError | undefined;
    try {
      resolveConfig({
        appId: "  ",
        requestTimeoutMs: -5,
        trackers: ["http://not-a-tracker"],
        iceServers: [{ urls: ["ftp://nope"] }],
        limits: { maxPeers: 0 },
      } as never);
    } catch (err) {
      caught = err as ConfigValidationError;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    const paths = caught?.issues.map((i) => i.path) ?? [];
    expect(paths).toContain("appId");
    expect(paths).toContain("requestTimeoutMs");
    expect(paths).toContain("trackers");
    expect(paths).toContain("iceServers");
    expect(paths).toContain("limits.maxPeers");
  });

  it("rejects chunk sizes larger than the message size", () => {
    expect(() =>
      resolveConfig({
        ...base,
        limits: { maxChunkSize: 900_000, maxMessageSize: 100 },
      }),
    ).toThrow(/maxChunkSize/);
  });

  it("accepts well-formed ws/wss trackers and turn servers", () => {
    const cfg = resolveConfig({
      ...base,
      trackers: ["wss://tracker.example:443/ws", "ws://localhost:8080/ws"],
      signalingUrls: ["ws://localhost:9000"],
      iceServers: [
        { urls: "stun:stun.example.org:3478" },
        {
          urls: ["turn:relay.example.org?transport=udp"],
          username: "u",
          credential: "p",
        },
      ],
    });
    expect(cfg.trackers).toHaveLength(2);
    expect(cfg.iceServers).toHaveLength(2);
  });
});
