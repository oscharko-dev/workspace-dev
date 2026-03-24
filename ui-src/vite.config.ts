import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const uiRoot = fileURLToPath(new URL(".", import.meta.url));
const packageJsonPath = path.resolve(uiRoot, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
const workspaceDevVersion =
  typeof packageJson.version === "string" && packageJson.version.length > 0 ? packageJson.version : "0.0.0";

export default defineConfig({
  root: uiRoot,
  base: "/workspace/ui/",
  define: {
    __WORKSPACE_DEV_VERSION__: JSON.stringify(workspaceDevVersion)
  },
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    outDir: path.resolve(uiRoot, "../dist/ui"),
    emptyOutDir: true,
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(uiRoot, "src/test/setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reportsDirectory: path.resolve(uiRoot, "../coverage/ui"),
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/test/**",
        "src/main.tsx",
        "src/app/router.tsx",
        "src/features/workspace/workspace-page.tsx",
        "src/features/workspace/inspector-page.tsx",
        "src/features/workspace/inspector/InspectorPanel.tsx",
        "src/features/workspace/inspector/InspectorScopeContext.tsx",
        "src/lib/shiki-highlight.worker.ts"
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 80
      }
    }
  }
});
