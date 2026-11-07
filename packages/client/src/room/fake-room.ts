import type { AudioTrackLike, ParticipantLike, RoomLike, TextReaderLike } from "./adapter";

type Handler = (...args: any[]) => void;

export class FakeTextReader implements TextReaderLike {
  info: { id: string; attributes?: Record<string, string> };
  private readonly chunks: string[];
  constructor(id: string, chunks: string[], attributes?: Record<string, string>) {
    this.info = { id, ...(attributes ? { attributes } : {}) };
    this.chunks = chunks;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (const c of this.chunks) yield c;
  }
}

export function fakeAudioTrack(): AudioTrackLike & { attached: unknown[] } {
  const attached: unknown[] = [];
  return {
    kind: "audio",
    mediaStreamTrack: { id: "agent-audio", kind: "audio" } as unknown as MediaStreamTrack,
    attached,
    attach() {
      const el = { tagName: "AUDIO", muted: false, remove() {} } as unknown as HTMLMediaElement;
      attached.push(el);
      return el;
    },
    detach() {
      return attached.splice(0) as HTMLMediaElement[];
    },
  };
}

export class FakeRoom implements RoomLike {
  handlers = new Map<string, Set<Handler>>();
  textHandlers = new Map<string, (reader: TextReaderLike, p: { identity: string }) => void>();
  remoteParticipants = new Map<string, ParticipantLike>();
  canPlaybackAudio = true;
  connected = false;
  connectArgs: [string, string] | null = null;
  published: { topic: string; data: unknown; reliable: boolean }[] = [];
  attributes: Record<string, string> = {};
  micEnabled = false;
  micTrack = { id: "mic", kind: "audio" } as unknown as MediaStreamTrack;
  startAudioCalls = 0;
  connectError: Error | null = null;
  calls: string[] = [];
  micImpl: ((on: boolean) => Promise<void>) | null = null;

  localParticipant = {
    identity: "widget:p:local",
    publishData: async (data: Uint8Array, opts: { reliable: boolean; topic: string }) => {
      this.published.push({ topic: opts.topic, reliable: opts.reliable, data: JSON.parse(new TextDecoder().decode(data)) });
    },
    setAttributes: async (attrs: Record<string, string>) => {
      this.attributes = { ...this.attributes, ...attrs };
    },
    setMicrophoneEnabled: async (on: boolean) => {
      this.calls.push(`mic:${on}`);
      if (this.micImpl) await this.micImpl(on);
      this.micEnabled = on;
    },
    getTrackPublication: (source: string) =>
      source === "microphone" && this.micEnabled ? { track: { mediaStreamTrack: this.micTrack } } : undefined,
  };

  async connect(url: string, token: string) {
    this.calls.push("connect");
    if (this.connectError) throw this.connectError;
    this.connectArgs = [url, token];
    this.connected = true;
  }
  async disconnect() {
    this.calls.push("disconnect");
    this.connected = false;
    this.emit("disconnected");
  }
  async startAudio() {
    this.calls.push("startAudio");
    this.startAudioCalls += 1;
  }
  on(event: string, fn: Handler) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }
  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  registerTextStreamHandler(topic: string, fn: (reader: TextReaderLike, p: { identity: string }) => void) {
    this.textHandlers.set(topic, fn);
  }
  unregisterTextStreamHandler(topic: string) {
    this.textHandlers.delete(topic);
  }

  emit(event: string, ...args: unknown[]) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }
  addAgent(identity = "agent-1", attributes: Record<string, string> = {}): ParticipantLike {
    const p: ParticipantLike = { identity, isAgent: true, attributes };
    this.remoteParticipants.set(identity, p);
    return p;
  }
  sendData(topic: string, payload: unknown, from: ParticipantLike) {
    this.emit("dataReceived", new TextEncoder().encode(JSON.stringify(payload)), from, undefined, topic);
  }
  async streamText(topic: string, reader: TextReaderLike, identity: string) {
    await this.textHandlers.get(topic)?.(reader, { identity });
  }
}
