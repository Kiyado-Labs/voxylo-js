import { describe, expect, it, vi } from "vitest";

import { VoxyloError } from "./errors";
import { startAnonymousSession } from "./session";

const SESSION = {
  livekitUrl: "wss://lk.example.com",
  livekitToken: "tok",
  roomName: "widget-1",
  chatId: "c".repeat(24),
  resumeToken: "r1",
  resumed: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } });
}

const base = {
  apiBase: "https://api.example.com",
  projectId: "p".repeat(24),
  environment: "main",
  sdk: { name: "@voxylo/react", version: "0.1.0" },
};

describe("startAnonymousSession", () => {
  it("posts the project, environment, protocol version and sdk to /widget/v1/start", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: SESSION }));
    const session = await startAnonymousSession({ ...base, resumeToken: "old", initialMode: "voice", fetch: fetchImpl });
    expect(session).toEqual(SESSION);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/widget/v1/start");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      projectId: base.projectId,
      environment: "main",
      protocolVersion: 1,
      sdk: base.sdk,
      resumeToken: "old",
      initialMode: "voice",
    });
  });

  it("defaults the api base to https://api.voxylo.cloud", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: SESSION }));
    await startAnonymousSession({ ...base, apiBase: undefined, fetch: fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://api.voxylo.cloud/widget/v1/start");
  });

  it.each([
    [403, { code: "origin_not_allowed" }, "origin_not_allowed"],
    [403, { code: "anonymous_sessions_disabled" }, "anonymous_sessions_disabled"],
    [400, { code: "protocol_unsupported" }, "protocol_unsupported"],
    [404, { code: "not_found" }, "not_found"],
    [429, { code: "too_many_requests" }, "rate_limited"],
    [503, { code: "agent_unavailable" }, "agent_unavailable"],
    [503, {}, "agent_unavailable"],
    [400, { code: "validation_error" }, "unknown"],
  ])("maps HTTP %i %j to %s", async (status, body, code) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, body));
    const err = await startAnonymousSession({ ...base, fetch: fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoxyloError);
    expect((err as VoxyloError).code).toBe(code);
    expect((err as VoxyloError).status).toBe(status);
  });

  it("maps a rejected fetch to network", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await startAnonymousSession({ ...base, fetch: fetchImpl }).catch((e: unknown) => e);
    expect((err as VoxyloError).code).toBe("network");
    expect((err as VoxyloError).status).toBeUndefined();
  });

  it("maps an HTML 502 to unknown with the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const err = await startAnonymousSession({ ...base, fetch: fetchImpl }).catch((e: unknown) => e);
    expect((err as VoxyloError).code).toBe("unknown");
    expect((err as VoxyloError).status).toBe(502);
  });

  it("rejects a 200 without a usable session as unknown", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: { livekitUrl: "wss://x" } }));
    const err = await startAnonymousSession({ ...base, fetch: fetchImpl }).catch((e: unknown) => e);
    expect((err as VoxyloError).code).toBe("unknown");
  });
});
