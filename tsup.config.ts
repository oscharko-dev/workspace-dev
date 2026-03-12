import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "isolated-server-entry": "src/isolated-server-entry.ts",
    "contracts/index": "src/contracts/index.ts"
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      index: "src/index.ts",
      "contracts/index": "src/contracts/index.ts"
    }
  },
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
  cjsInterop: true,
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js"
    };
  }
});
