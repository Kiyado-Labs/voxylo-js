import { describe, expect, it, vi } from "vitest";

import { createStore } from "./store";
import { INITIAL_STATE } from "./types";

describe("createStore", () => {
  it("starts from the initial state", () => {
    const store = createStore(INITIAL_STATE);
    expect(store.get()).toBe(INITIAL_STATE);
    expect(INITIAL_STATE).toMatchObject({ status: "idle", agentState: "idle", micEnabled: false, speakerEnabled: true, audioBlocked: false, chatId: null, error: null, endReason: null, messages: [] });
  });

  it("returns the same snapshot until something changes", () => {
    const store = createStore(INITIAL_STATE);
    const a = store.get();
    expect(store.get()).toBe(a);
    store.set({ status: "idle" });
    expect(store.get()).toBe(a);
  });

  it("notifies once per effective change and freezes the new snapshot", () => {
    const store = createStore(INITIAL_STATE);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ status: "connecting" });
    store.set({ status: "connecting" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get().status).toBe("connecting");
    expect(Object.isFrozen(store.get())).toBe(true);
  });

  it("accepts a function patch", () => {
    const store = createStore(INITIAL_STATE);
    store.set((s) => ({ micEnabled: !s.micEnabled }));
    expect(store.get().micEnabled).toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore(INITIAL_STATE);
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    store.set({ status: "connected" });
    expect(fn).not.toHaveBeenCalled();
  });
});
