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
export declare const MessageType: {
    readonly HELLO: 1;
    readonly HELLO_ACK: 2;
    readonly PING: 3;
    readonly PONG: 4;
    readonly CAPABILITY_UPDATE: 5;
    readonly PRESENCE_UPDATE: 6;
    readonly MESSAGE: 257;
    readonly MESSAGE_ACK: 258;
    readonly RPC_REQUEST: 513;
    readonly RPC_RESPONSE: 514;
    readonly RPC_ERROR: 515;
    readonly RPC_CANCEL: 516;
    readonly FILE_START: 769;
    readonly FILE_ACCEPT: 770;
    readonly FILE_CHUNK: 771;
    readonly FILE_ACK: 772;
    readonly FILE_PAUSE: 773;
    readonly FILE_RESUME: 774;
    readonly FILE_CANCEL: 775;
    readonly FILE_COMPLETE: 776;
    readonly FILE_ERROR: 777;
    readonly SYNC_SNAPSHOT: 1025;
    readonly SYNC_DELTA: 1026;
    readonly SYNC_REQUEST: 1027;
};
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
/** Frame flag bits (extensible; unused bits must be sent as 0). */
export declare const FrameFlags: {
    /** Payload is UTF-8 JSON; otherwise it is opaque binary. */
    readonly JSON_PAYLOAD: 1;
    /** Compressed payload (algorithm negotiated via capabilities). */
    readonly COMPRESSED: 2;
    /** Marks the final frame of a streamed message. */
    readonly FIN: 4;
};
//# sourceMappingURL=MessageTypes.d.ts.map