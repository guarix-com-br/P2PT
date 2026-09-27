/**
 * Signaling provider abstraction (spec §8, Phase 1 interfaces only).
 *
 * Signaling carries ONLY SDP offers/answers and ICE candidates between peers
 * (via tracker int messages, a WebSocket relay, or a custom channel). It is
 * never used for application data. Providers must be interchangeable.
 */

/** SDP blob exchanged during negotiation (kept structurally minimal). */
export interface SignalDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface SignalCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export type SignalPayload =
  | { kind: "sdp"; description: SignalDescription }
  | { kind: "ice"; candidate: SignalCandidate };

export type SignalingMessage = {
  /** Protocol-level envelope; `id` correlates multi-part exchanges. */
  v: 1;
  id: string;
  from: string;
  to: string;
  roomId?: string;
  /** Monotonic per sender; receivers drop stale/duplicate rounds. */
  round: number;
  payload: SignalPayload;
};

export interface SignalingTarget {
  peerId: string;
  roomId?: string;
}

export interface SignalingProviderEvents {
  message: SignalingMessage;
  error: Error;
}

export interface SignalingProvider {
  readonly id: string;
  readonly connected: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Deliver a signaling message to one target (or all room members). */
  send(target: SignalingTarget | "room", message: SignalingMessage): Promise<void>;

  on<E extends keyof SignalingProviderEvents>(
    event: E,
    handler: (payload: SignalingProviderEvents[E]) => void,
  ): () => void;
}
