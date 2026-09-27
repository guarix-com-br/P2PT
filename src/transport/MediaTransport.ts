/**
 * MediaTransport — the media-plane-facing transport contract (spec §24).
 *
 * Deliberately expressed in terms of abstract `MediaTrack` handles rather
 * than raw `MediaStreamTrack`, so the same manager code works over mesh
 * WebRTC today and an SFU tomorrow. Audio/video NEVER travel on
 * DataChannels; they travel on tracks provided by the host runtime.
 */

import type { ConnectionState, Transport } from "./Transport.js";

export type MediaKind = "audio" | "video" | "screen";

/** Opaque handle for a media track managed by the framework. */
export interface ManagedMediaTrack<TTrack = unknown> {
  readonly id: string;
  readonly kind: MediaKind;
  readonly track: TTrack;
  enabled: boolean;
}

export interface MediaTransportEvents {
  stateChange: { next: ConnectionState; previous: ConnectionState };
  /** A remote track arrived that the local side did not request. */
  remoteTrack: { trackId: string; kind: MediaKind; track: unknown };
  error: Error;
}

export interface MediaTransport<
  TTrack = unknown,
  TStream = unknown,
> extends Transport<ConnectionState> {
  /** Attach a locally-produced track (mic, camera, screen) for sending. */
  addTrack(kind: MediaKind, track: TTrack): Promise<ManagedMediaTrack<TTrack>>;
  /** Stop sending a previously attached track. */
  removeTrack(trackId: string): Promise<void>;
  /** Swap the underlying track (e.g. camera → screen) without renegotiating. */
  replaceTrack(trackId: string, track: TTrack): Promise<void>;
  /** Obtain a playable object for a remote track (e.g. MediaStream). */
  renderRemoteTrack(trackId: string): TStream;
  /** Enumerate currently known remote tracks. */
  listRemoteTracks(): ReadonlyArray<{ trackId: string; kind: MediaKind }>;

  on<E extends keyof MediaTransportEvents>(
    event: E,
    handler: (payload: MediaTransportEvents[E]) => void,
  ): () => void;
}
