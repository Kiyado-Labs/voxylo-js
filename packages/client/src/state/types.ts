import type { VoxyloError } from "../errors";
import type { RichBlock, SessionEndReason, ToolCallView } from "../protocol";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "error";

export type AgentState = "idle" | "listening" | "thinking" | "speaking";

export interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
  streaming: boolean;
  atMs: number;
  inputMode?: "voice" | "text";
  blocks: RichBlock[];
  toolCalls: ToolCallView[];
}

export interface ClientState {
  status: ConnectionStatus;
  endReason: SessionEndReason | null;
  error: VoxyloError | null;
  messages: readonly Message[];
  agentState: AgentState;
  micEnabled: boolean;
  speakerEnabled: boolean;
  audioBlocked: boolean;
  chatId: string | null;
}

export const INITIAL_STATE: ClientState = Object.freeze({
  status: "idle",
  endReason: null,
  error: null,
  messages: Object.freeze([]) as readonly Message[],
  agentState: "idle",
  micEnabled: false,
  speakerEnabled: true,
  audioBlocked: false,
  chatId: null,
});
