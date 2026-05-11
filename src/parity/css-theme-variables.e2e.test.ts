// ---------------------------------------------------------------------------
// css-theme-variables.e2e.test.ts — E2E test for MUI v7 CSS theme variables
// Validates extendTheme usage and colorSchemes in generated output (#301)
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import type { DesignIR } from "./types.js";
import {
  createDeterministicThemeFile,
  createDeterministicAppFile
} from "./generator-core.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

let cachedIr: DesignIR | undefined;

const deriveIrOnce = async (): Promise<DesignIR> => {
  if (cachedIr) {
    return cachedIr;
  }
  const figmaFile = await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
  cachedIr = figmaToDesignIrWithOptions(figmaFile);
  return cachedIr;
};

test("E2E: generated theme uses extendTheme instead of createTheme", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const themeFile = createDeterministicThemeFile(ir);
  const content = themeFile.content;

  assert.ok(content.includes('import { extendTheme } from "@mui/material/styles"'),
    "Theme must import extendTheme from @mui/material/styles");
  assert.ok(content.includes("extendTheme({"),
    "Theme must call extendTheme()");
  assert.equal(content.includes("createTheme"), false,
    "Theme must not reference createTheme");
  assert.equal(content.includes("cssVariables"), false,
    "Theme must not include cssVariables flag (extendTheme has CSS vars built-in)");
});

test("E2E: generated theme includes colorSchemes with light palette", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const content = createDeterministicThemeFile(ir).content;

  assert.ok(content.includes("colorSchemes: {"), "Theme must define colorSchemes");
  assert.ok(content.includes("light: {"), "Theme must define light color scheme");
  assert.ok(content.includes('mode: "light"'), "Light palette must set mode");
  assert.ok(content.includes("primary: { main:"), "Light palette must define primary color");
  assert.ok(content.includes("background: {"), "Light palette must define background colors");
  assert.ok(content.includes("text: {"), "Light palette must define text colors");
});

test("E2E: generated theme includes dark color scheme when detected", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const content = createDeterministicThemeFile(ir).content;
  const hasDark = ir.themeAnalysis?.darkModeDetected ?? true;

  if (hasDark) {
    assert.ok(content.includes("dark: {"), "Theme must define dark color scheme when dark mode detected");
    assert.ok(content.includes('mode: "dark"'), "Dark palette must set mode");
    assert.ok(content.includes('background: { default: "#121212"'),
      "Dark palette must use standard dark background");
  }
});

test("E2E: generated theme includes typography and component overrides", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const content = createDeterministicThemeFile(ir).content;

  assert.ok(content.includes("typography: {"), "Theme must define typography section");
  assert.ok(content.includes("fontFamily:"), "Typography must set fontFamily");
  assert.ok(content.includes("components: {"), "Theme must define component overrides");
  assert.ok(content.includes("MuiButton:"), "Components must include MuiButton");
  assert.ok(content.includes('textTransform: "none"'), "MuiButton must disable text transform");
});

test("E2E: generated App.tsx includes useColorScheme hook for theme mode toggle", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const appContent = createDeterministicAppFile(ir.screens).content;

  assert.match(
    appContent,
    /import\s+\{[^}]*useColorScheme[^}]*\}\s+from "@mui\/material\/styles";/,
    "App must import useColorScheme from @mui/material/styles"
  );
  assert.ok(appContent.includes("useColorScheme()"),
    "App must use useColorScheme() hook");
  assert.ok(appContent.includes("setMode(nextMode)"),
    "App must call setMode for theme switching");
  assert.ok(appContent.includes('data-testid="theme-mode-toggle"'),
    "App must include theme mode toggle button with testid");
});

test("E2E: generated theme output is deterministic across repeated derivations", { skip: skipReason }, async () => {
  const ir = await deriveIrOnce();
  const theme1 = createDeterministicThemeFile(ir).content;
  const theme2 = createDeterministicThemeFile(ir).content;
  assert.equal(theme1, theme2, "Theme output must be deterministic");
});
