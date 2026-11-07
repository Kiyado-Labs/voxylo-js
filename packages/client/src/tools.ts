import { RPC_CLIENT_TOOL, TEXT_TOPIC_CLIENT_TOOLS } from "./protocol";
import type { RoomConnection, RpcDataLike } from "./room/adapter";

export type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: readonly string[];
  [key: string]: unknown;
};

export interface ClientToolDefinition<Args = any> {
  /** What the agent calls it: letters, digits and _, starting with a letter, at most 48 characters */
  name: string;
  /** Tells the agent when to use it, 1-1024 characters */
  description: string;
  /** JSON Schema for the arguments, at most 4 KB */
  parameters: JsonSchemaObject;
  /** 1000-60000, default 10000 */
  timeoutMs?: number;
  /** Runs in the browser; its JSON-serializable return value goes back to the agent */
  handler(args: Args, ctx: { callId: string; signal: AbortSignal }): unknown;
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export const MAX_CLIENT_TOOLS = 16;
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/;
const MAX_PARAMETERS_BYTES = 4096;
const MAX_DECLARATION_BYTES = 32768;
const MAX_RESULT_BYTES = 15000;
const DEFAULT_TIMEOUT_MS = 10000;
const DEBOUNCE_MS = 50;

const bytes = (s: string) => new TextEncoder().encode(s).length;

function validate(def: ClientToolDefinition): void {
  if (!NAME_RE.test(def.name)) {
    throw new TypeError(`Voxylo tool "${def.name}": names use letters, digits and _, start with a letter, and are at most 48 characters`);
  }
  if (typeof def.description !== "string" || def.description.trim().length < 1 || def.description.length > 1024) {
    throw new TypeError(`Voxylo tool "${def.name}": description must be 1-1024 characters and not blank`);
  }
  if (!def.parameters || def.parameters.type !== "object") {
    throw new TypeError(`Voxylo tool "${def.name}": parameters must be a JSON Schema with "type": "object"`);
  }
  if (bytes(JSON.stringify(def.parameters)) > MAX_PARAMETERS_BYTES) {
    throw new TypeError(`Voxylo tool "${def.name}": parameters must be at most 4096 bytes`);
  }
  if (def.timeoutMs !== undefined && !(Number.isInteger(def.timeoutMs) && def.timeoutMs >= 1000 && def.timeoutMs <= 60000)) {
    throw new TypeError(`Voxylo tool "${def.name}": timeoutMs must be a whole number from 1000 to 60000`);
  }
  if (typeof def.handler !== "function") throw new TypeError(`Voxylo tool "${def.name}": handler must be a function`);
}

function declare(def: ClientToolDefinition) {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    timeoutMs: def.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

const answer = (body: { ok: true; result: unknown } | { ok: false; error: string }) => JSON.stringify(body);

export class ToolRegistry {
  private readonly tools = new Map<string, ClientToolDefinition>();
  private readonly inFlight = new Set<AbortController>();
  private conn: RoomConnection | null = null;
  private rev = 0;
  private declared = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onCall: ((e: ToolCallEvent) => void) | undefined;

  constructor(opts: { onCall?: (e: ToolCallEvent) => void } = {}) {
    this.onCall = opts.onCall;
  }

  register(def: ClientToolDefinition): () => void {
    validate(def);
    if (this.tools.has(def.name)) throw new TypeError(`Voxylo tool "${def.name}" is already registered`);
    if (this.tools.size >= MAX_CLIENT_TOOLS) throw new TypeError(`Voxylo allows at most ${MAX_CLIENT_TOOLS} client tools`);
    const next = [...this.tools.values(), def].map(declare);
    if (bytes(JSON.stringify({ rev: this.rev + 1, tools: next })) > MAX_DECLARATION_BYTES) {
      throw new TypeError("Voxylo client tools must total at most 32768 bytes");
    }
    this.tools.set(def.name, def);
    this.schedule();
    return () => {
      if (this.tools.get(def.name) !== def) return;
      this.tools.delete(def.name);
      this.schedule();
    };
  }

  attach(conn: RoomConnection): void {
    this.conn = conn;
    conn.registerRpc(RPC_CLIENT_TOOL, (data) => this.handle(data));
    // A new room starts with no client tools; once anything was declared, an empty set must be sent too
    if (this.tools.size > 0 || this.declared) this.flush();
  }

  /** Sends the full set, even an empty one; call once the agent is listening */
  announce(): void {
    this.flush();
  }

  detach(): void {
    this.conn = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const c of this.inFlight) c.abort();
    this.inFlight.clear();
  }

  private schedule() {
    if (!this.conn) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const conn = this.conn;
    if (!conn) return;
    // Clock-seeded so a reloaded page outranks the declarations of the page it replaced
    this.rev = Math.max(this.rev + 1, Date.now());
    this.declared = true;
    const body = JSON.stringify({ rev: this.rev, tools: [...this.tools.values()].map(declare) });
    void conn.sendTextStream(TEXT_TOPIC_CLIENT_TOOLS, body).catch(() => {});
  }

  private async handle(data: RpcDataLike): Promise<string> {
    const conn = this.conn;
    if (!conn || !conn.isAgent(data.callerIdentity)) return answer({ ok: false, error: "forbidden" });

    let req: { callId?: unknown; name?: unknown; args?: unknown };
    try {
      req = JSON.parse(data.payload) as typeof req;
    } catch {
      return answer({ ok: false, error: "bad request" });
    }
    if (typeof req !== "object" || req === null || typeof req.name !== "string") {
      return answer({ ok: false, error: "bad request" });
    }
    const def = this.tools.get(req.name);
    if (!def) return answer({ ok: false, error: "unknown tool" });

    const args = (typeof req.args === "object" && req.args !== null ? req.args : {}) as Record<string, unknown>;
    const callId = typeof req.callId === "string" ? req.callId : "";
    const controller = new AbortController();
    this.inFlight.add(controller);
    const started = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const outcome = await new Promise<{ ok: true; result: unknown } | { ok: false; error: string }>((resolve) => {
      timeout = setTimeout(() => resolve({ ok: false, error: "timed out" }), def.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      controller.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }));
      Promise.resolve()
        .then(() => def.handler(args, { callId, signal: controller.signal }))
        .then(
          (result) => resolve({ ok: true, result: result === undefined ? null : result }),
          (err: unknown) => resolve({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    });
    clearTimeout(timeout);
    if (!controller.signal.aborted) controller.abort();
    this.inFlight.delete(controller);

    let body: string;
    if (outcome.ok) {
      try {
        body = answer(outcome);
      } catch {
        body = answer({ ok: false, error: "result is not JSON-serializable" });
      }
      if (bytes(body) > MAX_RESULT_BYTES) body = answer({ ok: false, error: "result too large" });
    } else {
      body = answer(outcome);
    }

    const parsed = JSON.parse(body) as { ok: boolean; result?: unknown; error?: string };
    this.onCall?.({
      name: def.name,
      args,
      ...(parsed.ok ? { result: parsed.result } : { error: parsed.error ?? "failed" }),
      durationMs: Date.now() - started,
    });
    return body;
  }
}
