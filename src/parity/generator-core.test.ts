import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeterministicAppFile,
  createDeterministicScreenFile,
  createDeterministicThemeFile,
  generateArtifacts,
  toDeterministicScreenPath
} from "./generator-core.js";

const createIr = () => ({
  sourceName: "Demo",
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#00aa55",
      background: "#fafafa",
      text: "#222222"
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16
  },
  screens: [
    {
      id: "screen-1",
      name: "Übersicht",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "n1",
          name: "Titel",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Willkommen"
        },
        {
          id: "n2",
          name: "Konto Input",
          nodeType: "FRAME",
          type: "input" as const,
          text: "Kontonummer"
        },
        {
          id: "n3",
          name: "Weiter Button",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ]
});

test("deterministic file helpers create expected paths and content", () => {
  const ir = createIr();
  const screen = ir.screens[0];

  assert.equal(toDeterministicScreenPath("Kredit Übersicht"), "src/screens/Kredit_bersicht.tsx");
  assert.equal(createDeterministicThemeFile(ir).path, "src/theme/theme.ts");
  assert.equal(createDeterministicScreenFile(screen).path.startsWith("src/screens/"), true);
  assert.equal(createDeterministicAppFile(ir.screens).path, "src/App.tsx");
});

test("generateArtifacts writes deterministic output and mapping diagnostics", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-"));
  const logs: string[] = [];

  const result = await generateArtifacts({
    projectDir,
    ir: createIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => {
      logs.push(message);
    },
    componentMappings: [
      {
        boardKey: "board-a",
        nodeId: "n2",
        componentName: "MappedInput",
        importPath: "@acme/ui",
        priority: 1,
        source: "local_override",
        enabled: true
      },
      {
        boardKey: "board-a",
        nodeId: "unknown-node",
        componentName: "Mismatch",
        importPath: "@acme/ui",
        priority: 2,
        source: "code_connect_import",
        enabled: true
      },
      {
        boardKey: "board-a",
        nodeId: "disabled-node",
        componentName: "Disabled",
        importPath: "@acme/ui",
        priority: 3,
        source: "code_connect_import",
        enabled: false
      }
    ]
  });

  assert.equal(result.themeApplied, false);
  assert.equal(result.screenApplied, 0);
  assert.equal(result.screenTotal, 1);
  assert.equal(result.generatedPaths.includes("src/App.tsx"), true);
  assert.equal(result.mappingDiagnostics.missingMappingCount >= 1, true);
  assert.equal(result.mappingDiagnostics.contractMismatchCount >= 1, true);
  assert.equal(result.mappingDiagnostics.disabledMappingCount >= 1, true);
  assert.ok(logs.some((entry) => entry.includes("deterministic")));

  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");
  assert.ok(appContent.includes("HashRouter"));
  assert.ok(appContent.includes("Suspense"));
});

test("generateArtifacts rejects non-deterministic mode in workspace-dev", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-mode-"));

  await assert.rejects(
    () =>
      generateArtifacts({
        projectDir,
        ir: createIr(),
        llmCodegenMode: "hybrid",
        llmModelName: "qwen",
        onLog: () => {
          // no-op
        }
      }),
    /Only deterministic code generation is supported/
  );
});

test("createDeterministicAppFile uses lazy route-level loading for non-initial screens", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([
    ir.screens[0],
    {
      ...ir.screens[0],
      id: "screen-2",
      name: "Settings"
    }
  ]);

  assert.ok(appFile.content.includes("Suspense"));
  assert.ok(appFile.content.includes("const LazySettingsScreen = lazy"));
  assert.ok(appFile.content.includes('element={<LazySettingsScreen />}'));
});

test("createDeterministicAppFile omits lazy import when only one screen exists", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]]);

  assert.ok(appFile.content.includes('import { Suspense } from "react";'));
  assert.equal(appFile.content.includes('import { Suspense, lazy } from "react";'), false);
  assert.equal(appFile.content.includes("const Lazy"), false);
  assert.equal(appFile.content.includes("= lazy(async"), false);
});
