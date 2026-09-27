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
export const CHANNEL_NAMES = ["control", "messages", "rpc", "files", "sync"] as const;

export type ChannelName = (typeof CHANNEL_NAMES)[number];

/** Reliability intent for a logical channel (spec §12 examples). */
export type ChannelReliability =
  | "reliable-ordered" // chat, RPC, file transfer
  | "reliable-unordered" // state sync (configurable), telemetry
  | "partial-retransmit" // low-latency telemetry, N retransmits max
  | "timed"; // low-latency telemetry, max lifetime ms

/**
 * Default reliability profile per logical channel. Applications may override
 * via configuration where the transport supports it.
 */
export const DEFAULT_CHANNEL_RELIABILITY: Record<ChannelName, ChannelReliability> = {
  control: "reliable-ordered",
  messages: "reliable-ordered",
  rpc: "reliable-ordered",
  files: "reliable-ordered",
  sync: "reliable-unordered",
};

export function isChannelName(value: string): value is ChannelName {
  return (CHANNEL_NAMES as readonly string[]).includes(value);
}
