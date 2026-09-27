/**
 * Binary protocol versioning (spec §13, Phase 1 skeleton).
 *
 * Every frame starts with a protocol version byte so old and new peers can
 * fail fast and explicitly instead of mis-parsing each other's bytes.
 */
/** Current wire-protocol version emitted by this implementation. */
export declare const PROTOCOL_VERSION: 1;
/** Oldest protocol version this implementation will accept. */
export declare const MIN_SUPPORTED_PROTOCOL_VERSION: 1;
export declare function isSupportedProtocolVersion(version: number): boolean;
//# sourceMappingURL=ProtocolVersion.d.ts.map