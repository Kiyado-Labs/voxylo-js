import { VoxyloError, toVoxyloError } from "./errors";
import { PROTOCOL_VERSION } from "./protocol";

export const DEFAULT_API_BASE = "https://api.voxylo.cloud";
export const DEFAULT_ENVIRONMENT = "main";

export interface VoxyloSession {
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
  chatId: string;
  resumeToken?: string;
  resumed?: boolean;
}

export interface CallerInfo {
  name?: string;
  email?: string;
  externalId?: string;
}

export interface StartAnonymousSessionOptions {
  apiBase?: string;
  projectId: string;
  environment: string;
  resumeToken?: string;
  caller?: CallerInfo;
  initialMode?: "voice" | "chat";
  sdk: { name: string; version: string };
  fetch?: typeof fetch;
}

function isSession(x: unknown): x is VoxyloSession {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.livekitUrl === "string" &&
    typeof s.livekitToken === "string" &&
    typeof s.roomName === "string" &&
    typeof s.chatId === "string"
  );
}

export function detectClientInfo(): { os?: string; device?: string; browser?: string } | undefined {
  if (typeof window === "undefined" || typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (typeof ua !== "string" || ua.length === 0) return undefined;
  const isMobile = /Mobi|Android|iPhone|iPod/i.test(ua);
  const isTablet = /Tablet|iPad/i.test(ua);
  const info: { os?: string; device?: string; browser?: string } = {
    device: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
  };
  if (/Windows NT/i.test(ua)) info.os = "Windows";
  else if (/Mac OS X/i.test(ua) && !isMobile) info.os = "macOS";
  else if (/Android/i.test(ua)) info.os = "Android";
  else if (/(iPhone|iPad|iPod)/i.test(ua)) info.os = "iOS";
  else if (/Linux/i.test(ua)) info.os = "Linux";
  if (/Edg\//i.test(ua)) info.browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) info.browser = "Opera";
  else if (/Chrome\//i.test(ua)) info.browser = "Chrome";
  else if (/Firefox\//i.test(ua)) info.browser = "Firefox";
  else if (/Safari\//i.test(ua)) info.browser = "Safari";
  return info;
}

export async function startAnonymousSession(opts: StartAnonymousSessionOptions): Promise<VoxyloSession> {
  const base = (opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const clientInfo = detectClientInfo();
  const body = {
    projectId: opts.projectId,
    environment: opts.environment,
    protocolVersion: PROTOCOL_VERSION,
    sdk: opts.sdk,
    ...(opts.resumeToken ? { resumeToken: opts.resumeToken } : {}),
    ...(opts.caller ? { caller: opts.caller } : {}),
    ...(opts.initialMode ? { initialMode: opts.initialMode } : {}),
    ...(clientInfo ? { clientInfo } : {}),
  };

  let res: Response;
  try {
    res = await fetchImpl(`${base}/widget/v1/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new VoxyloError("network", "Could not reach Voxylo", { cause: err });
  }
  if (!res.ok) throw await toVoxyloError(res);

  const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
  if (!json || !isSession(json.data)) {
    throw new VoxyloError("unknown", "Voxylo returned an unexpected session response", { status: res.status });
  }
  return json.data;
}
