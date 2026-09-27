/**
 * DataTransport — the data-plane-facing transport contract (Phase 1).
 *
 * Implemented first by `WebRTCTransport` (Phase 4) and later by
 * `SFUTransport` / `WebTransportTransport` without changing anything above
 * this interface.
 */

import type { ChannelName } from "./channels.js";
import type {
  ChannelOpenOptions,
  ConnectionState,
  DataChannelLike,
  Transport,
} from "./Transport.js";

export interface DataTransportEvents {
  stateChange: { next: ConnectionState; previous: ConnectionState };
  /** Remote-initiated channel open (for offerers/answerers alike). */
  incomingChannel: DataChannelLike;
  error: Error;
}

export interface DataTransport extends Transport<ConnectionState> {
  /** Local peer id this transport is bound to. */
  readonly localPeerId: string;
  /** Remote peer id (known once signaling has identified the peer). */
  readonly remotePeerId: string | undefined;

  /** Open (or wait for) a logical channel. Resolves when usable. */
  openChannel(name: ChannelName, options?: ChannelOpenOptions): Promise<DataChannelLike>;

  /** Get an already-open logical channel, if any. */
  getChannel(name: ChannelName): DataChannelLike | undefined;

  /** Subscribe to transport events. Returns an unsubscribe function. */
  on<E extends keyof DataTransportEvents>(
    event: E,
    handler: (payload: DataTransportEvents[E]) => void,
  ): () => void;
}
