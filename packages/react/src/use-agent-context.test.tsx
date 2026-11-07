import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VoxyloProvider, useAgentContext, useClientTool } from "./index";
import { createFakeClient } from "./test/fake-client";

function Page({ path, projectSlug }: { path: string; projectSlug?: string }) {
  useAgentContext({ path, ...(projectSlug ? { projectSlug } : {}) });
  return null;
}

describe("useAgentContext", () => {
  it("sends the context, skips equal re-renders, follows changes and clears on unmount", () => {
    const client = createFakeClient();
    const ui = (path: string) => (
      <VoxyloProvider client={client}>
        <Page path={path} />
      </VoxyloProvider>
    );
    const { rerender, unmount } = render(ui("/"));
    expect(client.setContext).toHaveBeenLastCalledWith({ path: "/" });
    const calls = client.setContext.mock.calls.length;
    rerender(ui("/"));
    expect(client.setContext.mock.calls.length).toBe(calls);
    rerender(ui("/projects"));
    expect(client.setContext).toHaveBeenLastCalledWith({ path: "/projects" });
    unmount();
    expect(client.setContext).toHaveBeenLastCalledWith(null);
  });

  it("keeps the session across a page change: the old tool goes, the new context wins", () => {
    const client = createFakeClient({ status: "connected" });
    function Home() {
      useClientTool({ name: "scrollToSection", description: "Scroll", parameters: { type: "object" }, handler: () => null });
      useAgentContext({ path: "/" });
      return null;
    }
    function Project() {
      useAgentContext({ path: "/projects/voxylo", projectSlug: "voxylo" });
      return null;
    }
    const { rerender } = render(
      <VoxyloProvider client={client}>
        <Home />
      </VoxyloProvider>,
    );
    rerender(
      <VoxyloProvider client={client}>
        <Project />
      </VoxyloProvider>,
    );
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.tools.has("scrollToSection")).toBe(false);
    expect(client.setContext).toHaveBeenLastCalledWith({ path: "/projects/voxylo", projectSlug: "voxylo" });
  });
});
