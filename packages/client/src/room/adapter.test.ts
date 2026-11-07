import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "../state/types";
import { connectRoom, type RoomHandlers } from "./adapter";
import { FakeRoom, FakeTextReader, fakeAudioTrack } from "./fake-room";

const SESSION = { livekitUrl: "wss://lk", livekitToken: "tok", roomName: "r", chatId: "c" };

function handlers(): RoomHandlers & { [K in keyof RoomHandlers]: ReturnType<typeof vi.fn> } {
  return {
    onTurn: vi.fn(),
    onAgentText: vi.fn(),
    onUserText: vi.fn(),
    onRich: vi.fn(),
    onSessionEvent: vi.fn(),
    onAgentState: vi.fn(),
    onAgentAudio: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnecting: vi.fn(),
    onReconnected: vi.fn(),
    onAudioPlaybackChanged: vi.fn(),
  };
}

async function setup() {
  const room = new FakeRoom();
  const h = handlers();
  const conn = await connectRoom(room, SESSION, h, { sdk: "@voxylo/react@0.1.0" });
  return { room, h, conn };
}

describe("connectRoom", () => {
  it("connects with the session and announces the protocol and sdk", async () => {
    const { room } = await setup();
    expect(room.connectArgs).toEqual(["wss://lk", "tok"]);
    expect(room.attributes).toEqual({ "voxylo.protocol": "1", "voxylo.sdk": "@voxylo/react@0.1.0" });
  });

  it("routes turn, rich and session frames", async () => {
    const { room, h } = await setup();
    const agent = room.addAgent();
    room.sendData("voxylo.turn", { turnId: "t1", role: "agent", content: "hi", atMs: 1 }, agent);
    room.sendData("voxylo.rich", { atMs: 2, block: { type: "carousel", id: "k", cards: [{ title: "a" }, { title: "b" }] } }, agent);
    room.sendData("voxylo.session", { type: "ended", reason: "completed" }, agent);
    room.sendData("voxylo.turn", { garbage: true }, agent);
    expect(h.onTurn).toHaveBeenCalledTimes(1);
    expect(h.onTurn.mock.calls[0]?.[0]).toMatchObject({ turnId: "t1", content: "hi" });
    expect(h.onRich).toHaveBeenCalledTimes(1);
    expect(h.onSessionEvent).toHaveBeenCalledWith({ type: "ended", reason: "completed" });
  });

  it("streams agent text", async () => {
    const { room, h } = await setup();
    await room.streamText("lk.transcription", new FakeTextReader("s1", ["Hel", "lo"], { "lk.segment_id": "seg1" }), "agent-1");
    await vi.waitFor(() => expect(h.onAgentText).toHaveBeenCalledTimes(3));
    expect(h.onAgentText.mock.calls.map((c) => c[0])).toEqual([
      { streamId: "seg1", text: "Hel", done: false },
      { streamId: "seg1", text: "Hello", done: false },
      { streamId: "seg1", text: "Hello", done: true },
    ]);
    expect(h.onUserText).not.toHaveBeenCalled();
  });

  it("streams the user's own transcription live, final only when LiveKit marks it final", async () => {
    const { room, h } = await setup();
    const me = room.localParticipant.identity;
    await room.streamText("lk.transcription", new FakeTextReader("x1", ["Show me"], { "lk.segment_id": "SG_1", "lk.transcription_final": "false" }), me);
    await room.streamText("lk.transcription", new FakeTextReader("x2", ["Show me your work"], { "lk.segment_id": "SG_1", "lk.transcription_final": "false" }), me);
    await room.streamText("lk.transcription", new FakeTextReader("x3", ["Show me your work."], { "lk.segment_id": "SG_1", "lk.transcription_final": "true" }), me);
    await vi.waitFor(() => expect(h.onUserText).toHaveBeenCalledTimes(3));
    expect(h.onUserText.mock.calls.map((c) => c[0])).toEqual([
      { streamId: "SG_1", text: "Show me", done: false },
      { streamId: "SG_1", text: "Show me your work", done: false },
      { streamId: "SG_1", text: "Show me your work.", done: true },
    ]);
    expect(h.onAgentText).not.toHaveBeenCalled();
  });

  it.each<[string, AgentState]>([
    ["thinking", "thinking"],
    ["speaking", "speaking"],
    ["listening", "listening"],
    ["initializing", "idle"],
  ])("maps agent attribute lk.agent.state=%s to %s", async (raw, mapped) => {
    const { room, h } = await setup();
    const agent = room.addAgent();
    agent.attributes = { "lk.agent.state": raw };
    room.emit("participantAttributesChanged", { "lk.agent.state": raw }, agent);
    expect(h.onAgentState).toHaveBeenLastCalledWith(mapped);
  });

  it("ignores attribute changes from non-agents", async () => {
    const { room, h } = await setup();
    room.emit("participantAttributesChanged", { "lk.agent.state": "speaking" }, { identity: "x", isAgent: false, attributes: { "lk.agent.state": "speaking" } });
    expect(h.onAgentState).not.toHaveBeenCalled();
  });

  it("reports the agent's audio track on subscribe and unsubscribe", async () => {
    const { room, h } = await setup();
    const agent = room.addAgent();
    const track = fakeAudioTrack();
    room.emit("trackSubscribed", track, {}, agent);
    expect(h.onAgentAudio).toHaveBeenLastCalledWith(track);
    room.emit("trackUnsubscribed", track, {}, agent);
    expect(h.onAgentAudio).toHaveBeenLastCalledWith(null);
  });

  it("publishes commands reliably on voxylo.client.cmd", async () => {
    const { room, conn } = await setup();
    await conn.sendCommand({ type: "set_speaker", value: false });
    expect(room.published).toEqual([{ topic: "voxylo.client.cmd", reliable: true, data: { type: "set_speaker", value: false } }]);
  });

  it("toggles the mic and exposes its track", async () => {
    const { conn } = await setup();
    expect(conn.getMicTrack()).toBeNull();
    await conn.setMic(true);
    expect(conn.getMicTrack()).not.toBeNull();
  });

  it("identifies agents", async () => {
    const { room, conn } = await setup();
    room.addAgent("agent-1");
    room.remoteParticipants.set("human", { identity: "human", isAgent: false, attributes: {} });
    expect(conn.isAgent("agent-1")).toBe(true);
    expect(conn.isAgent("human")).toBe(false);
    expect(conn.isAgent("nobody")).toBe(false);
  });

  it("forwards connection lifecycle and audio playback changes", async () => {
    const { room, h } = await setup();
    room.emit("reconnecting");
    room.emit("reconnected");
    room.canPlaybackAudio = false;
    room.emit("audioPlaybackChanged", false);
    room.emit("disconnected");
    expect(h.onReconnecting).toHaveBeenCalledOnce();
    expect(h.onReconnected).toHaveBeenCalledOnce();
    expect(h.onAudioPlaybackChanged).toHaveBeenCalledWith(false);
    expect(h.onDisconnected).toHaveBeenCalledOnce();
  });

  it("does not report its own close as a disconnect and stops routing afterwards", async () => {
    const { room, h, conn } = await setup();
    const agent = room.addAgent();
    await conn.close();
    expect(room.calls).toContain("disconnect");
    expect(h.onDisconnected).not.toHaveBeenCalled();
    room.sendData("voxylo.turn", { turnId: "t", role: "agent", content: "late", atMs: 1 }, agent);
    expect(h.onTurn).not.toHaveBeenCalled();
  });

  it("rejects when the room fails to connect", async () => {
    const room = new FakeRoom();
    room.connectError = new Error("could not establish signal connection");
    await expect(connectRoom(room, SESSION, handlers(), { sdk: "x" })).rejects.toThrow("signal");
  });

  it("sends text streams on a topic", async () => {
    const { room, conn } = await setup();
    await conn.sendTextStream("voxylo.client.tools", '{"rev":1,"tools":[]}');
    expect(room.textStreams).toEqual([{ topic: "voxylo.client.tools", text: '{"rev":1,"tools":[]}' }]);
  });

  it("registers an RPC method and removes it on close", async () => {
    const { room, conn } = await setup();
    conn.registerRpc("voxylo.client_tool", async (data) => JSON.stringify({ echo: data.payload, from: data.callerIdentity }));
    expect(await room.invokeRpc("voxylo.client_tool", { a: 1 })).toEqual({ echo: '{"a":1}', from: "agent-1" });
    await conn.close();
    expect(room.rpcHandlers.has("voxylo.client_tool")).toBe(false);
  });
});

