/**
 * WebTorrent-compatible WebSocket tracker **protocol** layer (Phase 2).
 *
 * Pure wire-format code only: JSON message shapes, 20-byte binary
 * `info_hash` / `peer_id` latin-1 encoding, response validation and peer
 * extraction. No sockets, no timers, no state — everything here is
 * independently testable and treats every inbound value as untrusted.
 *
 * Wire format (empirically validated against a local
 * `bittorrent-tracker` server, devDependency-only):
 *
 *   → { action: "announce", "info_hash": <20 raw bytes as latin-1 string>,
 *       peer_id: <20 raw bytes>, port?, numwant?, compact: false,
 *       "uploaded": 0, "downloaded": 0, left: 0 }
 *   ← { action: "announce", "info_hash", interval?, "complete"?,
 *       "incomplete"?, peers?: [{ peerId, ip?, port? }] }
 *   ← { "failure reason": string }
 *
 * This module deliberately implements only the discovery subset of the
 * protocol (announce + peer lists). Signaling-style `int` messages are NOT
 * handled here — that is Phase 3's responsibility.
 */

/* ------------------------- 20-byte id encoding ------------------------ */

/** Encode text into exactly 20 raw bytes (truncated/padded), then latin-1. */
export function encodeTrackerField(text: string): string {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(20);
  bytes.set(encoded.subarray(0, Math.min(encoded.length, 20)));
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** Decode a latin-1 tracker field back to trimmed UTF-8 text. */
export function decodeTrackerField(field: string): string {
  const bytes = new Uint8Array(Math.min(field.length, 20));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = field.charCodeAt(i)! & 0xff;
  }
  // Strip zero padding before decoding so trailing NULs never leak through.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, end))
    .trim();
}

/** 40-char lowercase hex → exactly 20 raw bytes as latin-1 string. */
export function hexToTrackerField(hex: string): string {
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) {
    throw new Error(`not a 40-hex info hash: ${JSON.stringify(hex.slice(0, 48))}`);
  }
  let out = "";
  for (let i = 0; i < 40; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/* --------------------------- message shapes --------------------------- */

export interface TrackerAnnounceMessage {
  action: "announce";
  info_hash: string; // 20 raw bytes, latin-1
  peer_id: string; // 20 raw bytes, latin-1
  port?: number;
  numwant?: number;
  compact: false;
  uploaded: number;
  downloaded: number;
  left: number;
}

export interface TrackerPeerEntry {
  /** Framework peer id decoded from the announce's `peer_id` field. */
  peerId: string;
  ip?: string;
  port?: number;
}

export interface TrackerAnnounceResponse {
  action: "announce";
  intervalSec: number;
  complete?: number;
  incomplete?: number;
  peers: TrackerPeerEntry[];
  /**
   * The announce's own `info_hash` (latin-1 field) attached by the parser.
   * The pool uses it to route each response to exactly one topic — two
   * rooms multiplexed on one socket never share peer results. Some
   * trackers do not echo it in the response; in that case the pool falls
   * back to last-pending routing (see TrackerPool).
   */
  infoHashField?: string;
}

export interface TrackerFailure {
  failureReason: string;
  /** Attached by the parser from the frame's `info_hash` when present. */
  infoHashField?: string;
}

export type TrackerResponse =
  | { kind: "announce"; value: TrackerAnnounceResponse }
  | { kind: "failure"; value: TrackerFailure };

/* ------------------------------- limits ------------------------------- */

/** Hard ceiling on accepted JSON payload size (bytes) — flood protection. */
export const MAX_TRACKER_MESSAGE_BYTES = 64 * 1024;
/** Maximum peer entries parsed from one announce response. */
export const MAX_TRACKER_PEERS_PER_RESPONSE = 200;
/** Minimum interval we will honor, even if a hostile tracker sends 0. */
export const MIN_TRACKER_INTERVAL_SEC = 30;
/** Announce responses without an interval fall back to this. */
export const DEFAULT_TRACKER_INTERVAL_SEC = 180;

export function buildAnnounce(
  infoHashField: string,
  peerIdField: string,
  opts: { numwant?: number; port?: number } = {},
): TrackerAnnounceMessage {
  const msg: TrackerAnnounceMessage = {
    action: "announce",
    info_hash: infoHashField,
    peer_id: peerIdField,
    compact: false,
    uploaded: 0,
    downloaded: 0,
    left: 0,
  };
  if (opts.numwant !== undefined) msg.numwant = opts.numwant;
  if (opts.port !== undefined) msg.port = opts.port;
  return msg;
}

export function encodeMessage(message: TrackerAnnounceMessage): string {
  return JSON.stringify(message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizePort(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 65535) {
    return undefined;
  }
  return v;
}

function sanitizeIp(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return undefined;
  // Only ever used as informational hint data; refuse anything odd.
  return /^[0-9a-fA-F:.]+$/.test(v) ? v : undefined;
}

/**
 * Parse one raw WebSocket frame into a validated tracker response.
 * Throws on any malformed/hostile input — callers must treat throws as
 * non-fatal per-message rejections and never trust unchecked fields.
 */
export function parseTrackerResponse(raw: string): TrackerResponse {
  if (raw.length > MAX_TRACKER_MESSAGE_BYTES) {
    throw new Error("tracker message exceeds size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from tracker");
  }
  if (!isPlainObject(parsed)) throw new Error("tracker message is not an object");

  const failure = parsed["failure reason"];
  if (typeof failure === "string") {
    const fail: TrackerFailure = { failureReason: failure.slice(0, 512) };
    const failHash = parsed["info_hash"];
    if (typeof failHash === "string") fail.infoHashField = failHash;
    return { kind: "failure", value: fail };
  }

  if (parsed["action"] !== "announce") {
    // Unknown/other actions (e.g. future signaling replies) are ignored by
    // the discovery layer but are surfaced as failures, never crashes.
    const name = String(parsed["action"] ?? "none").slice(0, 64);
    return { kind: "failure", value: { failureReason: `unsupported action: ${name}` } };
  }

  const intervalRaw = parsed["interval"];
  const intervalSec =
    typeof intervalRaw === "number" && Number.isFinite(intervalRaw)
      ? Math.max(MIN_TRACKER_INTERVAL_SEC, Math.floor(intervalRaw))
      : DEFAULT_TRACKER_INTERVAL_SEC;

  // Attach the frame's own info_hash (if any) so the pool can route this
  // response to exactly one topic. NOTE: we intentionally do NOT echo a
  // caller-supplied fallback here — doing so would let a hostile tracker
  // forge routing by omitting the hash on a misrouted frame. Omission is
  // handled safely by the pool's per-connection routing boundary instead.
  const echoedRaw = parsed["info_hash"];
  const echoed = typeof echoedRaw === "string" ? echoedRaw : undefined;

  const peers: TrackerPeerEntry[] = [];
  const rawPeers = parsed["peers"];
  if (Array.isArray(rawPeers)) {
    for (const entry of rawPeers.slice(0, MAX_TRACKER_PEERS_PER_RESPONSE)) {
      if (!isPlainObject(entry)) continue;
      const peerIdField = entry["peerId"] ?? entry["peer id"];
      if (typeof peerIdField !== "string" || peerIdField.length === 0) continue;
      const peerId = decodeTrackerField(peerIdField);
      if (peerId.length === 0) continue;
      const peer: TrackerPeerEntry = { peerId };
      const ip = sanitizeIp(entry["ip"]);
      if (ip !== undefined) peer.ip = ip;
      const port = sanitizePort(entry["port"]);
      if (port !== undefined) peer.port = port;
      peers.push(peer);
    }
  }

  const value: TrackerAnnounceResponse = { action: "announce", intervalSec, peers };
  if (typeof parsed["complete"] === "number") value.complete = parsed["complete"];
  if (typeof parsed["incomplete"] === "number") value.incomplete = parsed["incomplete"];
  if (echoed !== undefined) value.infoHashField = echoed;
  return { kind: "announce", value };
}
