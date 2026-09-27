/**
 * Configuration system (spec §33, Phase 1 — fully functional).
 *
 * `resolveConfig()` merges user input over defaults and validates every
 * field, producing structured `ConfigValidationError` issues. All timeouts
 * and limits are centralized here so no manager invents its own magic
 * numbers.
 */

import { ConfigValidationError } from "../core/errors.js";
import {
  DEFAULT_LIMITS,
  validateLimits,
  type ResourceLimits,
} from "../security/Limits.js";

/** ICE server entry — structurally compatible with RTCIceServer. */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface P2PConfigInput {
  /** Application namespace used by discovery (required). */
  appId: string;
  /** Human-readable name announced in metadata. */
  peerName?: string;
  /** Override the generated peer id (advanced/testing use). */
  peerId?: string;
  /** Optional extra fields merged into advertised peer metadata. */
  metadata?: Record<string, string | number | boolean>;

  /* Discovery / signaling (Phase 2/3 consume these). */
  trackers?: string[];
  signalingUrls?: string[];
  /**
   * When true (default), every `trackers` entry spawns a WebTorrent-
   * compatible discovery provider at client construction. Set false to
   * register providers manually via `client.control.discovery.addProvider`.
   */
  autoDiscover?: boolean;

  /**
   * Phase 2 discovery tuning (all optional; sensible validated defaults).
   * `peerTtlMs` lives in `limits`, so TTL policy is configured there.
   */
  discovery?: {
    /** Floor for announce refresh even if a tracker reports less (sec). */
    minAnnounceIntervalSec?: number;
    /** Safety cap on our own periodic re-announce period (sec). */
    maxAnnounceIntervalSec?: number;
    /** Peers requested per tracker announce. */
    numwant?: number;
    /** How many stale entries to remember for silent-drop suppression. */
    recentlyGoneCapacity?: number;
  };

  /* NAT traversal (spec §30). */
  iceServers?: IceServerConfig[];

  /* Timeouts & recovery (spec §29). */
  requestTimeoutMs?: number;
  transferTimeoutMs?: number;
  connectTimeoutMs?: number;
  reconnectAttempts?: number;
  /** First backoff delay for reconnect cycles (doubles each attempt). */
  reconnectBaseDelayMs?: number;
  /** Hard cap on exponential backoff. */
  reconnectMaxDelayMs?: number;

  /* Resource protection (spec §33). */
  limits?: Partial<ResourceLimits>;
}

export interface ResolvedP2PConfig {
  appId: string;
  peerName: string;
  peerId?: string;
  metadata: Record<string, string | number | boolean>;
  trackers: string[];
  signalingUrls: string[];
  autoDiscover: boolean;
  discovery: {
    minAnnounceIntervalSec: number;
    maxAnnounceIntervalSec: number;
    numwant: number;
    recentlyGoneCapacity: number;
  };
  iceServers: IceServerConfig[];
  requestTimeoutMs: number;
  transferTimeoutMs: number;
  connectTimeoutMs: number;
  reconnectAttempts: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  limits: ResourceLimits;
}

/** Default public STUN servers; production deployments should add TURN. */
export const DEFAULT_ICE_SERVERS: readonly IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const DEFAULTS = {
  peerName: "peer",
  metadata: {},
  trackers: [],
  signalingUrls: [],
  autoDiscover: true,
  requestTimeoutMs: 10_000,
  transferTimeoutMs: 120_000,
  connectTimeoutMs: 30_000,
  reconnectAttempts: 5,
  reconnectBaseDelayMs: 500,
  reconnectMaxDelayMs: 30_000,
} as const;

const DEFAULT_DISCOVERY = {
  minAnnounceIntervalSec: 30,
  maxAnnounceIntervalSec: 1800,
  numwant: 50,
  recentlyGoneCapacity: 256,
} as const;

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

function isValidTrackerUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url);
}

function isValidSignalingUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url);
}

function isValidIceServer(s: unknown): s is IceServerConfig {
  if (typeof s !== "object" || s === null) return false;
  const urls = (s as IceServerConfig).urls;
  const list = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : [];
  // RFC 7064/7531 forms: stun:host[:port], turns:host[:port][?transport=udp],
  // turn:host[:port]?transport=... — the authority may be a bare host.
  return (
    list.length > 0 &&
    list.every((u) => /^(stuns?|turns?):[A-Za-z0-9.\-_]+(:\d+)?(\/|\?|$)/.test(u))
  );
}

/**
 * Merge user config over defaults and validate. Throws
 * `ConfigValidationError` listing every problem at once.
 */
export function resolveConfig(input: P2PConfigInput): ResolvedP2PConfig {
  const issues: { path: string; message: string }[] = [];

  if (typeof input.appId !== "string" || input.appId.trim() === "") {
    issues.push({ path: "appId", message: "is required and must be a non-empty string" });
  }
  if (input.peerId !== undefined && typeof input.peerId !== "string") {
    issues.push({ path: "peerId", message: "must be a string" });
  }
  if (input.peerName !== undefined && typeof input.peerName !== "string") {
    issues.push({ path: "peerName", message: "must be a string" });
  }
  if (input.autoDiscover !== undefined && typeof input.autoDiscover !== "boolean") {
    issues.push({ path: "autoDiscover", message: "must be a boolean" });
  }

  const numericFields = [
    "requestTimeoutMs",
    "transferTimeoutMs",
    "connectTimeoutMs",
    "reconnectBaseDelayMs",
    "reconnectMaxDelayMs",
  ] as const;
  for (const field of numericFields) {
    const v = input[field];
    if (v !== undefined && !isPositiveInt(v)) {
      issues.push({ path: field, message: "must be a positive integer (ms)" });
    }
  }
  if (input.reconnectAttempts !== undefined && !isPositiveInt(input.reconnectAttempts)) {
    issues.push({ path: "reconnectAttempts", message: "must be a positive integer" });
  }

  const discovery = {
    minAnnounceIntervalSec:
      input.discovery?.minAnnounceIntervalSec ?? DEFAULT_DISCOVERY.minAnnounceIntervalSec,
    maxAnnounceIntervalSec:
      input.discovery?.maxAnnounceIntervalSec ?? DEFAULT_DISCOVERY.maxAnnounceIntervalSec,
    numwant: input.discovery?.numwant ?? DEFAULT_DISCOVERY.numwant,
    recentlyGoneCapacity:
      input.discovery?.recentlyGoneCapacity ?? DEFAULT_DISCOVERY.recentlyGoneCapacity,
  };
  for (const field of [
    "minAnnounceIntervalSec",
    "maxAnnounceIntervalSec",
    "numwant",
    "recentlyGoneCapacity",
  ] as const) {
    if (!isPositiveInt(discovery[field])) {
      issues.push({ path: `discovery.${field}`, message: "must be a positive integer" });
    }
  }
  if (
    issues.length === 0 &&
    discovery.minAnnounceIntervalSec > discovery.maxAnnounceIntervalSec
  ) {
    issues.push({
      path: "discovery.minAnnounceIntervalSec",
      message: "must not exceed discovery.maxAnnounceIntervalSec",
    });
  }

  const trackers = input.trackers ?? DEFAULTS.trackers;
  if (!trackers.every(isValidTrackerUrl)) {
    issues.push({
      path: "trackers",
      message: 'entries must be ws:// or wss:// URLs ("tracker:" scheme not supported)',
    });
  }
  const signalingUrls = input.signalingUrls ?? DEFAULTS.signalingUrls;
  if (!signalingUrls.every(isValidSignalingUrl)) {
    issues.push({
      path: "signalingUrls",
      message: "entries must be ws:// or wss:// URLs",
    });
  }
  const iceServers = input.iceServers ?? [...DEFAULT_ICE_SERVERS];
  if (!iceServers.every(isValidIceServer)) {
    issues.push({
      path: "iceServers",
      message: "entries need `urls` with stun:/stuns:/turn:/turns: schemes",
    });
  }

  const limits: ResourceLimits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  issues.push(...validateLimits(limits));

  if (issues.length > 0) throw new ConfigValidationError(issues);

  return {
    appId: input.appId,
    peerName: input.peerName ?? DEFAULTS.peerName,
    peerId: input.peerId,
    metadata: { ...DEFAULTS.metadata, ...input.metadata },
    trackers: [...trackers],
    signalingUrls: [...signalingUrls],
    autoDiscover: input.autoDiscover ?? DEFAULTS.autoDiscover,
    discovery,
    iceServers: iceServers.map((s) => ({ ...s })),
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    transferTimeoutMs: input.transferTimeoutMs ?? DEFAULTS.transferTimeoutMs,
    connectTimeoutMs: input.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
    reconnectAttempts: input.reconnectAttempts ?? DEFAULTS.reconnectAttempts,
    reconnectBaseDelayMs: input.reconnectBaseDelayMs ?? DEFAULTS.reconnectBaseDelayMs,
    reconnectMaxDelayMs: input.reconnectMaxDelayMs ?? DEFAULTS.reconnectMaxDelayMs,
    limits,
  };
}
