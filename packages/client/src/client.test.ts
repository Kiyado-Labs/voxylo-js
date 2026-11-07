import { describe, expect, it, vi } from "vitest";

import type { AnalyserLike, BrowserEnv } from "./audio";
import { createClient, type VoxyloClientOptions } from "./client";
import { VoxyloError } from "./errors";
import { FakeRoom, fakeAudioTrack } from "./room/fake-room";
import type { ConnectionStatus } from "./state/types";

const SESSION = {
  livekitUrl: "wss://lk.example.com",
  livekitToken: "tok",
  roomName: "widget-1",
  chatId: "chat-1",
  resumeToken: "resume-new",
  resumed: false,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function fakeEnv(overrides: Partial<BrowserEnv> = {}) {
  const frames = new Map<number, (t: number) => void>();
  let id = 0;
  const analysed: MediaStreamTrack[] = [];
  const hold = { release: vi.fn() };
  const env = {
    unlockAudio: vi.fn(),
    requestMic: vi.fn(async () => hold),
    attachAudio: vi.fn(),
    detachAudio: vi.fn(),
    requestFrame: (cb: (t: number) => void) => {
      frames.set(++id, cb);
      return id;
    },
    cancelFrame: (n: number) => void frames.delete(n),
    createAnalyser: (track: MediaStreamTrack): AnalyserLike => {
      analysed.push(track);
      return { read: () => 0.1, dispose: () => {} };
    },
    ...overrides,
  };
  return { env, analysed, hold, frame: () => [...frames.values()].forEach((cb) => cb(0)) };
}

function okFetch(session: object = SESSION) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: session }), { status: 200 }));
}

function setup(opts: Partial<VoxyloClientOptions> = {}, env = fakeEnv(), fetchImpl = okFetch(), preloaded = false) {
  const room = new FakeRoom();
  const storage = memoryStorage();
  const createRoom = vi.fn(async () => room);
  const createRoomNow = vi.fn(() => (preloaded ? room : null));
  const client = createClient(
    { projectId: "proj", resume: { storage }, ...opts },
    { createRoom, createRoomNow, fetch: fetchImpl as unknown as typeof fetch, env: env.env },
  );
  const statuses: ConnectionStatus[] = [];
  client.subscribe(() => {
    const s = client.getSnapshot().status;
    if (statuses.at(-1) !== s) statuses.push(s);
  });
  return { client, room, storage, fetchImpl, createRoom, createRoomNow, env, statuses };
}

function sentBody(fetchImpl: ReturnType<typeof okFetch>, call = 0) {
  return JSON.parse((fetchImpl.mock.calls[call]?.[1] as RequestInit).body as string);
}

describe("createClient", () => {
  it("needs a projectId or getSession", () => {
    expect(() => createClient({}, { createRoom: async () => new FakeRoom(), env: fakeEnv().env })).toThrow(TypeError);
  });

  it("connects: idle → connecting → connected, with the chat id", async () => {
    const t = setup();
    expect(t.client.getSnapshot().status).toBe("idle");
    await t.client.connect();
    expect(t.statuses).toEqual(["connecting", "connected"]);
    expect(t.client.getSnapshot().chatId).toBe("chat-1");
    expect(t.room.connectArgs).toEqual(["wss://lk.example.com", "tok"]);
  });

  it("announces the sdk on the room, overridable by wrappers", async () => {
    const plain = setup();
    await plain.client.connect();
    expect(plain.room.attributes["voxylo.sdk"]).toBe("@voxylo/client@0.0.0");
    const wrapped = setup({ unstable_sdk: { name: "@voxylo/react", version: "9.9.9" } });
    await wrapped.client.connect();
    expect(wrapped.room.attributes["voxylo.sdk"]).toBe("@voxylo/react@9.9.9");
    expect(sentBody(wrapped.fetchImpl).sdk).toEqual({ name: "@voxylo/react", version: "9.9.9" });
  });

  it("sends the stored resume token and stores the new one", async () => {
    const t = setup();
    t.storage.map.set("voxylo:resume:proj:main", "resume-old");
    await t.client.connect();
    expect(sentBody(t.fetchImpl).resumeToken).toBe("resume-old");
    expect(t.storage.map.get("voxylo:resume:proj:main")).toBe("resume-new");
  });

  it("only starts one session when connect is called twice", async () => {
    const t = setup();
    await Promise.all([t.client.connect(), t.client.connect()]);
    expect(t.fetchImpl).toHaveBeenCalledTimes(1);
    await t.client.connect();
    expect(t.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses getSession instead of the public endpoint", async () => {
    const getSession = vi.fn(async () => SESSION);
    const t = setup({ projectId: undefined, getSession });
    t.storage.map.set("voxylo:resume:custom:main", "r0");
    await t.client.connect();
    expect(getSession).toHaveBeenCalledWith({ resumeToken: "r0" });
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it("reports session_failed when getSession throws", async () => {
    const t = setup({ getSession: async () => Promise.reject(new Error("401 from my backend")) });
    const err = await t.client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoxyloError);
    expect((err as VoxyloError).code).toBe("session_failed");
    expect(t.client.getSnapshot()).toMatchObject({ status: "error", error: { code: "session_failed" } });
  });

  it("surfaces typed HTTP errors from the public endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: "agent_unavailable" }), { status: 503 }));
    const t = setup({}, fakeEnv(), fetchImpl as unknown as ReturnType<typeof okFetch>);
    await expect(t.client.connect()).rejects.toMatchObject({ code: "agent_unavailable" });
    expect(t.client.getSnapshot().status).toBe("error");
  });

  it("reports connection_failed when the room can't connect", async () => {
    const t = setup();
    t.room.connectError = new Error("signal failed");
    await expect(t.client.connect()).rejects.toMatchObject({ code: "connection_failed" });
    expect(t.client.getSnapshot().error?.code).toBe("connection_failed");
  });

  describe("voice", () => {
    it("unlocks audio and asks for the mic synchronously, before anything awaits", () => {
      const t = setup();
      const p = t.client.connect({ mode: "voice" });
      expect(t.env.env.unlockAudio).toHaveBeenCalledOnce();
      expect(t.env.env.requestMic).toHaveBeenCalledOnce();
      expect(t.fetchImpl).not.toHaveBeenCalled();
      return p;
    });

    it("starts the session in voice mode and turns the mic on", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      expect(sentBody(t.fetchImpl).initialMode).toBe("voice");
      expect(t.room.micEnabled).toBe(true);
      expect(t.client.getSnapshot().micEnabled).toBe(true);
    });

    it("does not touch the mic in chat mode", async () => {
      const t = setup();
      await t.client.connect({ mode: "chat" });
      expect(t.env.env.requestMic).not.toHaveBeenCalled();
      expect(t.client.getSnapshot().micEnabled).toBe(false);
    });

    it("reports microphone_denied without starting a session, then chat still works", async () => {
      const env = fakeEnv({ requestMic: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) });
      const t = setup({}, env);
      await expect(t.client.connect({ mode: "voice" })).rejects.toMatchObject({ code: "microphone_denied" });
      expect(t.client.getSnapshot()).toMatchObject({ status: "error", error: { code: "microphone_denied" } });
      expect(t.fetchImpl).not.toHaveBeenCalled();
      await t.client.connect({ mode: "chat" });
      expect(t.client.getSnapshot().status).toBe("connected");
    });

    it("flags blocked autoplay and clears it with startAudio", async () => {
      const t = setup();
      t.room.canPlaybackAudio = false;
      await t.client.connect({ mode: "voice" });
      expect(t.client.getSnapshot().audioBlocked).toBe(true);
      t.room.canPlaybackAudio = true;
      await t.client.startAudio();
      expect(t.client.getSnapshot().audioBlocked).toBe(false);
    });

    it("plays the agent's audio and removes it when the track goes away", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      const agent = t.room.addAgent();
      const track = fakeAudioTrack();
      t.room.emit("trackSubscribed", track, {}, agent);
      expect(t.env.env.attachAudio).toHaveBeenCalledOnce();
      const el = (t.env.env.attachAudio as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as HTMLMediaElement;
      t.room.emit("trackUnsubscribed", track, {}, agent);
      expect(t.env.env.detachAudio).toHaveBeenCalledWith(el);
    });

    it("turns the speaker off by removing the element, so LiveKit's startAudio can't unmute it", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      t.room.emit("trackSubscribed", fakeAudioTrack(), {}, t.room.addAgent());
      const el = (t.env.env.attachAudio as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as HTMLMediaElement;
      await t.client.setSpeakerEnabled(false);
      expect(t.env.env.detachAudio).toHaveBeenCalledWith(el);
      expect(t.client.getSnapshot().speakerEnabled).toBe(false);
      await t.client.setSpeakerEnabled(true);
      expect(t.env.env.attachAudio).toHaveBeenCalledTimes(2);
    });

    it("attaches nothing when the speaker is off before the agent's audio arrives", async () => {
      const t = setup();
      await t.client.setSpeakerEnabled(false);
      await t.client.connect({ mode: "voice" });
      t.room.emit("trackSubscribed", fakeAudioTrack(), {}, t.room.addAgent());
      expect(t.env.env.attachAudio).not.toHaveBeenCalled();
    });

    it("starts LiveKit audio inside the click when livekit-client is already loaded", () => {
      const t = setup({}, fakeEnv(), okFetch(), true);
      const p = t.client.connect({ mode: "voice" });
      expect(t.room.startAudioCalls).toBe(1);
      expect(t.room.calls[0]).toBe("startAudio");
      return p.then(() => {
        expect(t.createRoom).not.toHaveBeenCalled();
        expect(t.room.connectArgs).toEqual(["wss://lk.example.com", "tok"]);
      });
    });

    it("holds the mic permission until LiveKit's own mic is on, then releases it", async () => {
      const t = setup();
      t.room.micImpl = async () => {
        expect(t.env.hold.release).not.toHaveBeenCalled();
      };
      await t.client.connect({ mode: "voice" });
      expect(t.env.hold.release).toHaveBeenCalledOnce();
    });

    it("releases the mic hold when the session fails", async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: "agent_unavailable" }), { status: 503 }));
      const t = setup({}, fakeEnv(), fetchImpl as unknown as ReturnType<typeof okFetch>);
      await t.client.connect({ mode: "voice" }).catch(() => {});
      expect(t.env.hold.release).toHaveBeenCalledOnce();
    });

    it("leaves no mic meter running when ended while the mic is turning on", async () => {
      const t = setup();
      let finishMic!: () => void;
      t.room.micImpl = (on) => (on ? new Promise<void>((r) => (finishMic = r)) : Promise.resolve());
      const p = t.client.connect({ mode: "voice" });
      await vi.waitFor(() => expect(t.room.calls).toContain("mic:true"));
      await t.client.disconnect();
      finishMic();
      await p.catch(() => {});
      expect(t.env.analysed).not.toContain(t.room.micTrack);
      expect(t.client.getSnapshot().status).toBe("idle");
      expect(t.env.hold.release).toHaveBeenCalledOnce();
    });

    it("rejects a failed mute toggle with microphone_denied and keeps the state", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      t.room.micImpl = async () => {
        throw new Error("device busy");
      };
      const onError = vi.fn();
      t.client.on("error", onError);
      await expect(t.client.setMicEnabled(false)).rejects.toMatchObject({ code: "microphone_denied" });
      expect(t.client.getSnapshot()).toMatchObject({ status: "connected", micEnabled: true });
      expect(onError).toHaveBeenCalledOnce();
    });

    it("does not attach audio when autoPlayAudio is false", async () => {
      const t = setup({ autoPlayAudio: false });
      await t.client.connect({ mode: "voice" });
      t.room.emit("trackSubscribed", fakeAudioTrack(), {}, t.room.addAgent());
      expect(t.env.env.attachAudio).not.toHaveBeenCalled();
    });

    it("mutes and unmutes the mic", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      await t.client.setMicEnabled(false);
      expect(t.room.micEnabled).toBe(false);
      expect(t.client.getSnapshot().micEnabled).toBe(false);
      await t.client.setMicEnabled(true);
      expect(t.client.getSnapshot().micEnabled).toBe(true);
    });

    it("tracks the agent state and feeds audio levels from both tracks", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      expect(t.env.analysed).toContain(t.room.micTrack);
      const agent = t.room.addAgent();
      const track = fakeAudioTrack();
      t.room.emit("trackSubscribed", track, {}, agent);
      expect(t.env.analysed).toContain(track.mediaStreamTrack);
      agent.attributes = { "lk.agent.state": "speaking" };
      t.room.emit("participantAttributesChanged", { "lk.agent.state": "speaking" }, agent);
      expect(t.client.getSnapshot().agentState).toBe("speaking");
      const levels: number[] = [];
      t.client.subscribeAudioLevel("active", (v) => levels.push(v));
      for (let i = 0; i < 10; i++) t.env.frame();
      expect(levels.length).toBeGreaterThan(0);
      expect(t.client.getAudioLevel("active")).toBeCloseTo(t.client.getAudioLevel("agent"), 5);
    });
  });

  describe("ending", () => {
    it("ends on completed: status ended, resume token cleared, room closed", async () => {
      const t = setup();
      const onEnd = vi.fn();
      t.client.on("sessionEnd", onEnd);
      await t.client.connect();
      t.room.sendData("voxylo.session", { type: "ended", reason: "completed" }, t.room.addAgent());
      expect(t.client.getSnapshot()).toMatchObject({ status: "ended", endReason: "completed" });
      expect(t.storage.map.has("voxylo:resume:proj:main")).toBe(false);
      expect(t.room.connected).toBe(false);
      expect(onEnd).toHaveBeenCalledWith("completed");
    });

    it("keeps the resume token when the session idles out", async () => {
      const t = setup();
      await t.client.connect();
      t.room.sendData("voxylo.session", { type: "ended", reason: "idle" }, t.room.addAgent());
      expect(t.client.getSnapshot().endReason).toBe("idle");
      expect(t.storage.map.get("voxylo:resume:proj:main")).toBe("resume-new");
    });

    it("goes reconnecting and back to connected", async () => {
      const t = setup();
      await t.client.connect();
      t.room.emit("reconnecting");
      expect(t.client.getSnapshot().status).toBe("reconnecting");
      t.room.emit("reconnected");
      expect(t.client.getSnapshot().status).toBe("connected");
    });

    it("reports connection_failed when the room drops on its own", async () => {
      const t = setup();
      const onError = vi.fn();
      t.client.on("error", onError);
      await t.client.connect();
      t.room.emit("disconnected");
      expect(t.client.getSnapshot()).toMatchObject({ status: "error", error: { code: "connection_failed" } });
      expect(onError).toHaveBeenCalledOnce();
    });

    it("disconnect returns to idle and keeps the resume token", async () => {
      const t = setup();
      await t.client.connect({ mode: "voice" });
      await t.client.disconnect();
      expect(t.client.getSnapshot()).toMatchObject({ status: "idle", micEnabled: false, agentState: "idle", error: null });
      expect(t.room.connected).toBe(false);
      expect(t.storage.map.get("voxylo:resume:proj:main")).toBe("resume-new");
    });

    it("disconnect during connect cancels it and leaves no room open", async () => {
      const t = setup();
      const p = t.client.connect();
      await t.client.disconnect();
      await p.catch(() => {});
      expect(t.client.getSnapshot().status).toBe("idle");
      expect(t.room.connected).toBe(false);
    });

    it("forgetSession clears the token so the next connect starts fresh", async () => {
      const t = setup();
      await t.client.connect();
      await t.client.forgetSession();
      expect(t.storage.map.has("voxylo:resume:proj:main")).toBe(false);
      expect(t.client.getSnapshot()).toMatchObject({ status: "idle", chatId: null, messages: [] });
      await t.client.connect();
      expect(sentBody(t.fetchImpl, 1).resumeToken).toBeUndefined();
    });

    it("destroy disconnects and turns later calls into no-ops", async () => {
      const t = setup();
      await t.client.connect();
      t.client.destroy();
      await vi.waitFor(() => expect(t.room.connected).toBe(false));
      await t.client.connect();
      expect(t.fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("emits turns and streaming agent text", async () => {
    const t = setup();
    const onTurn = vi.fn();
    const onText = vi.fn();
    t.client.on("turn", onTurn);
    t.client.on("agentText", onText);
    await t.client.connect();
    const agent = t.room.addAgent();
    t.room.sendData("voxylo.turn", { turnId: "t1", role: "agent", content: "Hi, I'm Niyas's AI", atMs: 1 }, agent);
    expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({ content: "Hi, I'm Niyas's AI" }));
  });
});
