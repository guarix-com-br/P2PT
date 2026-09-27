/**
 * Capability negotiation contracts (spec §28, Phase 1 interfaces only).
 *
 * Peers advertise what they support; feature APIs check before use.
 * Versioned by name so `files` v1 and v2 can coexist during rollouts.
 */

/** Well-known capability names (extensible with arbitrary strings). */
export const KnownCapability = {
  Messaging: "messaging",
  Binary: "binary",
  Files: "files",
  Rpc: "rpc",
  Audio: "audio",
  Video: "video",
  ScreenShare: "screenShare",
  StateSync: "stateSync",
} as const;

export type CapabilityName =
  (typeof KnownCapability)[keyof typeof KnownCapability] | (string & {});

export interface Capability {
  name: CapabilityName;
  /** Semantic major version of the capability protocol. */
  version: number;
  /** Optional limits advertised by the peer (sizes, counts). */
  limits?: Record<string, number>;
}

export interface CapabilitySet {
  has(name: CapabilityName, minVersion?: number): boolean;
  list(): readonly Capability[];
}
