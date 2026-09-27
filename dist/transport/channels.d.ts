/**
 * Logical DataChannel architecture (spec §12, Phase 1).
 *
 * Data is not pushed into one catch-all channel; instead a small, fixed set
 * of logical channels with per-use-case reliability is defined here. The
 * concrete multiplexing strategy (how many real RTCDataChannels back these
 * names) is decided in Phase 4, but the names and reliability intents are
 * part of the stable public contract.
 */
/** Names of the logical channels exposed by the framework. */
export declare const CHANNEL_NAMES: readonly ["control", "messages", "rpc", "files", "sync"];
export type ChannelName = (typeof CHANNEL_NAMES)[number];
/** Reliability intent for a logical channel (spec §12 examples). */
export type ChannelReliability = "reliable-ordered" | "reliable-unordered" | "partial-retransmit" | "timed";
/**
 * Default reliability profile per logical channel. Applications may override
 * via configuration where the transport supports it.
 */
export declare const DEFAULT_CHANNEL_RELIABILITY: Record<ChannelName, ChannelReliability>;
export declare function isChannelName(value: string): value is ChannelName;
//# sourceMappingURL=channels.d.ts.map