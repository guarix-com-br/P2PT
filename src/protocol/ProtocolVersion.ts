/**
 * Binary protocol versioning (spec §13, Phase 1 skeleton).
 *
 * Every frame starts with a protocol version byte so old and new peers can
 * fail fast and explicitly instead of mis-parsing each other's bytes.
 */

/** Current wire-protocol version emitted by this implementation. */
export const PROTOCOL_VERSION = 1 as const;

/** Oldest protocol version this implementation will accept. */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1 as const;

export function isSupportedProtocolVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_PROTOCOL_VERSION &&
    version <= PROTOCOL_VERSION
  );
}
