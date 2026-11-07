import { useEffect, useRef, useState, type ReactNode } from "react";
import { createVoxyloClient, type VoxyloClient, type VoxyloClientOptions } from "@voxylo/client";

import { VoxyloContext } from "./context";
import { REACT_SDK_NAME, REACT_SDK_VERSION } from "./version";

export type VoxyloProviderProps =
  | { options: VoxyloClientOptions; client?: never; children?: ReactNode }
  | { client: VoxyloClient; options?: never; children?: ReactNode };

// Functions (getSession) are usually inline arrows, so only data options count as a change
function optionsKey(options: VoxyloClientOptions | undefined): string {
  return JSON.stringify(options ?? {}, (_k, v: unknown) => (typeof v === "function" ? "[fn]" : v));
}

function isDev(): boolean {
  return typeof process === "undefined" || process.env?.NODE_ENV !== "production";
}

export function VoxyloProvider(props: VoxyloProviderProps) {
  const external = props.client;
  const optionsRef = useRef(props.options);
  const firstKey = useRef(optionsKey(props.options));
  const warned = useRef(false);
  const [owned, setOwned] = useState<VoxyloClient | null>(null);

  if (!warned.current && !external && isDev() && optionsKey(props.options) !== firstKey.current) {
    warned.current = true;
    console.warn("[voxylo] VoxyloProvider options changed after mount and were ignored; remount the provider (change its key) to apply them.");
  }

  useEffect(() => {
    if (external) return;
    // Created in an effect so server rendering never builds a client
    const client = createVoxyloClient({
      unstable_sdk: { name: REACT_SDK_NAME, version: REACT_SDK_VERSION },
      ...(optionsRef.current as VoxyloClientOptions),
    });
    setOwned(client);
    return () => {
      client.destroy();
      setOwned((current) => (current === client ? null : current));
    };
  }, [external]);

  return <VoxyloContext.Provider value={external ?? owned}>{props.children}</VoxyloContext.Provider>;
}
