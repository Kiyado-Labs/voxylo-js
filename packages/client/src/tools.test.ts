import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomConnection, RpcDataLike } from "./room/adapter";
import { ToolRegistry, type ClientToolDefinition } from "./tools";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeConn() {
  let rpc: ((d: RpcDataLike) => Promise<string>) | null = null;
  const conn = {
    sendTextStream: vi.fn(async (_topic: string, _text: string) => {}),
    registerRpc: vi.fn((_m: string, fn: (d: RpcDataLike) => Promise<string>) => {
      rpc = fn;
    }),
    isAgent: (id: string) => id === "agent-1",
  };
  const call = async (payload: unknown, caller = "agent-1") =>
    JSON.parse(await rpc!({ requestId: "r", callerIdentity: caller, payload: JSON.stringify(payload), responseTimeout: 10000 }));
  const declarations = () =>
    conn.sendTextStream.mock.calls.filter((c) => c[0] === "voxylo.client.tools").map((c) => JSON.parse(c[1] as string));
  return { conn: conn as unknown as RoomConnection, raw: conn, call, declarations };
}

const params = { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } as const;

function tool(overrides: Partial<ClientToolDefinition> = {}): ClientToolDefinition {
  return { name: "openProject", description: "Open a project page", parameters: { ...params }, handler: () => ({ opened: true }), ...overrides };
}

describe("ToolRegistry", () => {
  it("sends one debounced declaration with every tool registered within 50ms", async () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.attach(f.conn);
    reg.register(tool());
    reg.register(tool({ name: "scrollToSection", description: "Scroll to a section" }));
    await vi.advanceTimersByTimeAsync(49);
    expect(f.declarations()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.declarations()).toEqual([
      {
        rev: expect.any(Number),
        tools: [
          { name: "openProject", description: "Open a project page", parameters: params, timeoutMs: 10000 },
          { name: "scrollToSection", description: "Scroll to a section", parameters: params, timeoutMs: 10000 },
        ],
      },
    ]);
  });

  it("re-declares without a tool once it is unregistered", async () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.attach(f.conn);
    const off = reg.register(tool());
    await vi.advanceTimersByTimeAsync(50);
    off();
    await vi.advanceTimersByTimeAsync(50);
    const [first, second] = f.declarations();
    expect(second.tools).toEqual([]);
    expect(second.rev).toBeGreaterThan(first.rev);
  });

  it("seeds rev from the clock so a reloaded page outranks the page before it", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.register(tool());
    reg.attach(f.conn);
    expect(f.declarations()[0].rev).toBeGreaterThanOrEqual(1_700_000_000_000);
  });

  it("announces the full set, even an empty one, when the agent is ready", () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.attach(f.conn);
    reg.announce();
    expect(f.declarations()).toEqual([{ rev: expect.any(Number), tools: [] }]);
  });

  it("re-sends on attach once anything was declared, even if the set is now empty", async () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    const off = reg.register(tool());
    reg.attach(f.conn);
    reg.detach();
    off();
    reg.attach(f.conn);
    expect(f.declarations().at(-1)?.tools).toEqual([]);
  });

  it("sends the current set immediately when attached", () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.register(tool());
    reg.attach(f.conn);
    expect(f.declarations()).toHaveLength(1);
    expect(f.raw.registerRpc).toHaveBeenCalledWith("voxylo.client_tool", expect.any(Function));
  });

  it.each([
    ["a bad name", { name: "9open" }],
    ["an empty description", { description: "" }],
    ["array parameters", { parameters: { type: "array" } as never }],
    ["oversized parameters", { parameters: { type: "object", description: "x".repeat(5000) } as never }],
    ["a short timeout", { timeoutMs: 500 }],
    ["a long timeout", { timeoutMs: 60001 }],
    ["a fractional timeout", { timeoutMs: 1500.5 }],
    ["a blank description", { description: "   " }],
  ])("rejects %s with a TypeError", (_label, overrides) => {
    expect(() => new ToolRegistry().register(tool(overrides))).toThrow(TypeError);
  });

  it("rejects a 17th tool and a duplicate name", () => {
    const reg = new ToolRegistry();
    for (let i = 0; i < 16; i++) reg.register(tool({ name: `t${i}` }));
    expect(() => reg.register(tool({ name: "t16" }))).toThrow(TypeError);
    expect(() => reg.register(tool({ name: "t0" }))).toThrow(TypeError);
  });

  it("runs the handler for the agent and returns its result", async () => {
    const f = fakeConn();
    const handler = vi.fn(() => ({ opened: "voxylo" }));
    const onCall = vi.fn();
    const reg = new ToolRegistry({ onCall });
    reg.register(tool({ handler }));
    reg.attach(f.conn);
    expect(await f.call({ callId: "c1", name: "openProject", args: { slug: "voxylo" } })).toEqual({ ok: true, result: { opened: "voxylo" } });
    expect(handler).toHaveBeenCalledWith({ slug: "voxylo" }, expect.objectContaining({ callId: "c1", signal: expect.any(AbortSignal) }));
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ name: "openProject", args: { slug: "voxylo" }, result: { opened: "voxylo" } }));
  });

  it("returns null for a handler that returns nothing", async () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.register(tool({ handler: () => undefined }));
    reg.attach(f.conn);
    expect(await f.call({ callId: "c", name: "openProject", args: {} })).toEqual({ ok: true, result: null });
  });

  it.each<[string, ClientToolDefinition["handler"], string]>([
    ["throws", () => {
      throw new Error("boom");
    }, "boom"],
    ["rejects", async () => Promise.reject(new Error("no such project")), "no such project"],
    ["returns a cycle", () => {
      const a: Record<string, unknown> = {};
      a.self = a;
      return a;
    }, "result is not JSON-serializable"],
    ["returns too much", () => ({ big: "x".repeat(15001) }), "result too large"],
  ])("answers ok:false when the handler %s", async (_label, handler, error) => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.register(tool({ handler }));
    reg.attach(f.conn);
    expect(await f.call({ callId: "c", name: "openProject", args: {} })).toEqual({ ok: false, error });
  });

  it("refuses callers that are not the agent and unknown tools", async () => {
    const f = fakeConn();
    const handler = vi.fn();
    const reg = new ToolRegistry();
    reg.register(tool({ handler }));
    reg.attach(f.conn);
    expect(await f.call({ callId: "c", name: "openProject", args: {} }, "someone-else")).toEqual({ ok: false, error: "forbidden" });
    expect(await f.call({ callId: "c", name: "deleteEverything", args: {} })).toEqual({ ok: false, error: "unknown tool" });
    expect(await f.call("not an object")).toEqual({ ok: false, error: "bad request" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("times out a slow handler and aborts its signal", async () => {
    const f = fakeConn();
    let signal: AbortSignal | undefined;
    const reg = new ToolRegistry();
    reg.register(tool({ timeoutMs: 1000, handler: (_a, ctx) => ((signal = ctx.signal), new Promise(() => {})) }));
    reg.attach(f.conn);
    const pending = f.call({ callId: "c", name: "openProject", args: {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ ok: false, error: "timed out" });
    expect(signal?.aborted).toBe(true);
  });

  it("aborts in-flight handlers on detach", async () => {
    const f = fakeConn();
    let signal: AbortSignal | undefined;
    const reg = new ToolRegistry();
    reg.register(tool({ handler: (_a, ctx) => ((signal = ctx.signal), new Promise(() => {})) }));
    reg.attach(f.conn);
    void f.call({ callId: "c", name: "openProject", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    reg.detach();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the declaration but sends nothing while detached", async () => {
    const f = fakeConn();
    const reg = new ToolRegistry();
    reg.attach(f.conn);
    reg.detach();
    reg.register(tool());
    await vi.advanceTimersByTimeAsync(100);
    expect(f.declarations()).toHaveLength(0);
    reg.attach(f.conn);
    expect(f.declarations().at(-1)?.tools.map((t: { name: string }) => t.name)).toEqual(["openProject"]);
  });
});
