export type VoxyloErrorCode =
  | "not_found"
  | "origin_not_allowed"
  | "anonymous_sessions_disabled"
  | "rate_limited"
  | "agent_unavailable"
  | "protocol_unsupported"
  | "network"
  | "connection_failed"
  | "session_failed"
  | "microphone_denied"
  | "unknown";

export class VoxyloError extends Error {
  readonly code: VoxyloErrorCode;
  readonly status?: number;

  constructor(code: VoxyloErrorCode, message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "VoxyloError";
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
  }
}

const PASSTHROUGH_CODES = new Set<VoxyloErrorCode>([
  "not_found",
  "origin_not_allowed",
  "anonymous_sessions_disabled",
  "rate_limited",
  "agent_unavailable",
  "protocol_unsupported",
]);

const STATUS_CODES: Record<number, VoxyloErrorCode> = {
  404: "not_found",
  429: "rate_limited",
  503: "agent_unavailable",
};

/** Reads the problem+json `code`; falls back to the HTTP status, then `unknown` */
export async function toVoxyloError(res: Response): Promise<VoxyloError> {
  let serverCode: string | undefined;
  let message = `Voxylo request failed with ${res.status}`;
  try {
    const body = (await res.json()) as { code?: unknown; detail?: unknown; title?: unknown };
    if (typeof body.code === "string") serverCode = body.code;
    if (typeof body.detail === "string") message = body.detail;
    else if (typeof body.title === "string") message = body.title;
  } catch {
    // Not JSON (a proxy error page); the status is all there is
  }
  const code =
    serverCode && PASSTHROUGH_CODES.has(serverCode as VoxyloErrorCode)
      ? (serverCode as VoxyloErrorCode)
      : (STATUS_CODES[res.status] ?? "unknown");
  return new VoxyloError(code, message, { status: res.status });
}

export function asVoxyloError(err: unknown, fallback: VoxyloErrorCode): VoxyloError {
  if (err instanceof VoxyloError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new VoxyloError(fallback, message, { cause: err });
}
