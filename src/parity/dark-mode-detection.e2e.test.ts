import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { generateArtifacts } from "./generator-core.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping dark-mode detection E2E tests"
    : undefined;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

test("E2E: dark theme and mode toggle are emitted only when dark mode is detected", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const darkModeDetected = ir.themeAnalysis?.darkModeDetected === true;

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-dark-mode-"));
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const themePath = path.join(projectDir, "src", "theme", "theme.ts");
  const appPath = path.join(projectDir, "src", "App.tsx");
  const themeContent = await readFile(themePath, "utf8");
  const appContent = await readFile(appPath, "utf8");

  assert.equal(themeContent.includes("dark: {"), darkModeDetected);
  assert.equal(appContent.includes("function ThemeModeToggle()"), darkModeDetected);
  assert.equal(appContent.includes('data-testid="theme-mode-toggle"'), darkModeDetected);
});
