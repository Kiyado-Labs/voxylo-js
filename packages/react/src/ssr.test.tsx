// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoxyloProvider, useVoiceAgent, useVoxyloState } from "./index";

function Status() {
  const status = useVoxyloState((s) => s.status);
  const voice = useVoiceAgent();
  return <p>{`${status}/${voice.status}/${String(voice.muted)}`}</p>;
}

describe("server rendering", () => {
  it("renders without a DOM and without connecting", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <VoxyloProvider options={{ projectId: "p" }}>
        <Status />
      </VoxyloProvider>,
    );
    expect(html).toContain("idle/idle/false");
  });
});
