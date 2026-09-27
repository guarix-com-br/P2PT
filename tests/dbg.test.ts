import { it } from "vitest";
import type { WebSocketLike } from "../src/transport/Adapter.js";
import { TrackerPool } from "../src/discovery/trackers/TrackerPool.js";
import { WebTorrentTrackerProvider } from "../src/discovery/trackers/WebTorrentTrackerProvider.js";
import { deriveDiscoveryTopic } from "../src/discovery/trackers/infoHash.js";
import { buildAnnounce, encodeTrackerField } from "../src/discovery/trackers/WebTorrentTrackerProtocol.js";

it("dbg pool async reply", async () => {
  const topic = deriveDiscoveryTopic("appA", "room1");
  const sockets: any[] = [];
  const factory = (url: string): WebSocketLike => {
    const listeners: Record<string, Function[]> = {};
    const sock: any = {
      readyState: 0, url, closed: false, sent: [] as string[],
      addEventListener(t: string, l: any) { (listeners[t] ??= []).push(l); },
      send(d: string) { sock.sent.push(d);
        const announce = JSON.parse(d);
        setTimeout(() => listeners["message"]?.forEach((l) => l({ data: JSON.stringify({ action: "announce", info_hash: announce.info_hash, interval: 120, peers: [] }) })), 0);
      },
      close() { if (sock.closed) return; sock.closed = true; sock.readyState = 3; listeners["close"]?.forEach((l) => l({ code: 1000, reason: "" })); },
    };
    queueMicrotask(() => { sock.readyState = 1; listeners["open"]?.forEach((l) => l()); });
    sockets.push(sock);
    return sock;
  };
  const pool = new TrackerPool(factory);
  const msg = buildAnnounce(topic.infoHashField, encodeTrackerField("peer-me"));
  pool.acquire("ws://T", topic.hex, msg);
  let got = "";
  pool.onTopic("ws://T", topic.hex, (ev) => { got = ev.kind + ":" + ((ev as any).value?.kind ?? ""); });
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  console.log("POOLDBG got=", JSON.stringify(got), "sockets=", sockets.length, "sent=", sockets[0]?.sent.length);
});

const SELF = { peerId: "peer-0123456789abcdef0123456789ab" };
it("dbg provider async reply", async () => {
  const topic = deriveDiscoveryTopic("appA", "room1");
  const sockets: any[] = [];
  const factory = (url: string): WebSocketLike => {
    const listeners: Record<string, Function[]> = {};
    const sock: any = {
      readyState: 0, url, closed: false, sent: [] as string[],
      addEventListener(t: string, l: any) { (listeners[t] ??= []).push(l); },
      send(d: string) { sock.sent.push(d);
        const announce = JSON.parse(d);
        setTimeout(() => listeners["message"]?.forEach((l) => l({ data: JSON.stringify({ action: "announce", info_hash: announce.info_hash, interval: 120, peers: [{ peerId: encodeTrackerField("peer-alice") }] }) })), 0);
      },
      close() { if (sock.closed) return; sock.closed = true; sock.readyState = 3; listeners["close"]?.forEach((l) => l({ code: 1000, reason: "" })); },
    };
    queueMicrotask(() => { sock.readyState = 1; listeners["open"]?.forEach((l) => l()); });
    sockets.push(sock);
    return sock;
  };
  const timers: any[] = [];
  const provider = new WebTorrentTrackerProvider({
    url: "ws://tracker.test:8080",
    webSocketFactory: factory,
    timers: { setTimeout: (fn, ms) => { const t = { fn, ms, id: timers.length + 1 }; timers.push(t); return t.id; }, clearTimeout: () => {} },
    random: () => 1,
  });
  const evs: string[] = [];
  provider.on("event", (ev) => { evs.push(ev.type + (ev.type==="state"?`:${ev.state}`:"")); });
  await provider.start({ appId: "appA", self: SELF, roomIds: ["room1"] });
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  console.log("PROVDBG state=", provider.state, "evs=", evs.join(","), "timers=", timers.map(t=>t.ms).join(","));
});
