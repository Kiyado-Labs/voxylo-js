import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const version = (rel: string) =>
  (JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  define: {
    __VOXYLO_REACT_VERSION__: JSON.stringify(version("./package.json")),
    __VOXYLO_CLIENT_VERSION__: JSON.stringify(version("../client/package.json")),
  },
  resolve: {
    alias: { "@voxylo/client": fileURLToPath(new URL("../client/src/index.ts", import.meta.url)) },
  },
  test: { environment: "jsdom" },
});
