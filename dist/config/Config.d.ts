/**
 * Configuration system (spec §33, Phase 1 — fully functional).
 *
 * `resolveConfig()` merges user input over defaults and validates every
 * field, producing structured `ConfigValidationError` issues. All timeouts
 * and limits are centralized here so no manager invents its own magic
 * numbers.
 */
import { type ResourceLimits } from "../security/Limits.js";
/** ICE server entry — structurally compatible with RTCIceServer. */
export interface IceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}
export interface P2PConfigInput {
    /** Application namespace used by discovery (required). */
    appId: string;
    /** Human-readable name announced in metadata. */
    peerName?: string;
    /** Override the generated peer id (advanced/testing use). */
    peerId?: string;
    /** Optional extra fields merged into advertised peer metadata. */
    metadata?: Record<string, string | number | boolean>;
    trackers?: string[];
    signalingUrls?: string[];
    iceServers?: IceServerConfig[];
    requestTimeoutMs?: number;
    transferTimeoutMs?: number;
    connectTimeoutMs?: number;
    reconnectAttempts?: number;
    /** First backoff delay for reconnect cycles (doubles each attempt). */
    reconnectBaseDelayMs?: number;
    /** Hard cap on exponential backoff. */
    reconnectMaxDelayMs?: number;
    limits?: Partial<ResourceLimits>;
}
export interface ResolvedP2PConfig {
    appId: string;
    peerName: string;
    peerId?: string;
    metadata: Record<string, string | number | boolean>;
    trackers: string[];
    signalingUrls: string[];
    iceServers: IceServerConfig[];
    requestTimeoutMs: number;
    transferTimeoutMs: number;
    connectTimeoutMs: number;
    reconnectAttempts: number;
    reconnectBaseDelayMs: number;
    reconnectMaxDelayMs: number;
    limits: ResourceLimits;
}
/** Default public STUN servers; production deployments should add TURN. */
export declare const DEFAULT_ICE_SERVERS: readonly IceServerConfig[];
/**
 * Merge user config over defaults and validate. Throws
 * `ConfigValidationError` listing every problem at once.
 */
export declare function resolveConfig(input: P2PConfigInput): ResolvedP2PConfig;
//# sourceMappingURL=Config.d.ts.map