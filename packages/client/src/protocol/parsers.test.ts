import { describe, expect, it } from "vitest";

import partial from "./fixtures/turn-partial.json";
import final from "./fixtures/turn-final.json";
import richButtons from "./fixtures/rich-buttons.json";
import richCards from "./fixtures/rich-cards.json";
import richCarousel from "./fixtures/rich-carousel.json";
import ended from "./fixtures/session-ended.json";
import endedUnknown from "./fixtures/session-ended-unknown.json";
import warning from "./fixtures/session-warning.json";
import { decodeJson, parseRichMessage, parseSessionEvent, parseTurn, PROTOCOL_VERSION } from "./index";

describe("protocol v1", () => {
  it("is version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("parses a partial agent turn", () => {
    expect(parseTurn(partial)).toEqual({ turnId: "t1", role: "agent", content: "Hel", atMs: 1000, partial: true });
  });

  it("parses a final turn, maps assistant to agent, keeps valid tool calls and blocks", () => {
    const turn = parseTurn(final);
    expect(turn?.role).toBe("agent");
    expect(turn?.inputMode).toBe("voice");
    expect(turn?.latencyMs).toBe(640);
    expect(turn?.toolCalls?.map((c) => c.name)).toEqual(["openProject", "kb_search"]);
    expect(turn?.toolCalls?.[0]?.source).toBe("client");
    expect(turn?.toolCalls?.[1]?.source).toBeUndefined();
    expect(turn?.blocks).toEqual([final.blocks[0]]);
    expect(turn?.partial).toBeUndefined();
  });

  it("keeps the turn text when its blocks are invalid", () => {
    const turn = parseTurn({ ...final, blocks: [{ type: "video", id: "x" }] });
    expect(turn?.content).toBe(final.content);
    expect(turn?.blocks).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["missing turnId", { role: "agent", content: "x", atMs: 1 }],
    ["role system", { turnId: "t", role: "system", content: "x", atMs: 1 }],
    ["non-finite atMs", { turnId: "t", role: "user", content: "x", atMs: Number.NaN }],
  ])("rejects a turn with %s", (_label, raw) => {
    expect(parseTurn(raw)).toBeNull();
  });

  it("parses buttons and drops only the non-https link", () => {
    const msg = parseRichMessage(richButtons);
    expect(msg?.turnId).toBe("t1");
    expect(msg?.block.type).toBe("buttons");
    expect(msg?.block.type === "buttons" && msg.block.actions.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("parses cards and a carousel", () => {
    expect(parseRichMessage(richCards)).toEqual(richCards);
    expect(parseRichMessage(richCarousel)).toEqual(richCarousel);
  });

  it("rejects a carousel with one card", () => {
    expect(parseRichMessage({ atMs: 1, block: { type: "carousel", id: "k", cards: [{ title: "One" }] } })).toBeNull();
  });

  it("parses session ended and maps unknown reasons to completed", () => {
    expect(parseSessionEvent(ended)).toEqual({ type: "ended", reason: "idle" });
    expect(parseSessionEvent(endedUnknown)).toEqual({ type: "ended", reason: "completed" });
  });

  it("parses a session warning", () => {
    expect(parseSessionEvent(warning)).toEqual(warning);
  });

  it("ignores unknown session frames", () => {
    expect(parseSessionEvent({ type: "paused" })).toBeNull();
    expect(parseSessionEvent({ type: "warning", code: 3 })).toBeNull();
  });

  it("decodes JSON bytes and returns undefined for garbage", () => {
    expect(decodeJson(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
    expect(decodeJson(new TextEncoder().encode("{nope"))).toBeUndefined();
  });
});
