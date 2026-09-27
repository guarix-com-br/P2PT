/**
 * Phase 2 — WebTorrent tracker protocol layer tests.
 *
 * The protocol module is pure encode/decode/validate; every test here
 * exercises observable wire-format behavior with hostile inputs included.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  buildAnnounce,
  decodeTrackerField,
  encodeMessage,
  encodeTrackerField,
  hexToTrackerField,
  parseTrackerResponse,
  MAX_TRACKER_MESSAGE_BYTES,
  MAX_TRACKER_PEERS_PER_RESPONSE,
  MIN_TRACKER_INTERVAL_SEC,
  DEFAULT_TRACKER_INTERVAL_SEC,
} from "../src/discovery/trackers/WebTorrentTrackerProtocol.js";
import { deriveAppTopic, deriveDiscoveryTopic } from "../src/discovery/trackers/infoHash.js";

function latin1Bytes(field: string): number[] {
  return [...field].map((c) => c.charCodeAt(0));
}

describe("20-byte tracker field encoding", () => {
  it("encodes text into exactly 20 bytes (zero-padded)", () => {
    const field = encodeTrackerField("peer-abc");
    expect(field.length).toBe(20);
    expect(latin1Bytes(field)).toEqual([
      ...new TextEncoder().encode("peer-abc"),
      ...new Array(12).fill(0),
    ]);
  });

  it("truncates input longer than 20 bytes", () => {
    const field = encodeTrackerField("x".repeat(50));
    expect(field.length).toBe(20);
    expect(field).toBe("x".repeat(20));
  });

  it("round-trips ascii ids through encode/decode", () => {
    const field = encodeTrackerField("-abcdef0123456789");
    expect(decodeTrackerField(field)).toBe("-abcdef0123456789");
  });

  it("strips zero padding on decode", () => {
    expect(decodeTrackerField(encodeTrackerField("short"))).toBe("short");
  });

  it("converts 40-hex to a 20-byte latin-1 field", () => {
    const hex = createHash("sha1").update("topic").digest("hex");
    const field = hexToTrackerField(hex);
    expect(field.length).toBe(20);
    const back = latin1Bytes(field)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(back).toBe(hex);
  });

  it("rejects non-40-hex input for hexToTrackerField", () => {
    expect(() => hexToTrackerField("nothex")).toThrowError(/not a 40-hex/);
    expect(() => hexToTrackerField("A".repeat(40))).not.toThrow(); // uppercase ok
  });
});

describe("announce message construction", () => {
  it("builds the validated discovery announce shape", () => {
    const topic = deriveDiscoveryTopic("app", "room");
    const msg = buildAnnounce(topic.infoHashField, encodeTrackerField("peer-xyz"), {
      numwant: 25,
    });
    expect(msg.action).toBe("announce");
    expect(msg.compact).toBe(false);
    expect(msg.uploaded).toBe(0);
    expect(msg.downloaded).toBe(0);
    expect(msg.left).toBe(0);
    expect(msg.numwant).toBe(25);
    expect(msg.info_hash.length).toBe(20);
    expect(msg.peer_id.length).toBe(20);
    expect(JSON.parse(encodeMessage(msg)).action).toBe("announce");
  });
});

describe("parseTrackerResponse — valid frames", () => {
  const topic = deriveDiscoveryTopic("app1", "lobby");

  it("parses an announce response with peers", () => {
    const raw = JSON.stringify({
      action: "announce",
      info_hash: topic.infoHashField,
      interval: 120,
      complete: 3,
      incomplete: 1,
      peers: [
        { peerId: encodeTrackerField("peer-aaa"), ip: "1.2.3.4", port: 5000 },
        { peerId: encodeTrackerField("peer-bbb") },
      ],
    });
    const res = parseTrackerResponse(raw);
    expect(res.kind).toBe("announce");
    if (res.kind !== "announce") return;
    expect(res.value.intervalSec).toBe(120);
    expect(res.value.complete).toBe(3);
    expect(res.value.peers.map((p) => p.peerId)).toEqual(["peer-aaa", "peer-bbb"]);
    expect(res.value.peers[0]!.ip).toBe("1.2.3.4");
    expect(res.value.infoHashField).toBe(topic.infoHashField);
  });

  it("accepts the legacy 'peer id' key spelling", () => {
    const raw = JSON.stringify({
      action: "announce",
      peers: [{ "peer id": encodeTrackerField("peer-old") }],
    });
    const res = parseTrackerResponse(raw);
    expect(res.kind === "announce" && res.value.peers[0]!.peerId).toBe("peer-old");
  });

  it("floors hostile intervals to MIN_TRACKER_INTERVAL_SEC", () => {
    const res = parseTrackerResponse(
      JSON.stringify({ action: "announce", interval: 0, peers: [] }),
    );
    expect(res.kind === "announce" && res.value.intervalSec).toBe(MIN_TRACKER_INTERVAL_SEC);
  });

  it("defaults missing intervals to DEFAULT_TRACKER_INTERVAL_SEC", () => {
    const res = parseTrackerResponse(JSON.stringify({ action: "announce", peers: [] }));
    expect(res.kind === "announce" && res.value.intervalSec).toBe(DEFAULT_TRACKER_INTERVAL_SEC);
  });

  it("caps parsed peer lists at MAX_TRACKER_PEERS_PER_RESPONSE", () => {
    const peers = Array.from({ length: MAX_TRACKER_PEERS_PER_RESPONSE + 50 }, (_, i) => ({
      peerId: encodeTrackerField(`peer-${i}`),
    }));
    const res = parseTrackerResponse(JSON.stringify({ action: "announce", peers }));
    expect(res.kind === "announce" && res.value.peers.length).toBe(
      MAX_TRACKER_PEERS_PER_RESPONSE,
    );
  });
});

describe("parseTrackerResponse — failure responses", () => {
  it("parses 'failure reason' frames", () => {
    const res = parseTrackerResponse(JSON.stringify({ "failure reason": "too busy" }));
    expect(res.kind).toBe("failure");
    expect(res.kind === "failure" && res.value.failureReason).toBe("too busy");
  });

  it("clamps absurdly long failure reasons", () => {
    const res = parseTrackerResponse(
      JSON.stringify({ "failure reason": "x".repeat(5000) }),
    );
    expect(res.kind === "failure" && res.value.failureReason.length).toBeLessThanOrEqual(512);
  });

  it("treats unsupported actions as failures, never crashes", () => {
    const res = parseTrackerResponse(JSON.stringify({ action: "scrape" }));
    expect(res.kind).toBe("failure");
    expect(res.kind === "failure" && res.value.failureReason).toMatch(/unsupported action/);
  });
});

describe("parseTrackerResponse — malformed/hostile frames", () => {
  const bad = [
    "not json at all",
    "{truncated",
    "[]",
    '"a string"',
    "42",
    "null",
  ];
  for (const frame of bad) {
    it(`rejects ${JSON.stringify(frame.slice(0, 20))}`, () => {
      expect(() => parseTrackerResponse(frame)).toThrowError();
    });
  }

  it("rejects oversized messages before parsing", () => {
    const huge = JSON.stringify({ action: "announce", pad: "y".repeat(MAX_TRACKER_MESSAGE_BYTES) });
    expect(() => parseTrackerResponse(huge)).toThrowError(/size limit/);
  });

  it("drops malformed peer entries but keeps good ones", () => {
    const raw = JSON.stringify({
      action: "announce",
      peers: [
        null,
        42,
        { peerId: "" },
        { peerId: 123 },
        { peerId: encodeTrackerField("peer-good"), ip: "!!bad ip!!", port: 999999 },
      ],
    });
    const res = parseTrackerResponse(raw);
    expect(res.kind === "announce" && res.value.peers.length).toBe(1);
    const peer = res.kind === "announce" ? res.value.peers[0]! : undefined;
    expect(peer!.peerId).toBe("peer-good");
    expect(peer!.ip).toBeUndefined();
    expect(peer!.port).toBeUndefined();
  });

  it("survives deeply nested hostile objects without throwing on size", () => {
    const raw = JSON.stringify({ action: "announce", peers: [{ peerId: encodeTrackerField("p") }] });
    expect(parseTrackerResponse(raw).kind).toBe("announce");
  });
});
