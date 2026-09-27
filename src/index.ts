/**
 * Public API surface of the P2P framework (Phase 1).
 *
 * Exports are curated deliberately: applications get the client, the peer/
 * room handles, configuration, events and every plane's contract types.
 * Internal machinery is not part of this surface (spec §36: minimal APIs).
 */

/* Core */
export { P2PClient, type ConnectOptions } from "./core/P2PClient.js";
export { Peer, type PeerInit, type PeerMetadata } from "./core/Peer.js";
export { Room, type RoomId, type RoomMetadata, type RoomInit } from "./core/Room.js";
export { generateId } from "./core/ids.js";
export {
  TypedEventEmitter,
  type P2PEvents,
  type EventName,
  type EventPayload,
  type Listener,
  type DiscoveredPeerInfo,
} from "./core/events.js";
export {
  P2PError,
  NotImplementedError,
  ValidationError,
  ConfigValidationError,
  TimeoutError,
  LimitExceededError,
  type ConfigIssue,
} from "./core/errors.js";

/* Configuration */
export {
  resolveConfig,
  DEFAULT_ICE_SERVERS,
  type P2PConfigInput,
  type ResolvedP2PConfig,
  type IceServerConfig,
} from "./config/Config.js";

/* Transport layer */
export type {
  Transport,
  DataChannelLike,
  ChannelOpenOptions,
  ConnectionState,
  StateChangeHandler,
} from "./transport/Transport.js";
export type { DataTransport, DataTransportEvents } from "./transport/DataTransport.js";
export type {
  MediaTransport,
  MediaTransportEvents,
  MediaKind,
  ManagedMediaTrack,
} from "./transport/MediaTransport.js";
export {
  CHANNEL_NAMES,
  DEFAULT_CHANNEL_RELIABILITY,
  isChannelName,
  type ChannelName,
  type ChannelReliability,
} from "./transport/channels.js";

/* Control plane */
export type {
  ControlPlaneApi,
  DiscoveryManagerApi,
  SignalingManagerApi,
  ConnectionManagerApi,
  ConnectionManagerEvents,
  ConnectionInfo,
} from "./control/ControlPlane.js";

/* Discovery & signaling contracts */
export type {
  DiscoveryProvider,
  DiscoveryProviderEvents,
  DiscoveryProviderState,
  DiscoveryStartOptions,
  DiscoveryEvent,
  DiscoveredPeer,
} from "./discovery/DiscoveryProvider.js";
export type {
  SignalingProvider,
  SignalingProviderEvents,
  SignalingMessage,
  SignalDescription,
  SignalCandidate,
  SignalPayload,
  SignalingTarget,
} from "./signaling/SignalingProvider.js";

/* Capabilities & presence */
export {
  KnownCapability,
  type Capability,
  type CapabilityName,
  type CapabilitySet,
} from "./capability/types.js";
export type {
  PresenceManager,
  PresenceManagerEvents,
  PresenceRecord,
  PresenceStatus,
} from "./presence/types.js";

/* Data plane */
export type {
  DataPlaneApi,
  MessagingApi,
  RpcApi,
  StateSyncApi,
  Message,
  MessagePayload,
  JsonValue,
  SendMessageOptions,
  MessageSubscription,
  RpcRequestInfo,
  RpcResponseInfo,
  RpcCallOptions,
  RpcRegistration,
} from "./data/DataPlane.js";

/* File transfer & streaming */
export type {
  TransferId,
  TransferMetadata,
  FileTransferProgress,
  TransferErrorInfo,
  TransferDirection,
  TransferState,
  FileTransferHandle,
  StreamId,
  BinaryStreamOptions,
  StreamHandle,
} from "./transfer/types.js";

/* Media plane */
export type {
  MediaPlaneApi,
  AudioManagerApi,
  VideoManagerApi,
  ScreenShareManagerApi,
  AudioConstraints,
  VideoConstraints,
  ScreenShareConstraints,
  RemoteTrackInfo,
  MediaManagerBase,
} from "./media/MediaPlane.js";

/* Protocol constants (stable wire contract) */
export {
  MessageType,
  FrameFlags,
  type MessageTypeValue,
} from "./protocol/MessageTypes.js";
export {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  isSupportedProtocolVersion,
} from "./protocol/ProtocolVersion.js";

/* Stats & security */
export type { PeerNetworkStats, StatsManagerApi } from "./stats/StatsManager.js";
export {
  DEFAULT_LIMITS,
  validateLimits,
  type ResourceLimits,
  type RateLimiter,
} from "./security/Limits.js";
