/**
 * Platform adapter contracts (Phase 2).
 *
 * The discovery layer must run unchanged in browsers and Node, and must be
 * testable without real sockets. Everything platform-specific therefore
 * enters through these two narrow seams:
 *
 * - `WebSocketLike` / `WebSocketFactory`: a structural subset of the DOM
 *   WebSocket API. Browsers satisfy it natively; Node satisfies it with the
 *   built-in `node:ws` (Node ≥ 21) or an injected polyfill.
 * - `TimerProvider`: `setTimeout`/`clearTimeout` indirection so tests can
 *   install fake timers deterministically.
 *
 * Nothing in this module imports WebRTC — it is deliberately smaller than
 * the transport layer itself.
 */

export type WebSocketReadyState = 0 | 1 | 2 | 3;

/** Structural subset of the browser `WebSocket` interface. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
  removeEventListener?(type: string, listener: (...args: never[]) => void): void;
}

/** Creates a client socket for `url`. May throw synchronously on bad input. */
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface TimerProvider {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Clock used for TTL/rate-window bookkeeping (injectable for tests). */
  now(): number;
}

export const DEFAULT_TIMERS: TimerProvider = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * Resolve a usable `WebSocketFactory`: explicit injection wins; otherwise
 * fall back to the ambient global (browsers, Node ≥ 21). Returns
 * `undefined` when neither exists so callers can fail with a clear message
 * instead of a cryptic `TypeError`.
 */
export function resolveWebSocketFactory(
  injected?: WebSocketFactory,
): WebSocketFactory | undefined {
  if (injected) return injected;
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof candidate === "function") {
    return (url: string) =>
      new (candidate as new (url: string) => WebSocketLike)(url);
  }
  return undefined;
}
