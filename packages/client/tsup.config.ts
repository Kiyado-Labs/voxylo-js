import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  define: { __VOXYLO_CLIENT_VERSION__: JSON.stringify(pkg.version) },
});
