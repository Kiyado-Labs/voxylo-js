import { TEXT_TOPIC_CLIENT_CONTEXT } from "./protocol";
import type { RoomConnection } from "./room/adapter";

export const MAX_CONTEXT_BYTES = 8192;
const DEBOUNCE_MS = 100;

export type AgentContext = Record<string, unknown>;

/** What the page tells the agent about where the user is; the agent reads it at its next reply */
export class ContextChannel {
  private value: AgentContext | null = null;
  private everSet = false;
  private conn: RoomConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  set(value: AgentContext | null): void {
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
      throw new TypeError("Voxylo context must be a plain object or null");
    }
    if (value !== null && new TextEncoder().encode(JSON.stringify(value)).length > MAX_CONTEXT_BYTES) {
      throw new RangeError(`Voxylo context must be at most ${MAX_CONTEXT_BYTES} bytes as JSON`);
    }
    this.value = value;
    this.everSet = true;
    if (!this.conn) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), DEBOUNCE_MS);
  }

  attach(conn: RoomConnection): void {
    this.conn = conn;
    if (this.everSet) this.send();
  }

  /** Sends the current value, null if never set, so a resumed chat drops the previous page's context */
  announce(): void {
    this.send();
  }

  detach(): void {
    this.conn = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private send() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const conn = this.conn;
    if (!conn) return;
    void conn.sendTextStream(TEXT_TOPIC_CLIENT_CONTEXT, JSON.stringify({ context: this.value })).catch(() => {});
  }
}
