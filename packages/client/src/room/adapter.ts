import {
  ATTR_AGENT_STATE,
  ATTR_PROTOCOL,
  ATTR_SDK,
  PROTOCOL_VERSION,
  TOPIC_CLIENT_CMD,
  TOPIC_RICH,
  TOPIC_SESSION,
  TOPIC_TRANSCRIPTION,
  TOPIC_TURN,
  decodeJson,
  parseRichMessage,
  parseSessionEvent,
  parseTurn,
  type ClientCommand,
  type RichMessage,
  type SessionEvent,
  type Turn,
} from "../protocol";
import type { VoxyloSession } from "../session";
import type { AgentState } from "../state/types";

/** The parts of livekit-client's Room the SDK relies on; tests drive a fake with the same shape */
export interface ParticipantLike {
  identity: string;
  isAgent?: boolean;
  attributes: Record<string, string>;
}

export interface AudioTrackLike {
  kind: string;
  mediaStreamTrack: MediaStreamTrack;
  attach(): HTMLMediaElement;
  detach(): HTMLMediaElement[];
}

export interface TextReaderLike extends AsyncIterable<string> {
  info: { id: string; attributes?: Record<string, string> };
}

export interface RpcDataLike {
  requestId: string;
  callerIdentity: string;
  payload: string;
  responseTimeout: number;
}

export interface LocalParticipantLike {
  identity: string;
  sendText(text: string, opts: { topic: string }): Promise<unknown>;
  publishData(data: Uint8Array, opts: { reliable: boolean; topic: string }): Promise<void>;
  setAttributes(attributes: Record<string, string>): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  getTrackPublication(source: "microphone"): { track?: { mediaStreamTrack: MediaStreamTrack } } | undefined;
}

export interface RoomLike {
  localParticipant: LocalParticipantLike;
  remoteParticipants: Map<string, ParticipantLike>;
  canPlaybackAudio: boolean;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  startAudio(): Promise<void>;
  on(event: string, fn: (...args: any[]) => void): unknown;
  off(event: string, fn: (...args: any[]) => void): unknown;
  registerTextStreamHandler(topic: string, handler: (reader: TextReaderLike, participant: { identity: string }) => void): void;
  registerRpcMethod(method: string, handler: (data: RpcDataLike) => Promise<string>): void;
  unregisterRpcMethod(method: string): void;
  unregisterTextStreamHandler?(topic: string): void;
}

/** Agent reply text as it is generated; `text` is the whole reply so far */
export interface AgentTextEvent {
  streamId: string;
  text: string;
  done: boolean;
}

export interface RoomHandlers {
  onTurn(turn: Turn): void;
  onAgentText(e: AgentTextEvent): void;
  onRich(message: RichMessage): void;
  onSessionEvent(e: SessionEvent): void;
  onAgentState(state: AgentState): void;
  onAgentAudio(track: AudioTrackLike | null): void;
  onDisconnected(): void;
  onReconnecting(): void;
  onReconnected(): void;
  onAudioPlaybackChanged(canPlay: boolean): void;
}

export interface RoomConnection {
  sendCommand(cmd: ClientCommand): Promise<void>;
  /** Text streams have no size cap, unlike data packets (~15 KB) */
  sendTextStream(topic: string, text: string): Promise<void>;
  registerRpc(method: string, handler: (data: RpcDataLike) => Promise<string>): void;
  setMic(on: boolean): Promise<void>;
  getMicTrack(): MediaStreamTrack | null;
  isAgent(identity: string): boolean;
  startAudio(): Promise<boolean>;
  close(): Promise<void>;
}

// livekit-client RoomEvent values; kept as strings so this module never loads livekit-client itself
const EV = {
  dataReceived: "dataReceived",
  attributesChanged: "participantAttributesChanged",
  disconnected: "disconnected",
  reconnecting: "reconnecting",
  reconnected: "reconnected",
  audioPlayback: "audioPlaybackChanged",
  trackSubscribed: "trackSubscribed",
  trackUnsubscribed: "trackUnsubscribed",
} as const;

function toAgentState(raw: string | undefined): AgentState {
  return raw === "listening" || raw === "thinking" || raw === "speaking" ? raw : "idle";
}

export async function connectRoom(
  room: RoomLike,
  session: Pick<VoxyloSession, "livekitUrl" | "livekitToken">,
  handlers: RoomHandlers,
  opts: { sdk: string },
): Promise<RoomConnection> {
  let closed = false;
  const listeners: [string, (...args: any[]) => void][] = [];
  const listen = (event: string, fn: (...args: any[]) => void) => {
    const guarded = (...args: any[]) => {
      if (!closed) fn(...args);
    };
    listeners.push([event, guarded]);
    room.on(event, guarded);
  };

  listen(EV.dataReceived, (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
    if (topic === TOPIC_TURN) {
      const turn = parseTurn(decodeJson(payload));
      if (turn) handlers.onTurn(turn);
    } else if (topic === TOPIC_RICH) {
      const msg = parseRichMessage(decodeJson(payload));
      if (msg) handlers.onRich(msg);
    } else if (topic === TOPIC_SESSION) {
      const e = parseSessionEvent(decodeJson(payload));
      if (e) handlers.onSessionEvent(e);
    }
  });

  listen(EV.attributesChanged, (changed: Record<string, string>, participant: ParticipantLike) => {
    if (!participant?.isAgent || !(ATTR_AGENT_STATE in changed)) return;
    handlers.onAgentState(toAgentState(participant.attributes?.[ATTR_AGENT_STATE] ?? changed[ATTR_AGENT_STATE]));
  });

  listen(EV.trackSubscribed, (track: AudioTrackLike, _pub: unknown, participant: ParticipantLike) => {
    if (track?.kind === "audio" && participant?.isAgent) handlers.onAgentAudio(track);
  });
  listen(EV.trackUnsubscribed, (track: AudioTrackLike, _pub: unknown, participant: ParticipantLike) => {
    if (track?.kind === "audio" && participant?.isAgent) handlers.onAgentAudio(null);
  });

  listen(EV.reconnecting, () => handlers.onReconnecting());
  listen(EV.reconnected, () => handlers.onReconnected());
  listen(EV.audioPlayback, () => handlers.onAudioPlaybackChanged(room.canPlaybackAudio));
  listen(EV.disconnected, () => handlers.onDisconnected());

  room.registerTextStreamHandler(TOPIC_TRANSCRIPTION, (reader, participant) => {
    // The user's own speech is transcribed under their identity; only agent output is reply text
    if (closed || participant.identity === room.localParticipant.identity) return;
    const streamId = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
    void (async () => {
      let text = "";
      try {
        for await (const chunk of reader) {
          text += chunk;
          if (!closed) handlers.onAgentText({ streamId, text, done: false });
        }
      } catch {
        // An aborted stream still settles below; the final voxylo.turn carries the committed reply
      }
      if (!closed) handlers.onAgentText({ streamId, text, done: true });
    })();
  });

  const rpcMethods = new Set<string>();
  const detach = () => {
    for (const [event, fn] of listeners) room.off(event, fn);
    room.unregisterTextStreamHandler?.(TOPIC_TRANSCRIPTION);
    for (const m of rpcMethods) room.unregisterRpcMethod(m);
    rpcMethods.clear();
  };

  try {
    await room.connect(session.livekitUrl, session.livekitToken);
  } catch (err) {
    closed = true;
    detach();
    throw err;
  }

  void room.localParticipant
    .setAttributes({ [ATTR_PROTOCOL]: String(PROTOCOL_VERSION), [ATTR_SDK]: opts.sdk })
    .catch(() => {});

  for (const p of room.remoteParticipants.values()) {
    const state = p.isAgent ? p.attributes?.[ATTR_AGENT_STATE] : undefined;
    if (state !== undefined) handlers.onAgentState(toAgentState(state));
  }

  const encoder = new TextEncoder();
  return {
    async sendCommand(cmd) {
      await room.localParticipant.publishData(encoder.encode(JSON.stringify(cmd)), {
        reliable: true,
        topic: TOPIC_CLIENT_CMD,
      });
    },
    async sendTextStream(topic, text) {
      if (closed) return;
      await room.localParticipant.sendText(text, { topic });
    },
    registerRpc(method, handler) {
      if (closed) return;
      // LiveKit throws if a method is registered twice
      if (rpcMethods.has(method)) room.unregisterRpcMethod(method);
      rpcMethods.add(method);
      room.registerRpcMethod(method, handler);
    },
    async setMic(on) {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    getMicTrack() {
      return room.localParticipant.getTrackPublication("microphone")?.track?.mediaStreamTrack ?? null;
    },
    isAgent(identity) {
      return room.remoteParticipants.get(identity)?.isAgent === true;
    },
    async startAudio() {
      try {
        await room.startAudio();
      } catch {
        // Without a user gesture the browser refuses; canPlaybackAudio reports it
      }
      return room.canPlaybackAudio;
    },
    async close() {
      if (closed) return;
      closed = true;
      detach();
      await room.disconnect();
    },
  };
}
