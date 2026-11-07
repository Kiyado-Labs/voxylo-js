import { useEffect, useRef } from "react";
import type { ClientToolDefinition } from "@voxylo/client";

import { useClientFromContext } from "./context";

/**
 * Lets the agent call a function in this component while it is mounted.
 * The newest handler always runs; changing name, description, parameters or timeoutMs re-registers.
 */
export function useClientTool<Args = any>(def: ClientToolDefinition<Args>): void {
  const client = useClientFromContext("useClientTool");
  const handlerRef = useRef(def.handler);
  handlerRef.current = def.handler;
  const parametersKey = JSON.stringify(def.parameters);

  useEffect(() => {
    if (!client) return;
    try {
      return client.registerTool({
        name: def.name,
        description: def.description,
        parameters: JSON.parse(parametersKey) as ClientToolDefinition["parameters"],
        ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
        handler: (args, ctx) => handlerRef.current(args as Args, ctx),
      });
    } catch (err) {
      // A bad tool is a developer error; it shouldn't take the whole page down
      console.error(`[voxylo] could not register tool "${def.name}"`, err);
      return;
    }
  }, [client, def.name, def.description, parametersKey, def.timeoutMs]);
}
