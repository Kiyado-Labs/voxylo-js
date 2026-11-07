import { describe, expect, it, vi } from "vitest";

import { createLevelMonitor, type AudioEnv } from "./audio";

function fakeEnv() {
  const frames = new Map<number, (t: number) => void>();
  let nextId = 1;
  let now = 0;
  const rms = new Map<string, number>();
  const disposed: string[] = [];
  const env: AudioEnv = {
    requestFrame(cb) {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    createAnalyser(track) {
      const id = (track as unknown as { id: string }).id;
      return { read: () => rms.get(id) ?? 0, dispose: () => void disposed.push(id) };
    },
  };
  return {
    env,
    rms,
    disposed,
    pendingFrames: () => frames.size,
    frame(times = 1) {
      for (let i = 0; i < times; i++) {
        now += 16;
        const cbs = [...frames.values()];
        frames.clear();
        for (const cb of cbs) cb(now);
      }
    },
  };
}

const agentTrack = { id: "agent" } as unknown as MediaStreamTrack;
const micTrack = { id: "mic" } as unknown as MediaStreamTrack;

describe("createLevelMonitor", () => {
  it("emits agent levels in 0..1, at most once per frame", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("agent", agentTrack);
    const fn = vi.fn();
    m.subscribe("agent", fn);
    f.rms.set("agent", 0.1);
    f.frame(30);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(30);
    const last = fn.mock.calls.at(-1)?.[0] as number;
    expect(last).toBeGreaterThan(0.4);
    expect(last).toBeLessThanOrEqual(1);
    f.rms.set("agent", 5);
    f.frame(30);
    expect(m.get("agent")).toBeGreaterThan(0.999);
    expect(m.get("agent")).toBeLessThanOrEqual(1);
  });

  it("reads speech near 0.5", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("user", micTrack);
    m.subscribe("user", () => {});
    f.rms.set("mic", 0.1);
    f.frame(60);
    expect(m.get("user")).toBeCloseTo(0.5, 1);
  });

  it("follows the agent while it speaks and the mic otherwise", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("agent", agentTrack);
    m.setTrack("user", micTrack);
    m.subscribe("active", () => {});
    f.rms.set("agent", 0.2);
    f.rms.set("mic", 0.04);
    f.frame(60);
    expect(m.get("active")).toBeCloseTo(m.get("user"), 5);
    m.setAgentSpeaking(true);
    expect(m.get("active")).toBeCloseTo(m.get("agent"), 5);
  });

  it("reads a muted mic as 0", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("user", micTrack);
    m.subscribe("user", () => {});
    f.rms.set("mic", 0.2);
    f.frame(20);
    m.setUserMuted(true);
    f.frame(1);
    expect(m.get("user")).toBe(0);
  });

  it("runs no frame loop without subscribers or tracks", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("agent", agentTrack);
    expect(f.pendingFrames()).toBe(0);
    const off = m.subscribe("agent", () => {});
    expect(f.pendingFrames()).toBe(1);
    off();
    f.frame(1);
    expect(f.pendingFrames()).toBe(0);
  });

  it("settles to 0 and emits nothing more after reset", () => {
    const f = fakeEnv();
    const m = createLevelMonitor(f.env);
    m.setTrack("agent", agentTrack);
    const fn = vi.fn();
    m.subscribe("agent", fn);
    f.rms.set("agent", 0.2);
    f.frame(10);
    m.reset();
    expect(fn).toHaveBeenLastCalledWith(0);
    expect(f.disposed).toEqual(["agent"]);
    fn.mockClear();
    f.frame(10);
    expect(fn).not.toHaveBeenCalled();
    expect(m.get("agent")).toBe(0);
  });
});
