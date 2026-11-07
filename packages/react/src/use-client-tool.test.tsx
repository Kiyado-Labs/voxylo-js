import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { VoxyloProvider, useClientTool } from "./index";
import { createFakeClient, type FakeClient } from "./test/fake-client";

const parameters = { type: "object" as const, properties: { slug: { type: "string" } } };

function Tool({ description = "Open a project page", handler }: { description?: string; handler: (args: { slug: string }) => unknown }) {
  useClientTool({ name: "openProject", description, parameters: { ...parameters }, handler });
  return null;
}

function mount(client: FakeClient, ui: React.ReactNode, strict = false) {
  const tree = <VoxyloProvider client={client}>{ui}</VoxyloProvider>;
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const ctx = { callId: "c", signal: new AbortController().signal };

describe("useClientTool", () => {
  it("registers on mount and unregisters on unmount", () => {
    const client = createFakeClient();
    const { unmount } = mount(client, <Tool handler={() => 1} />);
    expect(client.tools.has("openProject")).toBe(true);
    unmount();
    expect(client.tools.has("openProject")).toBe(false);
  });

  it("calls the newest handler without re-registering on re-render", async () => {
    const client = createFakeClient();
    const first = vi.fn(() => "first");
    const second = vi.fn(() => "second");
    const { rerender } = mount(client, <Tool handler={first} />);
    rerender(
      <VoxyloProvider client={client}>
        <Tool handler={second} />
      </VoxyloProvider>,
    );
    expect(client.registerTool).toHaveBeenCalledTimes(1);
    expect(await client.tools.get("openProject")!.handler({ slug: "voxylo" }, ctx)).toBe("second");
    expect(first).not.toHaveBeenCalled();
  });

  it("re-registers when the description changes", () => {
    const client = createFakeClient();
    const { rerender } = mount(client, <Tool handler={() => 1} />);
    rerender(
      <VoxyloProvider client={client}>
        <Tool description="Open one of Niyas's projects" handler={() => 1} />
      </VoxyloProvider>,
    );
    expect(client.registerTool).toHaveBeenCalledTimes(2);
    expect(client.tools.get("openProject")?.description).toBe("Open one of Niyas's projects");
  });

  it("leaves exactly one registration under Strict Mode", () => {
    const client = createFakeClient();
    mount(client, <Tool handler={() => 1} />, true);
    expect(client.tools.size).toBe(1);
  });

  it("logs instead of crashing the page when registration fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createFakeClient();
    client.tools.set("openProject", { name: "openProject" } as never);
    expect(() => mount(client, <Tool handler={() => 1} />)).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("openProject"), expect.any(TypeError));
    error.mockRestore();
  });
});
