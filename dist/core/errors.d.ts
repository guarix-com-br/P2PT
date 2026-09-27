/**
 * Error types used across all planes of the framework.
 *
 * Keeping errors in one small module avoids circular imports between the
 * core, control, data and media layers.
 */
/** Base class for every error raised by the framework itself. */
export declare class P2PError extends Error {
    /** Stable machine-readable code (e.g. `"NOT_IMPLEMENTED"`). */
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Raised by Phase-1 skeletons for behavior that belongs to a later phase.
 * It lets the package build, import and be tested today while clearly
 * signaling which calls are not live yet.
 */
export declare class NotImplementedError extends P2PError {
    /** Target phase in which this feature becomes available (if planned). */
    readonly phase?: number;
    constructor(feature: string, phase?: number);
}
/** Raised when runtime input from a remote peer fails validation. */
export declare class ValidationError extends P2PError {
    constructor(message: string);
}
export interface ConfigIssue {
    path: string;
    message: string;
}
/** Raised when configuration values fail validation. */
export declare class ConfigValidationError extends P2PError {
    /** Individual field-level problems, empty when the error is global. */
    readonly issues: readonly ConfigIssue[];
    constructor(issues: readonly ConfigIssue[]);
}
/** Raised when an operation exceeds its configured timeout. */
export declare class TimeoutError extends P2PError {
    constructor(operation: string, timeoutMs: number);
}
/** Raised when a resource limit (max peers, pending requests, …) is hit. */
export declare class LimitExceededError extends P2PError {
    constructor(limit: string, value: number);
}
//# sourceMappingURL=errors.d.ts.map