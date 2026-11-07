import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoxyloProvider, useAudioLevel } from "./index";
import { createFakeClient } from "./test/fake-client";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(fps?: number) {
  const client = createFakeClient();
  const wrapper = ({ children }: { children: ReactNode }) => <VoxyloProvider client={client}>{children}</VoxyloProvider>;
  let renders = 0;
  const hook = renderHook(
    () => {
      renders++;
      return useAudioLevel("active", fps ? { fps } : undefined);
    },
    { wrapper },
  );
  return { client, ...hook, renders: () => renders };
}

describe("useAudioLevel", () => {
  it("starts at 0 and follows the level", () => {
    const { client, result } = setup();
    expect(result.current).toBe(0);
    act(() => client.emitLevel("active", 0.5));
    expect(result.current).toBe(0.5);
  });

  it("re-renders at most fps times per second and settles on the last value", () => {
    const { client, result, renders } = setup(30);
    const start = renders();
    for (let i = 1; i <= 60; i++) {
      act(() => {
        client.emitLevel("active", i / 100);
        vi.advanceTimersByTime(1000 / 60);
      });
    }
    expect(renders() - start).toBeLessThanOrEqual(31);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(0.6);
  });

  it("only listens to its own source", () => {
    const { client, result } = setup();
    act(() => client.emitLevel("agent", 0.9));
    expect(result.current).toBe(0);
  });

  it("unsubscribes on unmount", () => {
    const { client, unmount } = setup();
    expect(client.levelSubscribers()).toBe(1);
    unmount();
    expect(client.levelSubscribers()).toBe(0);
  });
});
