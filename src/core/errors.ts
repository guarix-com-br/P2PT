/**
 * Error types used across all planes of the framework.
 *
 * Keeping errors in one small module avoids circular imports between the
 * core, control, data and media layers.
 */

/** Base class for every error raised by the framework itself. */
export class P2PError extends Error {
  /** Stable machine-readable code (e.g. `"NOT_IMPLEMENTED"`). */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "P2PError";
    this.code = code;
  }
}

/**
 * Raised by Phase-1 skeletons for behavior that belongs to a later phase.
 * It lets the package build, import and be tested today while clearly
 * signaling which calls are not live yet.
 */
export class NotImplementedError extends P2PError {
  /** Target phase in which this feature becomes available (if planned). */
  readonly phase?: number;

  constructor(feature: string, phase?: number) {
    super(
      "NOT_IMPLEMENTED",
      `${feature} is not implemented yet${phase !== undefined ? ` (planned for Phase ${phase})` : ""}.`,
    );
    this.name = "NotImplementedError";
    this.phase = phase;
  }
}

/** Raised when runtime input from a remote peer fails validation. */
export class ValidationError extends P2PError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationError";
  }
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/** Raised when configuration values fail validation. */
export class ConfigValidationError extends P2PError {
  /** Individual field-level problems, empty when the error is global. */
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      "CONFIG_INVALID",
      `Invalid configuration: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/** Raised when an operation exceeds its configured timeout. */
export class TimeoutError extends P2PError {
  constructor(operation: string, timeoutMs: number) {
    super("TIMEOUT", `Operation "${operation}" timed out after ${timeoutMs}ms.`);
    this.name = "TimeoutError";
  }
}

/** Raised when a resource limit (max peers, pending requests, …) is hit. */
export class LimitExceededError extends P2PError {
  constructor(limit: string, value: number) {
    super("LIMIT_EXCEEDED", `Resource limit "${limit}" exceeded (current: ${value}).`);
    this.name = "LimitExceededError";
  }
}
