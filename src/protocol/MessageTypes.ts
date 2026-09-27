/**
 * Message type registry for the binary protocol (spec §13, §17, Phase 1).
 *
 * These constants are part of the stable wire contract — values must never
 * be renumbered, only added. Encoders/decoders (Phase 5+) serialize frames
 * shaped like:
 *
 *   version(1) | type(2) | flags(1) | streamId(4) | messageId(8)
 *   | sequence(4) | payloadLength(4) | payload...
 *
 * The exact byte layout is finalized in Phase 5; the type IDs are fixed now
 * so future phases cannot drift.
 */

export const MessageType = {
  /* control plane (0x00xx reserved for handshake/ping) */
  HELLO: 0x0001,
  HELLO_ACK: 0x0002,
  PING: 0x0003,
  PONG: 0x0004,
  CAPABILITY_UPDATE: 0x0005,
  PRESENCE_UPDATE: 0x0006,

  /* messaging (spec §14) */
  MESSAGE: 0x0101,
  MESSAGE_ACK: 0x0102,

  /* rpc (spec §15) */
  RPC_REQUEST: 0x0201,
  RPC_RESPONSE: 0x0202,
  RPC_ERROR: 0x0203,
  RPC_CANCEL: 0x0204,

  /* file transfer (spec §17) */
  FILE_START: 0x0301,
  FILE_ACCEPT: 0x0302,
  FILE_CHUNK: 0x0303,
  FILE_ACK: 0x0304,
  FILE_PAUSE: 0x0305,
  FILE_RESUME: 0x0306,
  FILE_CANCEL: 0x0307,
  FILE_COMPLETE: 0x0308,
  FILE_ERROR: 0x0309,

  /* state synchronization */
  SYNC_SNAPSHOT: 0x0401,
  SYNC_DELTA: 0x0402,
  SYNC_REQUEST: 0x0403,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Frame flag bits (extensible; unused bits must be sent as 0). */
export const FrameFlags = {
  /** Payload is UTF-8 JSON; otherwise it is opaque binary. */
  JSON_PAYLOAD: 0x01,
  /** Compressed payload (algorithm negotiated via capabilities). */
  COMPRESSED: 0x02,
  /** Marks the final frame of a streamed message. */
  FIN: 0x04,
} as const;
