import { useEffect, useState } from "react";
import type { LevelSource } from "@voxylo/client";

import { useClientFromContext } from "./context";

/** Audio level 0..1 as React state, at most `fps` updates a second; animations can use subscribeAudioLevel directly */
export function useAudioLevel(source: LevelSource = "active", opts: { fps?: number } = {}): number {
  const client = useClientFromContext("useAudioLevel");
  const fps = opts.fps ?? 30;
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!client) return;
    const gapMs = 1000 / Math.max(1, fps);
    let lastAt = -Infinity;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    let latest = 0;
    const flush = () => {
      trailing = null;
      lastAt = Date.now();
      setLevel(latest);
    };
    const off = client.subscribeAudioLevel(source, (v) => {
      latest = v;
      const wait = gapMs - (Date.now() - lastAt);
      if (wait <= 0) {
        if (trailing) clearTimeout(trailing);
        flush();
      } else if (!trailing) {
        // Keeps the last value of a burst so the meter never sticks on a stale level
        trailing = setTimeout(flush, wait);
      }
    });
    return () => {
      off();
      if (trailing) clearTimeout(trailing);
      setLevel(0);
    };
  }, [client, source, fps]);

  return level;
}
