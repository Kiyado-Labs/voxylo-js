export type ToolCallView = {
  toolId: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  latencyMs?: number;
  source?: "server" | "client";
};

export type RichAction =
  | { id: string; kind: "reply"; label: string; value: string }
  | { id: string; kind: "url"; label: string; url: string };

export type RichCard = {
  title: string;
  description?: string;
  imageUrl?: string;
  actions?: RichAction[];
};

export type RichBlock =
  | { type: "buttons"; id: string; prompt?: string; actions: RichAction[] }
  | { type: "cards"; id: string; cards: RichCard[] }
  | { type: "carousel"; id: string; cards: RichCard[] };

export type RichMessage = { turnId?: string; atMs: number; block: RichBlock };

export type Turn = {
  turnId: string;
  role: "user" | "agent";
  inputMode?: "voice" | "text";
  content: string;
  atMs: number;
  latencyMs?: number;
  toolCalls?: ToolCallView[];
  blocks?: RichBlock[];
  /** true = in-flight update (later frames with the same turnId replace it); absent = final */
  partial?: boolean;
};

export type ClientCommand =
  | { type: "text_input"; text: string }
  | { type: "set_mic"; value: boolean }
  | { type: "set_speaker"; value: boolean }
  | { type: "block_action"; blockId: string; actionId: string; label: string; value: string };

/** `completed`: the agent ended it; `idle`: timed out, resumable; `unavailable`: no agent can serve this chat */
export type SessionEndReason = "completed" | "idle" | "error" | "unavailable";

export type SessionEvent =
  | { type: "ended"; reason: SessionEndReason }
  | { type: "warning"; code: string; detail: string };
