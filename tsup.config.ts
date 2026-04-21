import { defineConfig } from "tsup";
import { rmSync } from "node:fs";

rmSync("dist", { force: true, recursive: true });

const CJS_IMPORT_META_URL_SHIM = "__workspaceDevImportMetaUrl";
const ESM_CREATE_REQUIRE_SHIM = "__workspaceDevCreateRequire";

const baseConfig = {
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  external: ["typescript", "@playwright/test", "playwright", "playwright-core", "chromium-bidi"],
  sourcemap: true,
  cjsInterop: true,
  esbuildOptions(options, context) {
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
};

const withEsmCreateRequireBanner = (options, context) => {
  baseConfig.esbuildOptions?.(options, context);

  if (context.format === "esm") {
    options.banner = {
      ...(options.banner ?? {}),
      js: `${options.banner?.js ? `${options.banner.js}\n` : ""}import { createRequire as ${ESM_CREATE_REQUIRE_SHIM} } from "node:module";\nconst require = ${ESM_CREATE_REQUIRE_SHIM}(import.meta.url);`
    };
  }
};

export default defineConfig([
  {
    ...baseConfig,
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      "isolated-server-entry": "src/isolated-server-entry.ts"
    },
    dts: {
      entry: {
        index: "src/index.ts"
      }
    },
    splitting: true,
    outDir: "dist",
    esbuildOptions: withEsmCreateRequireBanner
  },
  {
    ...baseConfig,
    entry: {
      "contracts/index": "src/contracts/index.ts"
    },
    dts: {
      entry: {
        "contracts/index": "src/contracts/index.ts"
      }
    },
    splitting: false,
    outDir: "dist"
  }
]);
