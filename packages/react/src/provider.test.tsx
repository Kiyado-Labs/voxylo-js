import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeClient, type FakeClient } from "./test/fake-client";

const created = vi.hoisted(() => [] as { options: unknown; client: unknown }[]);

vi.mock("@voxylo/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voxylo/client")>();
  const { createFakeClient: make } = await import("./test/fake-client");
  return {
    ...actual,
    createVoxyloClient: vi.fn((options: unknown) => {
      const client = make();
      created.push({ options, client });
      return client;
    }),
  };
});

import { VoxyloProvider, useVoxylo, useVoxyloClient, useVoxyloState } from "./index";

afterEach(() => {
  created.length = 0;
  vi.restoreAllMocks();
});

describe("VoxyloProvider", () => {
  it("leaves exactly one live client under Strict Mode and destroys it on unmount", () => {
    let seen: unknown = null;
    function Probe() {
      seen = useVoxyloClient();
      return null;
    }
    const { unmount } = render(
      <StrictMode>
        <VoxyloProvider options={{ projectId: "p" }}>
          <Probe />
        </VoxyloProvider>
      </StrictMode>,
    );
    const live = created.filter((c) => !(c.client as FakeClient).destroy.mock.calls.length);
    expect(live).toHaveLength(1);
    expect(seen).toBe(live[0]?.client);
    unmount();
    expect((live[0]?.client as FakeClient).destroy).toHaveBeenCalledOnce();
  });

  it("names itself as @voxylo/react to the client", () => {
    render(<VoxyloProvider options={{ projectId: "p" }}>{null}</VoxyloProvider>);
    expect(created[0]?.options).toMatchObject({ projectId: "p", unstable_sdk: { name: "@voxylo/react" } });
  });

  it("keeps the same client and warns once when options change after mount", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<VoxyloProvider options={{ projectId: "p" }}>{null}</VoxyloProvider>);
    rerender(<VoxyloProvider options={{ projectId: "other" }}>{null}</VoxyloProvider>);
    rerender(<VoxyloProvider options={{ projectId: "third" }}>{null}</VoxyloProvider>);
    expect(created).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not warn when an equal options object is passed again", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<VoxyloProvider options={{ projectId: "p", getSession: async () => ({}) as never }}>{null}</VoxyloProvider>);
    rerender(<VoxyloProvider options={{ projectId: "p", getSession: async () => ({}) as never }}>{null}</VoxyloProvider>);
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses a client passed in and never destroys it", () => {
    const client = createFakeClient();
    let seen: unknown = null;
    function Probe() {
      seen = useVoxyloClient();
      return null;
    }
    const { unmount } = render(
      <VoxyloProvider client={client}>
        <Probe />
      </VoxyloProvider>,
    );
    expect(seen).toBe(client);
    unmount();
    expect(client.destroy).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});

describe("state hooks", () => {
  function wrapperFor(client: FakeClient) {
    return ({ children }: { children: ReactNode }) => <VoxyloProvider client={client}>{children}</VoxyloProvider>;
  }

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useVoxylo())).toThrow("useVoxylo must be used inside <VoxyloProvider>");
  });

  it("re-renders a selector only when its value changes", () => {
    const client = createFakeClient();
    let renders = 0;
    renderHook(
      () => {
        renders++;
        return useVoxyloState((s) => s.status);
      },
      { wrapper: wrapperFor(client) },
    );
    const before = renders;
    act(() => client.setState({ micEnabled: true }));
    expect(renders).toBe(before);
    act(() => client.setState({ status: "connecting" }));
    expect(renders).toBe(before + 1);
  });

  it("returns the state and actions that keep their identity", () => {
    const client = createFakeClient();
    const { result, rerender } = renderHook(() => useVoxylo(), { wrapper: wrapperFor(client) });
    const first = result.current;
    act(() => client.setState({ status: "connected" }));
    rerender();
    expect(result.current.state.status).toBe("connected");
    expect(result.current.connect).toBe(first.connect);
    expect(result.current.setMicEnabled).toBe(first.setMicEnabled);
    void result.current.connect({ mode: "voice" });
    expect(client.connect).toHaveBeenCalledWith({ mode: "voice" });
  });
});
