import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  external: ["react", "@voxylo/client"],
  banner: { js: '"use client";' },
  define: { __VOXYLO_REACT_VERSION__: JSON.stringify(pkg.version) },
});
