/**
 * Transport Layer — base contracts (spec §5, Phase 1).
 *
 * The application layer must never depend on `RTCPeerConnection` directly.
 * Everything below the data/media planes talks through these interfaces, so
 * a future SFU or WebTransport/QUIC implementation can be dropped in without
 * rewriting the protocol above.
 */

import type { ChannelName } from "./channels.js";

/**
 * Connection lifecycle states (spec §10). These intentionally mirror the
 * union of `RTCPeerConnectionState` / `RTCDataChannelState` names used by
 * browsers so the WebRTC adapter in Phase 4 is a thin mapping.
 */
export type ConnectionState =
  "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

/** Generic transport state-change listener. */
export type StateChangeHandler<S extends string> = (next: S, previous: S) => void;

/**
 * Minimal contract shared by every transport implementation.
 * Conceptually matches spec §5; refined here into separate data and media
 * concerns (`DataTransport`, `MediaTransport`).
 */
export interface Transport<S extends string = ConnectionState> {
  /** Current lifecycle state. */
  readonly state: S;
  /** Tear the transport down deterministically and release all resources. */
  close(): Promise<void>;
  /** Subscribe to state changes. Return the given unsubscribe function. */
  onStateChange(handler: StateChangeHandler<S>): () => void;
}

/** Options accepted when opening a logical channel (WebRTC-agnostic). */
export interface ChannelOpenOptions {
  /** Retransmission window for partially reliable channels (SCTON). */
  maxRetransmits?: number;
  /** Lifetime limit in ms for partially reliable channels. */
  maxPacketLifeTime?: number;
}

/**
 * A single logical, message-oriented channel carried by a `DataTransport`.
 * Payloads are opaque `Uint8Array` frames — encoding is the Data Plane's job.
 */
export interface DataChannelLike {
  /** Logical channel name (control | messages | rpc | files | sync). */
  readonly name: ChannelName;
  readonly ordered: boolean;
  readonly readyState: ConnectionState;
  /** Buffered amount in bytes, used for backpressure decisions. */
  readonly bufferedAmount: number;
  /** Upper bound the transport advertises for a single message. */
  readonly maxMessageSize: number;
  send(data: Uint8Array): void;
  close(): void;
  onData(handler: (data: Uint8Array) => void): () => void;
  onStateChange(handler: StateChangeHandler<ConnectionState>): () => void;
}
