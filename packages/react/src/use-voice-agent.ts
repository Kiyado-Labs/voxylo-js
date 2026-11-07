import { useMemo, useRef } from "react";
import type { VoxyloError } from "@voxylo/client";

import { useClientFromContext } from "./context";
import { unstable_useSelected as useSelected } from "./use-voxylo";

export type VoiceAgentStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export interface VoiceAgent {
  status: VoiceAgentStatus;
  muted: boolean;
  error: VoxyloError | null;
  /** Call straight from a click handler; never rejects (failures land in status/error) */
  start(): Promise<void>;
  end(): Promise<void>;
  /** Never rejects; a failure is reported through the client's "error" event */
  toggleMute(): Promise<void>;
}

export function useVoiceAgent(): VoiceAgent {
  const client = useClientFromContext("useVoiceAgent");
  const connection = useSelected(client, (s) => s.status);
  const agentState = useSelected(client, (s) => s.agentState);
  const micEnabled = useSelected(client, (s) => s.micEnabled);
  const error = useSelected(client, (s) => s.error);
  const ref = useRef(client);
  ref.current = client;

  const actions = useMemo(
    () => ({
      start: async () => {
        await ref.current?.connect({ mode: "voice" }).catch(() => {});
      },
      end: async () => {
        await ref.current?.disconnect();
      },
      toggleMute: async () => {
        const c = ref.current;
        if (c) await c.setMicEnabled(!c.getSnapshot().micEnabled).catch(() => {});
      },
    }),
    [],
  );

  let status: VoiceAgentStatus;
  if (connection === "connected") {
    status = agentState === "thinking" || agentState === "speaking" ? agentState : "listening";
  } else if (connection === "reconnecting") {
    status = "connecting";
  } else {
    status = connection;
  }
  const live = connection === "connected" || connection === "reconnecting";

  return { status, muted: live && !micEnabled, error, ...actions };
}
