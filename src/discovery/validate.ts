/**
 * Validation of untrusted discovery data (Phase 2).
 *
 * Every peer hit produced by a provider — tracker announce lists, WebSocket
 * servers, user-supplied providers — passes through these guards before the
 * `DiscoveryManager` stores or re-publishes it. Rejections are returned as
 * structured results (never thrown) so a hostile provider can take down at
 * most one hit, never the manager.
 */

import type { DiscoveredPeer } from "./DiscoveryProvider.js";
import type { PeerMetadata } from "../core/Peer.js";
import { isValidNamespaceId } from "./trackers/infoHash.js";

/** Hard ceilings for accepted metadata (bytes / entries). */
export const MAX_METADATA_VALUE_BYTES = 512;
export const MAX_METADATA_KEYS = 16;
/** Upper bound on a single provider's hint payload size (JSON bytes). */
export const MAX_HINTS_JSON_BYTES = 2048;

export interface ValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly reason?: string;
}

function reject(reason: string): ValidationResult<never> {
  return { ok: false, reason };
}

/** Framework peer ids: `peer-<hex>` normally, but any sane id is allowed. */
export function isValidPeerId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function validateMetadata(
  metadata: unknown,
  peerIdForName: string,
): ValidationResult<PeerMetadata | undefined> {
  if (metadata === undefined || metadata === null) return { ok: true, value: undefined };
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return reject("metadata must be an object");
  }
  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) return reject("too many metadata keys");
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!isValidNamespaceId(key)) return reject(`invalid metadata key ${JSON.stringify(key.slice(0, 70))}`);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return reject(`metadata.${key} must be finite`);
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      if (value.length > MAX_METADATA_VALUE_BYTES) return reject(`metadata.${key} too large`);
      out[key] = value;
    } else {
      return reject(`metadata.${key} has unsupported type`);
    }
  }
  // `name` is required by PeerMetadata; derive a stable fallback from the
  // peer id rather than flattening every discovered peer to "unknown" —
  // that keeps metadata-change detection meaningful across providers.
  if (typeof out["name"] !== "string") {
    out["name"] = peerIdForName.slice(0, 24);
  }
  return { ok: true, value: out as PeerMetadata };
}

/**
 * Validate one raw hit from a provider against the `DiscoveredPeer`
 * contract. Returns a normalized copy (unknown fields dropped) or a
 * rejection reason.
 */
export function validateDiscoveredPeer(raw: unknown): ValidationResult<DiscoveredPeer> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return reject("peer record must be an object");
  }
  const rec = raw as Record<string, unknown>;

  if (!isValidPeerId(rec["peerId"])) {
    return reject("invalid peerId");
  }
  if (typeof rec["appId"] !== "string" || !isValidNamespaceId(rec["appId"])) {
    return reject("invalid appId");
  }
  const roomId = rec["roomId"];
  if (roomId !== undefined && (typeof roomId !== "string" || !isValidNamespaceId(roomId))) {
    return reject("invalid roomId");
  }

  const meta = validateMetadata(rec["metadata"], rec["peerId"] as string);
  if (!meta.ok) return reject(meta.reason!);

  let hints: Record<string, unknown> | undefined;
  const rawHints = rec["hints"];
  if (rawHints !== undefined && rawHints !== null) {
    if (typeof rawHints !== "object" || Array.isArray(rawHints)) {
      return reject("hints must be an object");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(rawHints);
    } catch {
      return reject("hints not serializable");
    }
    if (serialized.length > MAX_HINTS_JSON_BYTES) return reject("hints too large");
    hints = rawHints as Record<string, unknown>;
  }

  const value: DiscoveredPeer = {
    peerId: rec["peerId"],
    appId: rec["appId"],
  };
  if (typeof roomId === "string") value.roomId = roomId;
  if (meta.value !== undefined) value.metadata = meta.value;
  if (hints !== undefined) value.hints = hints;
  return { ok: true, value };
}

/** Validate a room identifier used in join/leave scope operations. */
export function validateRoomId(roomId: unknown): roomId is string {
  return typeof roomId === "string" && isValidNamespaceId(roomId);
}
