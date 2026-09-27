/**
 * Deterministic discovery-namespace derivation (Phase 2).
 *
 * The ONLY place in the codebase where hashing lives. Maps a framework
 * `(appId, roomId)` pair onto the opaque 20-byte info-hash space that
 * WebTorrent-compatible trackers require:
 *
 *   topic = sha1(utf8("p2pfw:v1:" + appId + ":" + roomId))
 *
 * Properties:
 * - deterministic: every client computing it for the same app+room lands
 *   in the same tracker namespace;
 * - opaque: room names never appear on the wire in plaintext (this is
 *   privacy hygiene, NOT a security guarantee — SHA-1 here is used purely
 *   as an identifier mechanism);
 * - rooms are a framework concept: trackers only ever see info hashes.
 */

import { sha1 } from "../../core/sha1.js";

/** Namespace prefix keeps our info hashes disjoint from torrent swarms. */
const TOPIC_PREFIX = "p2pfw:v1:";

export interface DiscoveryTopic {
  /** Human-readable framework-level namespace key (not sent raw). */
  key: string;
  /** Lowercase 40-hex digest of the key. */
  hex: string;
  /** Exactly 20 raw bytes encoded as latin-1 — the tracker `info_hash`. */
  infoHashField: string;
}

/** Validate/normalize an appId or roomId used in namespace derivation. */
export function isValidNamespaceId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

/** Derive the (appId, roomId) discovery topic deterministically. */
export function deriveDiscoveryTopic(appId: string, roomId: string): DiscoveryTopic {
  if (!isValidNamespaceId(appId)) {
    throw new Error(`invalid appId for discovery topic: ${JSON.stringify(appId.slice(0, 80))}`);
  }
  if (!isValidNamespaceId(roomId)) {
    throw new Error(`invalid roomId for discovery topic: ${JSON.stringify(roomId.slice(0, 80))}`);
  }
  const key = `${TOPIC_PREFIX}${appId}:${roomId}`;
  const digest = sha1(new TextEncoder().encode(key));
  let hex = "";
  let field = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
    field += String.fromCharCode(byte);
  }
  return { key, hex, infoHashField: field };
}

/** Topic for app-wide (room-less) announcements. */
export function deriveAppTopic(appId: string): DiscoveryTopic {
  return deriveDiscoveryTopic(appId, "_app");
}
