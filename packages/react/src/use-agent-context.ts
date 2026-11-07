import { useEffect } from "react";
import type { AgentContext } from "@voxylo/client";

import { useClientFromContext } from "./context";

/** Tells the agent what this page shows; cleared on unmount. Use it once per page */
export function useAgentContext(value: AgentContext | null): void {
  const client = useClientFromContext("useAgentContext");
  const key = JSON.stringify(value);

  useEffect(() => {
    if (!client || key === "null") return;
    try {
      client.setContext(JSON.parse(key) as AgentContext);
    } catch (err) {
      console.error("[voxylo] could not set the agent context", err);
      return;
    }
    return () => client.setContext(null);
  }, [client, key]);
}
