import { describe, expect, it } from "vitest";

import type { Turn } from "../protocol";
import { reduceMessages, settleAll, type MessageEvent } from "./messages";
import type { Message } from "./types";

const run = (events: MessageEvent[], start: readonly Message[] = []) => events.reduce((m, e) => reduceMessages(m, e, 1000), start);
const agentText = (streamId: string, text: string, done = false): MessageEvent => ({ kind: "agentText", streamId, text, done });
const userText = (streamId: string, text: string, done = false): MessageEvent => ({ kind: "userText", streamId, text, done });
const turn = (t: Partial<Turn> & Pick<Turn, "turnId" | "role" | "content">): MessageEvent => ({ kind: "turn", turn: { atMs: 2000, ...t } });

describe("reduceMessages", () => {
  it("grows one agent message from its stream and settles it when the stream ends", () => {
    const m = run([agentText("s1", "Hi"), agentText("s1", "Hi, I'm"), agentText("s1", "Hi, I'm Niyas's AI", true)]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "agent", text: "Hi, I'm Niyas's AI", streaming: false });
  });

  it("ignores an empty first frame", () => {
    expect(run([agentText("s1", "")])).toEqual([]);
  });

  it("lets the final agent turn settle the streamed message, and late frames can't change it", () => {
    const m = run([
      agentText("s1", "Hello there"),
      turn({ turnId: "t1", role: "agent", content: "Hello there.", latencyMs: 640 }),
      agentText("s1", "Hello there, stale"),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "agent", text: "Hello there.", streaming: false });
  });

  it("shows the user's words live and settles them with the final user turn", () => {
    const m = run([
      userText("u1", "Show me"),
      userText("u1", "Show me your latest"),
      userText("u1", "Show me your latest project", true),
      turn({ turnId: "t2", role: "user", inputMode: "voice", content: "Show me your latest project" }),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: "user", inputMode: "voice", text: "Show me your latest project", streaming: false });
  });

  it("keeps the user's message streaming until the final transcript", () => {
    const m = run([userText("u1", "Show me")]);
    expect(m[0]).toMatchObject({ role: "user", text: "Show me", streaming: true });
  });

  it("appends a user turn that had no live stream (typed input)", () => {
    const m = run([turn({ turnId: "t3", role: "user", inputMode: "text", content: "hello" })]);
    expect(m).toEqual([expect.objectContaining({ role: "user", text: "hello", inputMode: "text", streaming: false })]);
  });

  it("keeps the conversation in order across both speakers", () => {
    const m = run([
      agentText("s1", "Hi!", true),
      turn({ turnId: "a1", role: "agent", content: "Hi!" }),
      userText("u1", "Tell me about Voxylo", true),
      turn({ turnId: "u1t", role: "user", inputMode: "voice", content: "Tell me about Voxylo" }),
      agentText("s2", "Voxylo is", false),
    ]);
    expect(m.map((x) => `${x.role}:${x.text}:${x.streaming}`)).toEqual([
      "agent:Hi!:false",
      "user:Tell me about Voxylo:false",
      "agent:Voxylo is:true",
    ]);
  });

  it("follows legacy partial agent turns by turn id", () => {
    const m = run([
      turn({ turnId: "t1", role: "agent", content: "Partial", partial: true }),
      turn({ turnId: "t1", role: "agent", content: "Partial and final" }),
    ]);
    expect(m).toEqual([expect.objectContaining({ role: "agent", text: "Partial and final", streaming: false })]);
  });

  it("attaches live rich blocks to the latest agent message once, and starts one if needed", () => {
    const block = { type: "buttons" as const, id: "b1", actions: [{ id: "a", kind: "reply" as const, label: "Yes", value: "yes" }] };
    const early = run([{ kind: "rich", message: { atMs: 1, block } }]);
    expect(early).toEqual([expect.objectContaining({ role: "agent", text: "", blocks: [block] })]);
    const m = run([agentText("s1", "Pick one", true), { kind: "rich", message: { atMs: 1, block } }, { kind: "rich", message: { atMs: 2, block } }]);
    expect(m).toHaveLength(1);
    expect(m[0]?.blocks).toEqual([block]);
  });

  it("carries tool calls and persisted blocks from the final turn without duplicating live blocks", () => {
    const block = { type: "carousel" as const, id: "k1", cards: [{ title: "A" }, { title: "B" }] };
    const m = run([
      agentText("s1", "Here you go"),
      { kind: "rich", message: { atMs: 1, block } },
      turn({ turnId: "t1", role: "agent", content: "Here you go", blocks: [block], toolCalls: [{ toolId: "c", name: "openProject", args: { slug: "voxylo" }, source: "client" }] }),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]?.blocks).toEqual([block]);
    expect(m[0]?.toolCalls.map((c) => c.name)).toEqual(["openProject"]);
  });

  it("shows a user turn that beats its transcript stream only once", () => {
    const m = run([turn({ turnId: "t1", role: "user", inputMode: "voice", content: "Yes" }), userText("SG_1", "Yes", true)]);
    expect(m.map((x) => `${x.role}:${x.text}`)).toEqual(["user:Yes"]);
  });

  it("keeps the turn's words when its late stream sends older interim text", () => {
    const m = run([turn({ turnId: "t1", role: "user", inputMode: "voice", content: "Yes please" }), userText("SG_1", "Yes", false)]);
    expect(m.map((x) => `${x.text}:${x.streaming}`)).toEqual(["Yes please:false"]);
  });

  it("keeps two quick utterances apart when the second turn overtakes its stream", () => {
    const m = run([
      userText("SG_1", "Hello", true),
      turn({ turnId: "t1", role: "user", inputMode: "voice", content: "Hello" }),
      turn({ turnId: "t2", role: "user", inputMode: "voice", content: "How are you" }),
      userText("SG_2", "How are you", true),
    ]);
    expect(m.map((x) => x.text)).toEqual(["Hello", "How are you"]);
  });

  it("never merges a typed turn into a voice line that is still being spoken", () => {
    const m = run([userText("SG_1", "Show me"), turn({ turnId: "t1", role: "user", inputMode: "text", content: "hi" })]);
    expect(m.map((x) => `${x.inputMode}:${x.text}`)).toEqual(["voice:Show me", "text:hi"]);
  });

  it("settles the newest unfinished agent reply, not an interrupted older one", () => {
    const m = run([
      agentText("s1", "Let me tell you", true),
      agentText("s2", "Sure"),
      turn({ turnId: "a2", role: "agent", content: "Sure, here it is." }),
    ]);
    expect(m.map((x) => x.text)).toEqual(["Let me tell you", "Sure, here it is."]);
  });

  it("matches a user turn to the stream with the same words over an abandoned interim", () => {
    const m = run([
      userText("SG_1", "uh"),
      userText("SG_2", "show me", true),
      turn({ turnId: "t1", role: "user", inputMode: "voice", content: "show me" }),
    ]);
    expect(m.map((x) => `${x.text}:${x.streaming}`)).toEqual(["uh:true", "show me:false"]);
  });

  it("settleAll stops every live line and keeps later turns out of them", () => {
    const settled = settleAll(run([userText("SG_1", "half a sen"), agentText("s1", "Half a rep")]));
    expect(settled.every((x) => !x.streaming)).toBe(true);
    const m = run([turn({ turnId: "t9", role: "agent", content: "New session" })], settled);
    expect(m.map((x) => x.text)).toEqual(["half a sen", "Half a rep", "New session"]);
  });
});

