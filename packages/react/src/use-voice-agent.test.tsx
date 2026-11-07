import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { AgentState, ConnectionStatus } from "@voxylo/client";

import { VoxyloProvider, useVoiceAgent } from "./index";
import { createFakeClient, type FakeClient } from "./test/fake-client";

function setup(client: FakeClient = createFakeClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => <VoxyloProvider client={client}>{children}</VoxyloProvider>;
  return { client, ...renderHook(() => useVoiceAgent(), { wrapper }) };
}

describe("useVoiceAgent", () => {
  it.each<[ConnectionStatus, AgentState, string]>([
    ["idle", "idle", "idle"],
    ["connecting", "idle", "connecting"],
    ["reconnecting", "speaking", "connecting"],
    ["connected", "idle", "listening"],
    ["connected", "listening", "listening"],
    ["connected", "thinking", "thinking"],
    ["connected", "speaking", "speaking"],
    ["ended", "idle", "ended"],
    ["error", "idle", "error"],
  ])("maps %s + agent %s to %s", (status, agentState, expected) => {
    const { client, result } = setup();
    act(() => client.setState({ status, agentState }));
    expect(result.current.status).toBe(expected);
  });

  it("is muted only while connected with the mic off", () => {
    const { client, result } = setup();
    expect(result.current.muted).toBe(false);
    act(() => client.setState({ status: "connected", micEnabled: false }));
    expect(result.current.muted).toBe(true);
    act(() => client.setState({ micEnabled: true }));
    expect(result.current.muted).toBe(false);
  });

  it("exposes the error", () => {
    const { client, result } = setup();
    const error = { code: "microphone_denied", message: "denied" } as never;
    act(() => client.setState({ status: "error", error }));
    expect(result.current.error).toBe(error);
  });

  it("starts voice synchronously so a click keeps its gesture", () => {
    const { client, result } = setup();
    void result.current.start();
    expect(client.connect).toHaveBeenCalledWith({ mode: "voice" });
  });

  it("start never rejects; the failure lands in state", async () => {
    const client = createFakeClient();
    client.connect.mockImplementation(async () => {
      throw new Error("denied");
    });
    const { result } = setup(client);
    await expect(result.current.start()).resolves.toBeUndefined();
  });

  it("toggleMute never rejects", async () => {
    const client = createFakeClient({ status: "connected", micEnabled: true });
    client.setMicEnabled.mockImplementation(async () => {
      throw new Error("device busy");
    });
    const { result } = setup(client);
    await expect(result.current.toggleMute()).resolves.toBeUndefined();
  });

  it("end disconnects and toggleMute flips the mic", async () => {
    const { client, result } = setup(createFakeClient({ status: "connected", micEnabled: true }));
    await act(() => result.current.toggleMute());
    expect(client.setMicEnabled).toHaveBeenCalledWith(false);
    await act(() => result.current.toggleMute());
    expect(client.setMicEnabled).toHaveBeenLastCalledWith(true);
    await act(() => result.current.end());
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
