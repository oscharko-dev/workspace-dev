import { defineConfig } from "tsup";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

rmSync("dist", { force: true, recursive: true });

const CJS_IMPORT_META_URL_SHIM = "__workspaceDevImportMetaUrl";
const ESM_CREATE_REQUIRE_SHIM = "__workspaceDevCreateRequire";
const WORKSPACE_DEV_PIPELINES =
  process.env.WORKSPACE_DEV_PIPELINES ?? "default,rocket";
const PACKAGE_VERSION = JSON.parse(readFileSync("package.json", "utf8"))
  .version;
const isDefaultOnlyProfile = WORKSPACE_DEV_PIPELINES.trim() === "default";

const defaultProfileBoundaryPlugin = {
  name: "default-profile-boundary",
  setup(build) {
    build.onResolve(
      { filter: /^(?:\.\.?\/)+customer-profile\.js$/ },
      () => ({
        path: path.resolve(
          "src/profile-boundary/default-customer-profile-stub.ts",
        ),
      }),
    );
    build.onResolve(
      { filter: /^(?:\.\.?\/)+customer-profile-validation\.js$/ },
      () => ({
        path: path.resolve(
          "src/profile-boundary/default-profile-validation-stub.ts",
        ),
      }),
    );
    build.onResolve(
      { filter: /^(?:\.\.?\/)+rocket-pipeline-definition\.js$/ },
      () => ({
        path: path.resolve(
          "src/profile-boundary/default-rocket-pipeline-definition-stub.ts",
        ),
      }),
    );
    build.onResolve({ filter: /^\.\.\/\.\.\/package\.json$/ }, (args) => {
      if (!args.importer.endsWith("src/job-engine/visual-scoring.ts")) {
        return undefined;
      }
      return {
        namespace: "workspace-dev-profile-boundary",
        path: "package-version",
      };
    });
    build.onLoad(
      {
        filter: /^package-version$/,
        namespace: "workspace-dev-profile-boundary",
      },
      () => ({
        contents: `export default ${JSON.stringify({ version: PACKAGE_VERSION })};`,
        loader: "js",
      }),
    );
  },
};

const baseConfig = {
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  external: [
    "typescript",
    "@playwright/test",
    "playwright",
    "playwright-core",
    "chromium-bidi",
  ],
  sourcemap: true,
  cjsInterop: true,
  esbuildPlugins: isDefaultOnlyProfile ? [defaultProfileBoundaryPlugin] : [],
  esbuildOptions(options, context) {
    options.define = {
      ...(options.define ?? {}),
      "process.env.WORKSPACE_DEV_PIPELINES": JSON.stringify(
        WORKSPACE_DEV_PIPELINES,
      ),
    };
    if (context.format === "cjs") {
      options.define = {
        ...(options.define ?? {}),
        "import.meta.url": CJS_IMPORT_META_URL_SHIM,
      };
      options.banner = {
        ...(options.banner ?? {}),
        js: `${options.banner?.js ? `${options.banner.js}\n` : ""}const ${CJS_IMPORT_META_URL_SHIM} = require("node:url").pathToFileURL(__filename).href;`,
      };
      options.logOverride = {
        ...(options.logOverride ?? {}),
        "empty-import-meta": "silent",
      };
    }
  },
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
    };
  },
};

const withEsmCreateRequireBanner = (options, context) => {
  baseConfig.esbuildOptions?.(options, context);

  if (context.format === "esm") {
    options.banner = {
      ...(options.banner ?? {}),
      js: `${options.banner?.js ? `${options.banner.js}\n` : ""}import { createRequire as ${ESM_CREATE_REQUIRE_SHIM} } from "node:module";\nconst require = ${ESM_CREATE_REQUIRE_SHIM}(import.meta.url);`,
    };
  }
};

export default defineConfig([
  {
    ...baseConfig,
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      "isolated-server-entry": "src/isolated-server-entry.ts",
    },
    dts: {
      entry: {
        index: "src/index.ts",
      },
    },
    splitting: true,
    outDir: "dist",
    esbuildOptions: withEsmCreateRequireBanner,
  },
  {
    ...baseConfig,
    entry: {
      "contracts/index": "src/contracts/index.ts",
    },
    dts: {
      entry: {
        "contracts/index": "src/contracts/index.ts",
      },
    },
    splitting: false,
    outDir: "dist",
  },
]);
