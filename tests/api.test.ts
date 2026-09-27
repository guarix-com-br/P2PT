import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { NotImplementedError } from "../src/core/errors.js";

describe("public API surface", () => {
  it("P2PClient constructs with valid config and exposes identity", () => {
    const client = new api.P2PClient({ appId: "demo", peerName: "alice" });
    expect(client.id).toMatch(/^peer-[0-9a-f]{24}$/);
    expect(client.metadata.name).toBe("alice");
    expect(client.closed).toBe(false);
    expect(client.getPeers()).toEqual([]);
  });

  it("honors an explicit peerId", () => {
    const client = new api.P2PClient({ appId: "demo", peerId: "fixed-id" });
    expect(client.id).toBe("fixed-id");
  });

  it("rejects invalid configuration at construction time", () => {
    expect(() => new api.P2PClient({ appId: "" })).toThrow(api.ConfigValidationError);
  });

  it("inherits the typed event bus", () => {
    const client = new api.P2PClient({ appId: "demo" });
    let seen: string | undefined;
    client.on("peer:connecting", (e) => (seen = e.peerId));
    client.emit("peer:connecting", { peerId: "p1" });
    expect(seen).toBe("p1");
  });

  it("unimplemented facades throw NotImplementedError with phase hints", async () => {
    const client = new api.P2PClient({ appId: "demo" });
    expect(() => client.joinRoom("room-1")).toThrow(NotImplementedError);
    expect(() => client.connectTo("peer-x")).toThrow(/Phase 4/);
    expect(() => client.control.discovery.addProvider({} as never)).toThrow(
      /control.*Phase 2/,
    );
    expect(() => client.data.rpc.request("sum")).toThrow(/data.*Phase 5/);
    expect(() => client.media.audio.start()).toThrow(/media.*Phase 9/);
    await expect(client.stats.getPeerStats("p")).rejects.toThrow(NotImplementedError);
  });

  it("nested facade calls at any depth throw with the exact call path", () => {
    const client = new api.P2PClient({ appId: "demo" });
    // Depth-2 leaf (facade.method())
    expect(() =>
      (
        client.control as unknown as {
          ping: (...a: unknown[]) => void;
        }
      ).ping(),
    ).toThrow(/client\.control\.ping\(\).*Phase 2/);
    // Depth-3 leaf (facade.sub.method())
    expect(() =>
      (
        client.media.video as unknown as {
          start: () => void;
        }
      ).start(),
    ).toThrow(/client\.media\.video\.start\(\).*Phase 9/);
    // Depth-4+ arbitrary nesting (facade.a.b.method())
    expect(() =>
      (
        client.control.discovery as unknown as {
          providers: { tracker: { start: () => void } };
        }
      ).providers.tracker.start(),
    ).toThrow(/client\.control\.discovery\.providers\.tracker\.start\(\).*Phase 2/);
    // Async members reject (usable inside await) at any depth
    return expect(
      (
        client.stats as unknown as {
          perPeer: { getStats: (id: string) => Promise<unknown> };
        }
      ).perPeer.getStats("p"),
    ).rejects.toThrow(/client\.stats\.perPeer\.getStats\(\).*Phase 15/);
  });

  it("close() is idempotent and clears listeners", async () => {
    const client = new api.P2PClient({ appId: "demo" });
    client.on("message", () => {});
    await client.close();
    await client.close();
    expect(client.closed).toBe(true);
    expect(client.listenerCount("message")).toBe(0);
  });
});

describe("protocol constants", () => {
  it("exposes the stable message-type registry", () => {
    expect(api.MessageType.HELLO).toBe(0x0001);
    expect(api.MessageType.FILE_CHUNK).toBe(0x0303);
    expect(api.PROTOCOL_VERSION).toBe(1);
    expect(api.isSupportedProtocolVersion(1)).toBe(true);
    expect(api.isSupportedProtocolVersion(2)).toBe(false);
    expect(api.isSupportedProtocolVersion(1.5)).toBe(false);
  });

  it("defines the five logical channels", () => {
    expect(api.CHANNEL_NAMES).toEqual(["control", "messages", "rpc", "files", "sync"]);
    expect(api.isChannelName("rpc")).toBe(true);
    expect(api.isChannelName("chat")).toBe(false);
    expect(api.DEFAULT_CHANNEL_RELIABILITY.messages).toBe("reliable-ordered");
  });
});

describe("generateId", () => {
  it("produces unique prefixed ids", () => {
    const a = api.generateId("transfer");
    const b = api.generateId("transfer");
    expect(a).toMatch(/^transfer-[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
