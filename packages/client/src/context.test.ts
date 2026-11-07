import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextChannel } from "./context";
import type { RoomConnection } from "./room/adapter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeConn() {
  const sendTextStream = vi.fn(async (_t: string, _x: string) => {});
  const sent = () => sendTextStream.mock.calls.filter((c) => c[0] === "voxylo.client.context").map((c) => JSON.parse(c[1] as string));
  return { conn: { sendTextStream } as unknown as RoomConnection, sent };
}

describe("ContextChannel", () => {
  it("debounces sets by 100ms and sends the latest value", async () => {
    const f = fakeConn();
    const ch = new ContextChannel();
    ch.attach(f.conn);
    ch.set({ page: "/" });
    ch.set({ page: "/projects/voxylo", projectSlug: "voxylo" });
    await vi.advanceTimersByTimeAsync(99);
    expect(f.sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.sent()).toEqual([{ context: { page: "/projects/voxylo", projectSlug: "voxylo" } }]);
  });

  it("re-sends the last value on attach, and nothing if it was never set", () => {
    const empty = fakeConn();
    new ContextChannel().attach(empty.conn);
    expect(empty.sent()).toEqual([]);
    const f = fakeConn();
    const ch = new ContextChannel();
    ch.set({ page: "/" });
    ch.attach(f.conn);
    expect(f.sent()).toEqual([{ context: { page: "/" } }]);
  });

  it("sends null to clear", async () => {
    const f = fakeConn();
    const ch = new ContextChannel();
    ch.set({ page: "/" });
    ch.attach(f.conn);
    ch.set(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.sent().at(-1)).toEqual({ context: null });
  });

  it("rejects values over 8192 bytes and non-objects", () => {
    const ch = new ContextChannel();
    expect(() => ch.set({ blob: "x".repeat(8200) })).toThrow(RangeError);
    expect(() => ch.set([1, 2] as never)).toThrow(TypeError);
    expect(() => ch.set("page" as never)).toThrow(TypeError);
  });

  it("sends nothing after detach", async () => {
    const f = fakeConn();
    const ch = new ContextChannel();
    ch.attach(f.conn);
    ch.set({ page: "/" });
    ch.detach();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.sent()).toEqual([]);
  });

  it("announces null when the agent is ready and nothing was set, clearing a previous page's context", () => {
    const f = fakeConn();
    const ch = new ContextChannel();
    ch.attach(f.conn);
    ch.announce();
    expect(f.sent()).toEqual([{ context: null }]);
  });
});
