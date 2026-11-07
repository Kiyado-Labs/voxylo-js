import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@voxylo/client";

import { VoxyloProvider, useTranscript } from "./index";
import { createFakeClient } from "./test/fake-client";

const line = (id: string, role: Message["role"], text: string, streaming = false): Message => ({
  id,
  role,
  text,
  streaming,
  atMs: 1,
  blocks: [],
  toolCalls: [],
});

describe("useTranscript", () => {
  it("returns the live conversation and re-renders only when it changes", () => {
    const client = createFakeClient();
    let renders = 0;
    const wrapper = ({ children }: { children: ReactNode }) => <VoxyloProvider client={client}>{children}</VoxyloProvider>;
    const { result } = renderHook(
      () => {
        renders++;
        return useTranscript();
      },
      { wrapper },
    );
    expect(result.current).toEqual([]);
    const first = [line("u1", "user", "Show me", true)];
    act(() => client.setState({ messages: first }));
    expect(result.current).toBe(first);
    const before = renders;
    act(() => client.setState({ micEnabled: true }));
    expect(renders).toBe(before);
    act(() => client.setState({ messages: [line("u1", "user", "Show me your work."), line("a1", "agent", "Sure", true)] }));
    expect(result.current.map((m) => `${m.role}:${m.text}:${m.streaming}`)).toEqual(["user:Show me your work.:false", "agent:Sure:true"]);
  });

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTranscript())).toThrow("useTranscript must be used inside <VoxyloProvider>");
  });
});
