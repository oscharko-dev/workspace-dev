import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const uiRoot = fileURLToPath(new URL(".", import.meta.url));
const packageJsonPath = path.resolve(uiRoot, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
  version?: unknown;
};
const workspaceDevVersion =
  typeof packageJson.version === "string" && packageJson.version.length > 0
    ? packageJson.version
    : "0.0.0";
const isHotspotCoveragePass = process.env.UI_HOTSPOT_COVERAGE === "1";
const hotspotCoverageTargets = [
  "src/features/workspace/workspace-page.tsx",
  "src/features/workspace/inspector-page.tsx",
  "src/features/workspace/inspector/InspectorScopeContext.tsx",
  "src/features/visual-quality/visual-quality-page.tsx",
];
// These are the only remaining audited hotspot exceptions for Issue #586.
const justifiedHotspotCoverageExceptions = [
  "src/features/workspace/inspector/InspectorPanel.tsx",
  "src/lib/shiki-highlight.worker.ts",
];
const nonHotspotVisualQualityCoverageExclusions = [
  "src/features/visual-quality/empty-state.tsx",
  "src/features/visual-quality/gallery/gallery-view.tsx",
  "src/features/visual-quality/gallery/screen-detail.tsx",
  "src/features/visual-quality/gallery/screen-card.tsx",
  "src/features/visual-quality/gallery/filter-controls.tsx",
  "src/features/visual-quality/gallery/overlay-side-by-side.tsx",
  "src/features/visual-quality/gallery/overlay-onion-skin.tsx",
  "src/features/visual-quality/gallery/overlay-heatmap.tsx",
  "src/features/visual-quality/gallery/zoom-modal.tsx",
  "src/features/visual-quality/data/file-source.ts",
];

export default defineConfig({
  root: uiRoot,
  base: "/workspace/ui/",
  define: {
    __WORKSPACE_DEV_VERSION__: JSON.stringify(workspaceDevVersion),
  },
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    outDir: path.resolve(uiRoot, "../dist/ui"),
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: [path.resolve(uiRoot, "src/test/setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reportsDirectory: path.resolve(
        uiRoot,
        isHotspotCoveragePass ? "../coverage/ui-hotspots" : "../coverage/ui",
      ),
      reporter: ["text-summary", "json-summary", "lcov"],
      include: isHotspotCoveragePass
        ? hotspotCoverageTargets
        : ["src/**/*.ts", "src/**/*.tsx"],
      exclude: isHotspotCoveragePass
        ? [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "src/test/**",
            "src/main.tsx",
            "src/features/visual-quality/data/sample-report.ts",
            ...justifiedHotspotCoverageExceptions,
          ]
        : [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "src/test/**",
            "src/main.tsx",
            ...hotspotCoverageTargets,
            ...nonHotspotVisualQualityCoverageExclusions,
            "src/features/visual-quality/data/sample-report.ts",
            ...justifiedHotspotCoverageExceptions,
          ],
      thresholds: isHotspotCoveragePass
        ? {
            branches: 75,
            "src/features/workspace/inspector-page.tsx": {
              branches: 75,
            },
            "src/features/workspace/workspace-page.tsx": {
              branches: 75,
            },
            "src/features/visual-quality/visual-quality-page.tsx": {
              branches: 75,
            },
          }
        : {
            lines: 90,
            statements: 90,
            functions: 90,
            branches: 80,
          },
    },
  },
});
