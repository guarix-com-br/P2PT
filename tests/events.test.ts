import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "../src/core/events.js";

interface TestEvents {
  ping: { value: number };
  error: Error;
}

describe("TypedEventEmitter", () => {
  it("delivers payloads to on() listeners in insertion order", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    const calls: string[] = [];
    bus.on("ping", ({ value }) => calls.push(`a:${value}`));
    bus.on("ping", ({ value }) => calls.push(`b:${value}`));
    bus.emit("ping", { value: 1 });
    expect(calls).toEqual(["a:1", "b:1"]);
  });

  it("once() fires exactly once and can be removed with off()", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    const fn = vi.fn();
    bus.once("ping", fn);
    bus.off("ping", fn);
    bus.emit("ping", { value: 1 });
    expect(fn).not.toHaveBeenCalled();

    bus.once("ping", fn);
    bus.emit("ping", { value: 2 });
    bus.emit("ping", { value: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("emit() returns false without listeners", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    expect(bus.emit("ping", { value: 0 })).toBe(false);
  });

  it("off() during emission does not affect the current dispatch snapshot", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    const second = vi.fn();
    bus.on("ping", () => bus.off("ping", second));
    bus.on("ping", second);
    bus.emit("ping", { value: 1 });
    expect(second).toHaveBeenCalledTimes(1); // still called this round
    bus.emit("ping", { value: 2 });
    expect(second).toHaveBeenCalledTimes(1); // gone next round
  });

  it("unhandled error events rethrow like Node semantics", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    expect(() => bus.emit("error", new Error("boom"))).toThrow("boom");
  });

  it("listener errors are routed to an error listener when present", async () => {
    const bus = new TypedEventEmitter<TestEvents>();
    const onError = vi.fn();
    bus.on("error", onError);
    bus.on("ping", () => {
      throw new Error("listener blew up");
    });
    const received: number[] = [];
    bus.on("ping", ({ value }) => received.push(value));
    bus.emit("ping", { value: 7 });
    // remaining chain kept running
    expect(received).toEqual([7]);
    await Promise.resolve(); // let the microtask fire
    expect(onError).toHaveBeenCalledWith(new Error("listener blew up"));
  });

  it("removeAllListeners clears counts", () => {
    const bus = new TypedEventEmitter<TestEvents>();
    bus.on("ping", () => {});
    bus.on("error", () => {});
    expect(bus.listenerCount("ping")).toBe(1);
    bus.removeAllListeners("ping");
    expect(bus.listenerCount("ping")).toBe(0);
    expect(bus.listenerCount("error")).toBe(1);
    bus.removeAllListeners();
    expect(bus.listenerCount("error")).toBe(0);
  });
});
