import { createBrowserEnv, createLevelMonitor, type BrowserEnv, type LevelSource, type MicHold } from "./audio";
import { VoxyloError, asVoxyloError } from "./errors";
import type { SessionEndReason, Turn } from "./protocol";
import { createResumeStore, resumeKey, type ResumeOption } from "./resume";
import {
  connectRoom,
  type AgentTextEvent,
  type AudioTrackLike,
  type RoomConnection,
  type RoomHandlers,
  type RoomLike,
} from "./room/adapter";
import {
  DEFAULT_ENVIRONMENT,
  startAnonymousSession,
  type CallerInfo,
  type VoxyloSession,
} from "./session";
import { createStore } from "./state/store";
import { INITIAL_STATE, type ClientState } from "./state/types";
import { SDK_NAME, SDK_VERSION } from "./version";

export interface VoxyloClientOptions {
  /** Required unless getSession is given */
  projectId?: string;
  /** Defaults to "main" */
  environment?: string;
  /** Defaults to "https://api.voxylo.cloud" */
  apiBase?: string;
  /** For signed-in users: return a session your server created with its API key */
  getSession?: (req: { resumeToken?: string }) => Promise<VoxyloSession>;
  /** Anonymous sessions only; shown on the transcript, never trusted */
  caller?: CallerInfo;
  /** Where the resume token lives; false turns resuming off. Defaults to localStorage */
  resume?: ResumeOption;
  /** Plays the agent's voice through a hidden audio element. Defaults to true */
  autoPlayAudio?: boolean;
  /** For wrapper packages to name themselves in analytics */
  unstable_sdk?: { name: string; version: string };
}

export interface ConnectOptions {
  /** "voice" turns the mic on; call it straight from a click so the browser allows audio */
  mode?: "chat" | "voice";
}

export interface VoxyloClientEvents {
  turn: Turn;
  agentText: AgentTextEvent;
  sessionEnd: SessionEndReason;
  error: VoxyloError;
}

export interface VoxyloClient {
  getSnapshot(): ClientState;
  subscribe(listener: () => void): () => void;
  connect(opts?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  /** Disconnects and forgets the conversation, e.g. on logout */
  forgetSession(): Promise<void>;
  destroy(): void;
  setMicEnabled(on: boolean): Promise<void>;
  setSpeakerEnabled(on: boolean): Promise<void>;
  /** Call from a click when `audioBlocked` is true */
  startAudio(): Promise<void>;
  getAudioLevel(source: LevelSource): number;
  /** Called at most once per animation frame; for animations that should skip React renders */
  subscribeAudioLevel(source: LevelSource, fn: (level: number) => void): () => void;
  on<E extends keyof VoxyloClientEvents>(event: E, fn: (payload: VoxyloClientEvents[E]) => void): () => void;
}

export interface ClientDeps {
  createRoom(): Promise<RoomLike>;
  /** A Room right now if livekit-client is already loaded, so voice can unlock audio inside the click */
  createRoomNow?(): RoomLike | null;
  fetch?: typeof fetch;
  env: BrowserEnv;
}

type Listener = (payload: never) => void;

export function createClient(options: VoxyloClientOptions, deps: ClientDeps): VoxyloClient {
  if (!options.projectId && !options.getSession) {
    throw new TypeError("Voxylo: pass a projectId, or getSession for sessions your server creates");
  }
  const environment = options.environment ?? DEFAULT_ENVIRONMENT;
  const sdk = options.unstable_sdk ?? { name: SDK_NAME, version: SDK_VERSION };
  const sdkTag = `${sdk.name}@${sdk.version}`;
  const store = createStore(INITIAL_STATE);
  const resume = createResumeStore(
    options.resume,
    resumeKey(options.getSession ? undefined : options.projectId, environment),
  );
  const levels = createLevelMonitor(deps.env);
  const listeners = new Map<keyof VoxyloClientEvents, Set<Listener>>();
  const audioEls = new Set<HTMLMediaElement>();

  let conn: RoomConnection | null = null;
  let agentTrack: AudioTrackLike | null = null;
  // Bumped whenever a session is abandoned, so late callbacks from it are ignored
  let attempt = 0;
  let pending: { attempt: number; promise: Promise<void> } | null = null;
  let destroyed = false;

  function emit<E extends keyof VoxyloClientEvents>(event: E, payload: VoxyloClientEvents[E]) {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try {
        (fn as (p: VoxyloClientEvents[E]) => void)(payload);
      } catch {
        // A throwing app listener must not break the session
      }
    }
  }

  function detachElements() {
    for (const el of audioEls) deps.env.detachAudio(el);
    if (audioEls.size > 0) agentTrack?.detach();
    audioEls.clear();
  }

  // Speaker off means no element at all: LiveKit's startAudio unmutes every attached element
  function attachElement() {
    if (!agentTrack || options.autoPlayAudio === false || !store.get().speakerEnabled || audioEls.size > 0) return;
    const el = agentTrack.attach();
    audioEls.add(el);
    deps.env.attachAudio(el);
  }

  function releaseAudio() {
    detachElements();
    agentTrack = null;
  }

  function setAgentTrack(track: AudioTrackLike | null) {
    releaseAudio();
    agentTrack = track;
    if (!track) {
      levels.setTrack("agent", null);
      return;
    }
    attachElement();
    levels.setTrack("agent", track.mediaStreamTrack);
  }

  async function teardown() {
    const c = conn;
    conn = null;
    releaseAudio();
    levels.reset();
    if (c) await c.close().catch(() => {});
  }

  function fail(error: VoxyloError) {
    store.set({ status: "error", error, agentState: "idle", micEnabled: false });
    emit("error", error);
  }

  function endSession(reason: SessionEndReason) {
    attempt++;
    if (reason === "completed") resume.clear();
    void teardown();
    store.set({ status: "ended", endReason: reason, agentState: "idle", micEnabled: false });
    emit("sessionEnd", reason);
  }

  function handlersFor(a: number): RoomHandlers {
    const live =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (a === attempt) fn(...args);
      };
    return {
      onTurn: live((t) => emit("turn", t)),
      onAgentText: live((e) => emit("agentText", e)),
      onRich: () => {},
      onSessionEvent: live((e) => {
        if (e.type === "ended") endSession(e.reason);
      }),
      onAgentState: live((s) => {
        store.set({ agentState: s });
        levels.setAgentSpeaking(s === "speaking");
      }),
      onAgentAudio: live((track) => setAgentTrack(track)),
      onDisconnected: live(() => {
        attempt++;
        void teardown();
        fail(new VoxyloError("connection_failed", "The connection to the agent was lost"));
      }),
      onReconnecting: live(() => store.set({ status: "reconnecting" })),
      onReconnected: live(() => store.set({ status: "connected" })),
      onAudioPlaybackChanged: live((canPlay) => store.set({ audioBlocked: !canPlay })),
    };
  }

  async function fetchSession(resumeToken: string | undefined, mode: "chat" | "voice"): Promise<VoxyloSession> {
    if (options.getSession) {
      try {
        return await options.getSession(resumeToken ? { resumeToken } : {});
      } catch (err) {
        if (err instanceof VoxyloError) throw err;
        throw new VoxyloError("session_failed", "getSession failed", { cause: err });
      }
    }
    return startAnonymousSession({
      ...(options.apiBase ? { apiBase: options.apiBase } : {}),
      projectId: options.projectId as string,
      environment,
      ...(resumeToken ? { resumeToken } : {}),
      ...(options.caller ? { caller: options.caller } : {}),
      initialMode: mode,
      sdk,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  }

  async function run(
    a: number,
    mode: "chat" | "voice",
    mic: Promise<MicHold> | null,
    early: RoomLike | null,
  ): Promise<void> {
    const voice = mode === "voice";
    let hold: MicHold | null = null;
    let roomInUse = false;
    try {
      if (mic) {
        try {
          hold = await mic;
        } catch (err) {
          throw new VoxyloError("microphone_denied", "Microphone permission was not granted", { cause: err });
        }
      }
      if (a !== attempt) return;

      const token = resume.get() ?? undefined;
      const [session, room] = await Promise.all([
        fetchSession(token, mode),
        early
          ? Promise.resolve(early)
          : deps.createRoom().catch((err: unknown) => {
              throw new VoxyloError("connection_failed", "Could not load the voice client", { cause: err });
            }),
      ]);
      if (a !== attempt) return;
      if (session.resumeToken) resume.set(session.resumeToken);
      if (session.resumed === false) store.set({ messages: INITIAL_STATE.messages });

      let c: RoomConnection;
      try {
        c = await connectRoom(room, session, handlersFor(a), { sdk: sdkTag });
      } catch (err) {
        throw asVoxyloError(err, "connection_failed");
      }
      roomInUse = true;
      if (a !== attempt) {
        await c.close();
        return;
      }
      conn = c;

      if (voice) {
        try {
          await c.setMic(true);
        } catch (err) {
          throw new VoxyloError("microphone_denied", "Could not turn on the microphone", { cause: err });
        }
        if (a !== attempt) return;
        levels.setTrack("user", c.getMicTrack());
      }
      const canPlay = await c.startAudio();
      if (a !== attempt) return;
      store.set({ status: "connected", chatId: session.chatId, micEnabled: voice, audioBlocked: !canPlay });
    } catch (err) {
      if (a !== attempt) return;
      attempt++;
      await teardown();
      const e = asVoxyloError(err, "unknown");
      fail(e);
      throw e;
    } finally {
      hold?.release();
      // A Room built in the click holds LiveKit's audio context until disconnected
      if (early && !roomInUse) void early.disconnect().catch(() => {});
    }
  }

  async function disconnect() {
    attempt++;
    pending = null;
    await teardown();
    store.set({ status: "idle", agentState: "idle", micEnabled: false, audioBlocked: false, error: null, endReason: null });
  }

  return {
    getSnapshot: () => store.get(),
    subscribe: (fn) => store.subscribe(fn),

    connect(opts = {}) {
      if (destroyed) return Promise.resolve();
      if (pending && pending.attempt === attempt) return pending.promise;
      const status = store.get().status;
      if (status === "connected" || status === "reconnecting") return Promise.resolve();

      const mode = opts.mode ?? "chat";
      let mic: Promise<MicHold> | null = null;
      let early: RoomLike | null = null;
      if (mode === "voice") {
        // All of this must start inside the caller's click, before anything awaits
        early = deps.createRoomNow?.() ?? null;
        if (early) void early.startAudio().catch(() => {});
        deps.env.unlockAudio();
        mic = deps.env.requestMic();
        mic.catch(() => {});
      }
      const a = ++attempt;
      store.set({ status: "connecting", error: null, endReason: null, agentState: "idle" });
      const promise = run(a, mode, mic, early).finally(() => {
        if (pending?.promise === promise) pending = null;
      });
      pending = { attempt: a, promise };
      return promise;
    },

    disconnect,

    async forgetSession() {
      await disconnect();
      resume.clear();
      store.set({ chatId: null, messages: INITIAL_STATE.messages });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      void disconnect();
    },

    async setMicEnabled(on) {
      const c = conn;
      if (!c || destroyed) return;
      try {
        await c.setMic(on);
      } catch (err) {
        const e = new VoxyloError("microphone_denied", on ? "Could not turn on the microphone" : "Could not mute the microphone", { cause: err });
        emit("error", e);
        throw e;
      }
      if (on) levels.setTrack("user", c.getMicTrack());
      levels.setUserMuted(!on);
      store.set({ micEnabled: on });
    },

    async setSpeakerEnabled(on) {
      store.set({ speakerEnabled: on });
      if (on) attachElement();
      else detachElements();
    },

    async startAudio() {
      const c = conn;
      if (!c) return;
      const canPlay = await c.startAudio();
      store.set({ audioBlocked: !canPlay });
    },

    getAudioLevel: (source) => levels.get(source),
    subscribeAudioLevel: (source, fn) => levels.subscribe(source, fn),

    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn as Listener);
      return () => {
        listeners.get(event)?.delete(fn as Listener);
      };
    },
  };
}

type LiveKitModule = typeof import("livekit-client");

let livekit: LiveKitModule | null = null;
let livekitLoading: Promise<LiveKitModule> | null = null;

// Never at import time: importing the SDK stays light and server-safe
function loadLiveKit(): Promise<LiveKitModule> {
  livekitLoading ??= import("livekit-client").then(
    (m) => (livekit = m),
    (err: unknown) => {
      livekitLoading = null;
      throw err;
    },
  );
  return livekitLoading;
}

const ROOM_OPTIONS = { adaptiveStream: true, dynacast: true };

export function createVoxyloClient(options: VoxyloClientOptions): VoxyloClient {
  // Preloaded in the browser so a voice click can build the Room and unlock audio synchronously
  if (typeof window !== "undefined") void loadLiveKit().catch(() => {});
  return createClient(options, {
    async createRoom() {
      const lk = await loadLiveKit();
      return new lk.Room(ROOM_OPTIONS) as unknown as RoomLike;
    },
    createRoomNow: () => (livekit ? (new livekit.Room(ROOM_OPTIONS) as unknown as RoomLike) : null),
    env: createBrowserEnv(),
  });
}
