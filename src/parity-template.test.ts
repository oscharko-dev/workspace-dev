import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(MODULE_DIR, "../../..");

const workspaceTemplateRoot = path.resolve(repoRoot, "packages/workspace-dev/template/react-mui-app");
const figmaPipeTemplateRoot = path.resolve(repoRoot, "services/api/template/react-mui-app");

const PARITY_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.ts",
  "tsconfig.json",
  "eslint.config.js",
  "src/App.tsx",
  "src/main.tsx",
  "src/theme/theme.ts"
];

const normalize = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

test("template parity: workspace-dev template matches FigmaPipe reference template", async () => {
  for (const relativePath of PARITY_FILES) {
    const workspaceContent = normalize(await readFile(path.join(workspaceTemplateRoot, relativePath), "utf8"));
    const figmaPipeContent = normalize(await readFile(path.join(figmaPipeTemplateRoot, relativePath), "utf8"));

    assert.equal(
      workspaceContent,
      figmaPipeContent,
      `Template drift detected for '${relativePath}'. Sync packages/workspace-dev/template/react-mui-app with services/api/template/react-mui-app.`
    );
  }
});

