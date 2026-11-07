import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { unstable_initialState, type ClientState, type ConnectOptions, type VoxyloClient } from "@voxylo/client";

import { useClientFromContext } from "./context";

const noopSubscribe = () => () => {};

function useSelected<T>(client: VoxyloClient | null, selector: (s: ClientState) => T): T {
  const subscribe = useCallback((fn: () => void) => (client ? client.subscribe(fn) : noopSubscribe()), [client]);
  return useSyncExternalStore(
    subscribe,
    () => selector(client ? client.getSnapshot() : unstable_initialState),
    () => selector(unstable_initialState),
  );
}

/** The client, or null until it is created after hydration */
export function useVoxyloClient(): VoxyloClient | null {
  return useClientFromContext("useVoxyloClient");
}

/** Re-renders only when the selected value changes; return primitives or stable references */
export function useVoxyloState<T>(selector: (s: ClientState) => T): T {
  return useSelected(useClientFromContext("useVoxyloState"), selector);
}

export interface VoxyloActions {
  connect(opts?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  forgetSession(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setSpeakerEnabled(on: boolean): Promise<void>;
  startAudio(): Promise<void>;
}

export function useStableActions(client: VoxyloClient | null): VoxyloActions {
  const ref = useRef(client);
  ref.current = client;
  return useMemo<VoxyloActions>(
    () => ({
      connect: (opts) => ref.current?.connect(opts) ?? Promise.resolve(),
      disconnect: () => ref.current?.disconnect() ?? Promise.resolve(),
      forgetSession: () => ref.current?.forgetSession() ?? Promise.resolve(),
      setMicEnabled: (on) => ref.current?.setMicEnabled(on) ?? Promise.resolve(),
      setSpeakerEnabled: (on) => ref.current?.setSpeakerEnabled(on) ?? Promise.resolve(),
      startAudio: () => ref.current?.startAudio() ?? Promise.resolve(),
    }),
    [],
  );
}

const identity = (s: ClientState) => s;

export function useVoxylo(): { state: ClientState } & VoxyloActions {
  const client = useClientFromContext("useVoxylo");
  const state = useSelected(client, identity);
  const actions = useStableActions(client);
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}

export { useSelected as unstable_useSelected };
