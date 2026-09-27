/**
 * Mock discovery provider (test fixture).
 *
 * Implements the same `DiscoveryProvider` contract as real providers, so
 * manager behavior (dedup, TTL, limits, room scope, failure isolation) is
 * exercised through the exact public interface applications would use.
 */

import type {
  DiscoveredPeer,
  DiscoveryEvent,
  DiscoveryProvider,
  DiscoveryProviderState,
  DiscoveryStartOptions,
} from "../../src/discovery/DiscoveryProvider.js";

export class MockDiscoveryProvider implements DiscoveryProvider {
  readonly id: string;
  #state: DiscoveryProviderState = "idle";
  readonly #listeners = new Set<(ev: DiscoveryEvent) => void>();
  /** Recorded lifecycle calls for assertions. */
  readonly calls: string[] = [];
  readonly startedScopes: (string | undefined)[][] = [];
  readonly joinedRooms: (string | undefined)[] = [];
  readonly leftRooms: (string | undefined)[] = [];
  /** When true, start()/stop() throw to simulate provider failure. */
  failOnStart = false;
  failOnStop = false;

  constructor(id = "mock:1") {
    this.id = id;
  }

  get state(): DiscoveryProviderState {
    return this.#state;
  }

  on(_event: "event", handler: (payload: DiscoveryEvent) => void): () => void {
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  async start(options: DiscoveryStartOptions): Promise<void> {
    // Distinguish fallback restarts (stop+start pairs) from plain starts.
    this.calls.push(
      this.#state === "idle" && this.calls.at(-1) === "stop" ? "restart" : "start",
    );
    if (this.failOnStart) throw new Error("mock start failure");
    this.startedScopes.push((options.roomIds ?? []).map((r) => r));
    this.#setState("connected");
  }

  async stop(): Promise<void> {
    this.calls.push("stop");
    if (this.failOnStop) throw new Error("mock stop failure");
    this.#setState("idle");
  }

  async destroy(): Promise<void> {
    this.calls.push("destroy");
    this.#setState("failed");
    this.#listeners.clear();
  }

  async joinRoom(roomId?: string): Promise<void> {
    this.calls.push(`join:${roomId ?? "-"}`);
    this.joinedRooms.push(roomId);
  }

  async leaveRoom(roomId?: string): Promise<void> {
    this.calls.push(`leave:${roomId ?? "-"}`);
    this.leftRooms.push(roomId);
  }

  /* ------------------------- test controls ------------------------- */

  emitPeer(peer: DiscoveredPeer): void {
    this.#emit({ type: "peer", peer });
  }

  emitRaw(ev: DiscoveryEvent): void {
    this.#emit(ev);
  }

  #setState(next: DiscoveryProviderState): void {
    if (this.#state === next) return;
    const previous = this.#state;
    this.#state = next;
    this.#emit({ type: "state", state: next, previous });
  }

  #emit(ev: DiscoveryEvent): void {
    for (const l of [...this.#listeners]) l(ev);
  }
}
