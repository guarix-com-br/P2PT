class P2PError extends Error {
  /** Stable machine-readable code (e.g. `"NOT_IMPLEMENTED"`). */
  code;
  constructor(code, message) {
    super(message);
    this.name = "P2PError";
    this.code = code;
  }
}
class NotImplementedError extends P2PError {
  /** Target phase in which this feature becomes available (if planned). */
  phase;
  constructor(feature, phase) {
    super(
      "NOT_IMPLEMENTED",
      `${feature} is not implemented yet${phase !== void 0 ? ` (planned for Phase ${phase})` : ""}.`
    );
    this.name = "NotImplementedError";
    this.phase = phase;
  }
}
class ValidationError extends P2PError {
  constructor(message) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationError";
  }
}
class ConfigValidationError extends P2PError {
  /** Individual field-level problems, empty when the error is global. */
  issues;
  constructor(issues) {
    super(
      "CONFIG_INVALID",
      `Invalid configuration: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}
class TimeoutError extends P2PError {
  constructor(operation, timeoutMs) {
    super("TIMEOUT", `Operation "${operation}" timed out after ${timeoutMs}ms.`);
    this.name = "TimeoutError";
  }
}
class LimitExceededError extends P2PError {
  constructor(limit, value) {
    super("LIMIT_EXCEEDED", `Resource limit "${limit}" exceeded (current: ${value}).`);
    this.name = "LimitExceededError";
  }
}
const HEX = "0123456789abcdef";
function generateId(prefix, bytes = 12) {
  const random = getRandomBytes(bytes);
  let hex = "";
  for (const byte of random) {
    hex += HEX[byte >> 4] + HEX[byte & 15];
  }
  return `${prefix}-${hex}`;
}
function getRandomBytes(length) {
  const out = new Uint8Array(length);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
class TypedEventEmitter {
  listeners = /* @__PURE__ */ new Map();
  on(event, listener) {
    return this.add(event, listener, false);
  }
  once(event, listener) {
    return this.add(event, listener, true);
  }
  off(event, listener) {
    const set = this.listeners.get(event);
    if (!set) return this;
    for (const entry of set) {
      if (entry.fn === listener || entry.original === listener) {
        set.delete(entry);
        break;
      }
    }
    if (set.size === 0) this.listeners.delete(event);
    return this;
  }
  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      if (event === "error") {
        throw payload instanceof Error ? payload : new Error(String(payload));
      }
      return false;
    }
    let called = false;
    for (const entry of [...set]) {
      if (entry.once) {
        const current = this.listeners.get(event);
        current?.delete(entry);
        if (current && current.size === 0) this.listeners.delete(event);
      }
      try {
        entry.fn(payload);
        called = true;
      } catch (err) {
        queueMicrotask(() => {
          const errorKey = "error";
          if (this.listeners.has(errorKey)) {
            this.emit(errorKey, err);
          } else {
            throw err;
          }
        });
        called = true;
      }
    }
    return called;
  }
  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
  /** Remove all listeners for one event, or every listener when omitted. */
  removeAllListeners(event) {
    if (event === void 0) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }
  add(event, listener, once) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    const wrapped = listener;
    set.add({ fn: wrapped, once, original: wrapped });
    return this;
  }
}
const DEFAULT_LIMITS = {
  maxMessageSize: 256 * 1024,
  // 256 KiB — well under SCTP practical limits
  maxFileSize: 4 * 1024 * 1024 * 1024,
  // 4 GiB
  maxChunkSize: 16 * 1024,
  // 16 KiB — safe for all browsers' DataChannels
  maxConcurrentTransfers: 4,
  maxPendingRequests: 64,
  maxPeers: 20,
  // honest mesh ceiling; see ARCHITECTURE.md scalability note
  maxMessagesPerSecond: 200
};
const POSITIVE_INT_FIELDS = [
  "maxMessageSize",
  "maxFileSize",
  "maxChunkSize",
  "maxConcurrentTransfers",
  "maxPendingRequests",
  "maxPeers",
  "maxMessagesPerSecond"
];
function validateLimits(limits) {
  const issues = [];
  for (const key of POSITIVE_INT_FIELDS) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      issues.push({ path: `limits.${key}`, message: "must be a positive integer" });
    }
  }
  if (limits.maxChunkSize > limits.maxMessageSize) {
    issues.push({
      path: "limits.maxChunkSize",
      message: "must not exceed limits.maxMessageSize"
    });
  }
  return issues;
}
const DEFAULT_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];
const DEFAULTS = {
  peerName: "peer",
  metadata: {},
  trackers: [],
  signalingUrls: [],
  requestTimeoutMs: 1e4,
  transferTimeoutMs: 12e4,
  connectTimeoutMs: 3e4,
  reconnectAttempts: 5,
  reconnectBaseDelayMs: 500,
  reconnectMaxDelayMs: 3e4
};
function isPositiveInt(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function isValidTrackerUrl(url) {
  return /^wss?:\/\//i.test(url);
}
function isValidSignalingUrl(url) {
  return /^wss?:\/\//i.test(url);
}
function isValidIceServer(s) {
  if (typeof s !== "object" || s === null) return false;
  const urls = s.urls;
  const list = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : [];
  return list.length > 0 && list.every((u) => /^(stuns?|turns?):[A-Za-z0-9.\-_]+(:\d+)?(\/|\?|$)/.test(u));
}
function resolveConfig(input) {
  const issues = [];
  if (typeof input.appId !== "string" || input.appId.trim() === "") {
    issues.push({ path: "appId", message: "is required and must be a non-empty string" });
  }
  if (input.peerId !== void 0 && typeof input.peerId !== "string") {
    issues.push({ path: "peerId", message: "must be a string" });
  }
  if (input.peerName !== void 0 && typeof input.peerName !== "string") {
    issues.push({ path: "peerName", message: "must be a string" });
  }
  const numericFields = [
    "requestTimeoutMs",
    "transferTimeoutMs",
    "connectTimeoutMs",
    "reconnectBaseDelayMs",
    "reconnectMaxDelayMs"
  ];
  for (const field of numericFields) {
    const v = input[field];
    if (v !== void 0 && !isPositiveInt(v)) {
      issues.push({ path: field, message: "must be a positive integer (ms)" });
    }
  }
  if (input.reconnectAttempts !== void 0 && !isPositiveInt(input.reconnectAttempts)) {
    issues.push({ path: "reconnectAttempts", message: "must be a positive integer" });
  }
  const trackers = input.trackers ?? DEFAULTS.trackers;
  if (!trackers.every(isValidTrackerUrl)) {
    issues.push({
      path: "trackers",
      message: 'entries must be ws:// or wss:// URLs ("tracker:" scheme not supported)'
    });
  }
  const signalingUrls = input.signalingUrls ?? DEFAULTS.signalingUrls;
  if (!signalingUrls.every(isValidSignalingUrl)) {
    issues.push({
      path: "signalingUrls",
      message: "entries must be ws:// or wss:// URLs"
    });
  }
  const iceServers = input.iceServers ?? [...DEFAULT_ICE_SERVERS];
  if (!iceServers.every(isValidIceServer)) {
    issues.push({
      path: "iceServers",
      message: "entries need `urls` with stun:/stuns:/turn:/turns: schemes"
    });
  }
  const limits = { ...DEFAULT_LIMITS, ...input.limits ?? {} };
  issues.push(...validateLimits(limits));
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return {
    appId: input.appId,
    peerName: input.peerName ?? DEFAULTS.peerName,
    peerId: input.peerId,
    metadata: { ...DEFAULTS.metadata, ...input.metadata },
    trackers: [...trackers],
    signalingUrls: [...signalingUrls],
    iceServers: iceServers.map((s) => ({ ...s })),
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    transferTimeoutMs: input.transferTimeoutMs ?? DEFAULTS.transferTimeoutMs,
    connectTimeoutMs: input.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
    reconnectAttempts: input.reconnectAttempts ?? DEFAULTS.reconnectAttempts,
    reconnectBaseDelayMs: input.reconnectBaseDelayMs ?? DEFAULTS.reconnectBaseDelayMs,
    reconnectMaxDelayMs: input.reconnectMaxDelayMs ?? DEFAULTS.reconnectMaxDelayMs,
    limits
  };
}
const PATH_SYMBOL = Symbol("notReadyPath");
const ASYNC_NAME = /^(get|watch)/;
function notReady(path, phase) {
  const makeNode = (nodePath) => {
    const noop = (..._args) => void 0;
    return new Proxy(noop, {
      apply(_target, _thisArg, _args) {
        if (ASYNC_NAME.test(nodePath.slice(nodePath.lastIndexOf(".") + 1))) {
          return Promise.reject(new NotImplementedError(`${nodePath}()`, phase));
        }
        throw new NotImplementedError(`${nodePath}()`, phase);
      },
      get(_target, prop) {
        if (prop === PATH_SYMBOL) return nodePath;
        if (typeof prop === "symbol" || prop === "then") return void 0;
        if (prop === "name" || prop === "length") {
          return prop === "name" ? nodePath.slice(nodePath.lastIndexOf(".") + 1) : 0;
        }
        return makeNode(`${nodePath}.${String(prop)}`);
      }
    });
  };
  return makeNode(path);
}
class P2PClient extends TypedEventEmitter {
  config;
  /** Stable local identity for this client instance. */
  id;
  metadata;
  #closed = false;
  /** Control-plane facades (implemented Phases 2–4, 13). */
  control;
  /** Data-plane facade (implemented Phases 5–8). */
  data;
  /** Media-plane facade (implemented Phases 9–12). */
  media;
  /** Diagnostics facade (implemented Phase 15). */
  stats;
  #rooms = /* @__PURE__ */ new Map();
  #peers = /* @__PURE__ */ new Map();
  constructor(input) {
    super();
    this.config = resolveConfig(input);
    this.id = this.config.peerId ?? generateId("peer");
    this.metadata = { name: this.config.peerName, ...this.config.metadata };
    this.control = notReady("client.control", 2);
    this.data = notReady("client.data", 5);
    this.media = notReady("client.media", 9);
    this.stats = notReady("client.stats", 15);
  }
  get closed() {
    return this.#closed;
  }
  /**
   * Join a room: announces membership through discovery and connects to
   * existing members. Implemented in Phase 13 on top of Phases 2–4.
   */
  joinRoom(_roomId, _metadata) {
    throw new NotImplementedError("P2PClient.joinRoom()", 13);
  }
  leaveRoom(_roomId) {
    throw new NotImplementedError("P2PClient.leaveRoom()", 13);
  }
  getRoom(roomId) {
    return this.#rooms.get(roomId);
  }
  /** Directly connect to a known peer id (bypasses discovery). */
  connectTo(_peerId, _options) {
    throw new NotImplementedError("P2PClient.connectTo()", 4);
  }
  disconnectFrom(peerId) {
    const peer = this.#peers.get(peerId);
    if (!peer) return Promise.resolve();
    return peer.disconnect();
  }
  getPeer(peerId) {
    return this.#peers.get(peerId);
  }
  getPeers() {
    return [...this.#peers.values()];
  }
  /** Update local presence status broadcast (Phase 13). */
  setPresenceStatus(_status) {
    throw new NotImplementedError("P2PClient.setPresenceStatus()", 13);
  }
  /** Deterministic shutdown: closes transports, providers and listeners. */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#peers.clear();
    this.#rooms.clear();
    this.removeAllListeners();
  }
  /* ----------------------------- internal ------------------------------ */
  /** @internal register a peer object created by ConnectionManager later. */
  _registerPeer(peer, roomId) {
    this.#peers.set(peer.id, peer);
    if (roomId) this.#rooms.get(roomId)?.peers.set(peer.id, peer);
  }
}
class Peer {
  id;
  roomId;
  #metadata;
  #capabilities;
  #state;
  #messaging;
  #rpc;
  /** @internal — created only by `P2PClient`. */
  constructor(init) {
    this.id = init.id;
    this.roomId = init.roomId;
    this.#metadata = init.metadata;
    this.#capabilities = init.capabilities ?? [];
    this.#state = init.state ?? "new";
    this.#messaging = init.messaging;
    this.#rpc = init.rpc;
  }
  get state() {
    return this.#state;
  }
  get metadata() {
    return this.#metadata;
  }
  get capabilities() {
    return this.#capabilities;
  }
  /** True when the remote advertises `name` at or above `minVersion`. */
  supports(name, minVersion = 1) {
    return this.#capabilities.some((c) => c.name === name && c.version >= minVersion);
  }
  /* ----------------------- delegated data plane ----------------------- */
  sendMessage(message) {
    return this.#messaging.sendMessage(message);
  }
  request(method, params) {
    return this.#rpc.request(method, params);
  }
  /* --------------------------- not yet live --------------------------- */
  /** Implemented in Phase 8 (File Transfer). */
  sendFile(_source, _metadata) {
    throw new NotImplementedError("Peer.sendFile()", 8);
  }
  /** Implemented in Phase 13 (Rooms and Presence). */
  getPresence() {
    throw new NotImplementedError("Peer.getPresence()", 13);
  }
  /** Implemented in Phase 4 (WebRTC Transport). */
  disconnect() {
    throw new NotImplementedError("Peer.disconnect()", 4);
  }
  /** @internal used by ConnectionManager as transports come online. */
  _updateState(state) {
    this.#state = state;
  }
  /** @internal */
  _updateCapabilities(capabilities) {
    this.#capabilities = capabilities;
  }
}
class Room {
  id;
  metadata;
  /** Live peer registry maintained by P2PClient as connections arrive. */
  peers = /* @__PURE__ */ new Map();
  /** @internal — created only by `P2PClient`. */
  constructor(init) {
    this.id = init.id;
    this.metadata = init.metadata ?? {};
  }
  get size() {
    return this.peers.size;
  }
  getPeers() {
    return [...this.peers.values()];
  }
  getPeer(peerId) {
    return this.peers.get(peerId);
  }
  /** Broadcast a message to every peer in the room (Phase 5). */
  broadcast(_message) {
    throw new NotImplementedError("Room.broadcast()", 5);
  }
  /** Leave via the owning client; kept here for API ergonomics (Phase 13). */
  leave() {
    throw new NotImplementedError("Room.leave() — use P2PClient.leaveRoom()", 13);
  }
}
const CHANNEL_NAMES = ["control", "messages", "rpc", "files", "sync"];
const DEFAULT_CHANNEL_RELIABILITY = {
  control: "reliable-ordered",
  messages: "reliable-ordered",
  rpc: "reliable-ordered",
  files: "reliable-ordered",
  sync: "reliable-unordered"
};
function isChannelName(value) {
  return CHANNEL_NAMES.includes(value);
}
const KnownCapability = {
  Messaging: "messaging",
  Binary: "binary",
  Files: "files",
  Rpc: "rpc",
  Audio: "audio",
  Video: "video",
  ScreenShare: "screenShare",
  StateSync: "stateSync"
};
const MessageType = {
  /* control plane (0x00xx reserved for handshake/ping) */
  HELLO: 1,
  HELLO_ACK: 2,
  PING: 3,
  PONG: 4,
  CAPABILITY_UPDATE: 5,
  PRESENCE_UPDATE: 6,
  /* messaging (spec §14) */
  MESSAGE: 257,
  MESSAGE_ACK: 258,
  /* rpc (spec §15) */
  RPC_REQUEST: 513,
  RPC_RESPONSE: 514,
  RPC_ERROR: 515,
  RPC_CANCEL: 516,
  /* file transfer (spec §17) */
  FILE_START: 769,
  FILE_ACCEPT: 770,
  FILE_CHUNK: 771,
  FILE_ACK: 772,
  FILE_PAUSE: 773,
  FILE_RESUME: 774,
  FILE_CANCEL: 775,
  FILE_COMPLETE: 776,
  FILE_ERROR: 777,
  /* state synchronization */
  SYNC_SNAPSHOT: 1025,
  SYNC_DELTA: 1026,
  SYNC_REQUEST: 1027
};
const FrameFlags = {
  /** Payload is UTF-8 JSON; otherwise it is opaque binary. */
  JSON_PAYLOAD: 1,
  /** Compressed payload (algorithm negotiated via capabilities). */
  COMPRESSED: 2,
  /** Marks the final frame of a streamed message. */
  FIN: 4
};
const PROTOCOL_VERSION = 1;
const MIN_SUPPORTED_PROTOCOL_VERSION = 1;
function isSupportedProtocolVersion(version) {
  return Number.isInteger(version) && version >= MIN_SUPPORTED_PROTOCOL_VERSION && version <= PROTOCOL_VERSION;
}
export {
  CHANNEL_NAMES,
  ConfigValidationError,
  DEFAULT_CHANNEL_RELIABILITY,
  DEFAULT_ICE_SERVERS,
  DEFAULT_LIMITS,
  FrameFlags,
  KnownCapability,
  LimitExceededError,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  MessageType,
  NotImplementedError,
  P2PClient,
  P2PError,
  PROTOCOL_VERSION,
  Peer,
  Room,
  TimeoutError,
  TypedEventEmitter,
  ValidationError,
  generateId,
  isChannelName,
  isSupportedProtocolVersion,
  resolveConfig,
  validateLimits
};
//# sourceMappingURL=index.js.map
