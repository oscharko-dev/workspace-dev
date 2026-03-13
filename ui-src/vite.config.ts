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
    include: [path.resolve(uiRoot, "src/**/*.test.ts")]
  }
});
