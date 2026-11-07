import { createContext, useContext } from "react";
import type { VoxyloClient } from "@voxylo/client";

/** undefined = no provider; null = provider mounted but the client is created after hydration */
export const VoxyloContext = createContext<VoxyloClient | null | undefined>(undefined);

export function useClientFromContext(hookName: string): VoxyloClient | null {
  const client = useContext(VoxyloContext);
  if (client === undefined) throw new Error(`${hookName} must be used inside <VoxyloProvider>`);
  return client;
}
