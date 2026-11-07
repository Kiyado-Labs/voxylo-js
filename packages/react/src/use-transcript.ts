import type { Message } from "@voxylo/client";

import { useClientFromContext } from "./context";
import { unstable_useSelected as useSelected } from "./use-voxylo";

const selectMessages = (s: { messages: readonly Message[] }) => s.messages;

/**
 * The conversation so far, live on both sides: the user's words while they speak and the agent's reply as it is spoken.
 * A message with `streaming: true` is still being said and its text will change.
 */
export function useTranscript(): readonly Message[] {
  return useSelected(useClientFromContext("useTranscript"), selectMessages);
}
