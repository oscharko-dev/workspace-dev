import { defineConfig } from "tsup";

const CJS_IMPORT_META_URL_SHIM = "__workspaceDevImportMetaUrl";
const ESM_CREATE_REQUIRE_SHIM = "__workspaceDevCreateRequire";

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
  external: ["typescript", "@playwright/test", "playwright", "playwright-core", "chromium-bidi"],
  sourcemap: true,
  clean: true,
  splitting: true,
  outDir: "dist",
  cjsInterop: true,
  esbuildOptions(options, context) {
    if (context.format === "esm") {
      options.banner = {
        ...(options.banner ?? {}),
        js: `${options.banner?.js ? `${options.banner.js}\n` : ""}import { createRequire as ${ESM_CREATE_REQUIRE_SHIM} } from "node:module";\nconst require = ${ESM_CREATE_REQUIRE_SHIM}(import.meta.url);`
      };
    }
    if (context.format === "cjs") {
      options.define = {
        ...(options.define ?? {}),
        "import.meta.url": CJS_IMPORT_META_URL_SHIM
      };
      options.banner = {
        ...(options.banner ?? {}),
        js: `${options.banner?.js ? `${options.banner.js}\n` : ""}const ${CJS_IMPORT_META_URL_SHIM} = require("node:url").pathToFileURL(__filename).href;`
      };
      options.logOverride = {
        ...(options.logOverride ?? {}),
        "empty-import-meta": "silent"
      };
    }
  },
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js"
    };
  }
});
