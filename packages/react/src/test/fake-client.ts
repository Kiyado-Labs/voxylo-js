import { vi } from "vitest";
import type { ClientState, ClientToolDefinition, LevelSource, VoxyloClient } from "@voxylo/client";

// A local copy, so mocking @voxylo/client can import this file without a cycle
const INITIAL: ClientState = Object.freeze({
  status: "idle",
  endReason: null,
  error: null,
  messages: [],
  agentState: "idle",
  micEnabled: false,
  speakerEnabled: true,
  audioBlocked: false,
  chatId: null,
});

export type FakeClient = VoxyloClient & {
  setState(patch: Partial<ClientState>): void;
  emitLevel(source: LevelSource, level: number): void;
  levelSubscribers(): number;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setMicEnabled: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  setContext: ReturnType<typeof vi.fn>;
  tools: Map<string, ClientToolDefinition>;
};

export function createFakeClient(initial: Partial<ClientState> = {}): FakeClient {
  let state: ClientState = Object.freeze({ ...INITIAL, ...initial });
  const subs = new Set<() => void>();
  const levelSubs = new Set<{ source: LevelSource; fn: (v: number) => void }>();
  const client: FakeClient = {
    getSnapshot: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    forgetSession: vi.fn(async () => {}),
    destroy: vi.fn(),
    setMicEnabled: vi.fn(async (on: boolean) => client.setState({ micEnabled: on })),
    setSpeakerEnabled: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    tools: new Map(),
    registerTool: vi.fn((def: ClientToolDefinition) => {
      if (client.tools.has(def.name)) throw new TypeError(`duplicate ${def.name}`);
      client.tools.set(def.name, def);
      return () => {
        if (client.tools.get(def.name) === def) client.tools.delete(def.name);
      };
    }),
    setContext: vi.fn(),
    getAudioLevel: () => 0,
    subscribeAudioLevel(source, fn) {
      const sub = { source, fn };
      levelSubs.add(sub);
      return () => void levelSubs.delete(sub);
    },
    on: () => () => {},
    setState(patch) {
      state = Object.freeze({ ...state, ...patch });
      for (const fn of [...subs]) fn();
    },
    emitLevel(source, level) {
      for (const s of [...levelSubs]) if (s.source === source) s.fn(level);
    },
    levelSubscribers: () => levelSubs.size,
  };
  return client;
}
