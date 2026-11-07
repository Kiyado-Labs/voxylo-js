import type { ClientState } from "./types";

export type StatePatch = Partial<ClientState> | ((s: ClientState) => Partial<ClientState>);

export interface Store {
  get(): ClientState;
  set(patch: StatePatch): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(initial: ClientState): Store {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      const keys = Object.keys(next) as (keyof ClientState)[];
      if (keys.every((k) => Object.is(state[k], next[k]))) return;
      state = Object.freeze({ ...state, ...next });
      for (const l of [...listeners]) l();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
