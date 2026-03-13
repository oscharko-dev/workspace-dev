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

const createRegressionScreen = () => ({
  id: "reg-screen-1",
  name: "Material UI View Nachbauen",
  layoutMode: "NONE" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "reg-title",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Bauen oder kaufen",
      x: 0,
      y: 0,
      fillColor: "#222222",
      fontFamily: "Roboto",
      fontWeight: 700,
      fontSize: 21
    },
    {
      id: "reg-input",
      name: "Styled(div)",
      nodeType: "FRAME",
      type: "container" as const,
      x: 0,
      y: 40,
      width: 560,
      height: 66,
      strokeColor: "#c8c8c8",
      cornerRadius: 8,
      children: [
        {
          id: "reg-input-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Monatliche Sparrate (optional)",
          x: 12,
          y: 50,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 12
        },
        {
          id: "reg-input-value-wrapper",
          name: "MuiInputBaseRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 12,
          y: 72,
          width: 300,
          height: 20,
          children: [
            {
              id: "reg-input-value",
              name: "MuiInputBaseInput",
              nodeType: "TEXT",
              type: "text" as const,
              text: "50,00",
              x: 12,
              y: 72,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "reg-input-currency",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "€",
          x: 530,
          y: 72,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 15
        }
      ]
    },
    {
      id: "reg-select",
      name: "Styled(div)",
      nodeType: "FRAME",
      type: "container" as const,
      x: 0,
      y: 120,
      width: 560,
      height: 66,
      strokeColor: "#c8c8c8",
      cornerRadius: 8,
      children: [
        {
          id: "reg-select-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Zu welchem Monat soll die Besparung starten?",
          x: 12,
          y: 130,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 12
        },
        {
          id: "reg-select-value-root",
          name: "MuiInputRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 12,
          y: 152,
          width: 320,
          height: 20,
          children: [
            {
              id: "reg-select-value",
              name: "MuiSelectSelect",
              nodeType: "TEXT",
              type: "text" as const,
              text: "April 2026",
              x: 12,
              y: 152,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "reg-select-icon",
          name: "MuiSvgIconRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 530,
          y: 150,
          width: 20,
          height: 20
        }
      ]
    },
    {
      id: "reg-button",
      name: "MuiButtonBaseRoot",
      nodeType: "FRAME",
      type: "button" as const,
      x: 0,
      y: 210,
      width: 280,
      height: 52,
      fillColor: "#3cf00f",
      cornerRadius: 4995,
      children: [
        {
          id: "reg-button-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Weiter",
          x: 120,
          y: 222,
          fillColor: "#ffffff",
          fontFamily: "Roboto",
          fontSize: 16,
          fontWeight: 700
        },
        {
          id: "reg-button-end-icon",
          name: "MuiButtonEndIcon",
          nodeType: "FRAME",
          type: "container" as const,
          x: 160,
          y: 220,
          width: 20,
          height: 20
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
        nodeId: "n1",
        componentName: "",
        importPath: "@acme/ui",
        priority: 2,
        source: "code_connect_import",
        enabled: true
      },
      {
        boardKey: "board-a",
        nodeId: "n3",
        componentName: "Disabled",
        importPath: "@acme/ui",
        priority: 3,
        source: "code_connect_import",
        enabled: false
      },
      {
        boardKey: "board-a",
        nodeId: "unknown-node",
        componentName: "Unknown",
        importPath: "@acme/ui",
        priority: 4,
        source: "code_connect_import",
        enabled: true
      }
    ]
  });

  assert.equal(result.themeApplied, false);
  assert.equal(result.screenApplied, 0);
  assert.equal(result.screenTotal, 1);
  assert.equal(result.generatedPaths.includes("src/App.tsx"), true);
  assert.equal(result.mappingCoverage?.usedMappings, 1);
  assert.equal(result.mappingCoverage?.fallbackNodes, 3);
  assert.equal(result.mappingCoverage?.totalCandidateNodes, 4);
  assert.equal(result.mappingDiagnostics.missingMappingCount, 1);
  assert.equal(result.mappingDiagnostics.contractMismatchCount, 1);
  assert.equal(result.mappingDiagnostics.disabledMappingCount, 1);
  assert.ok(logs.some((entry) => entry.includes("deterministic")));

  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");
  assert.ok(appContent.includes("HashRouter"));
  assert.ok(appContent.includes("Suspense"));

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(generatedScreenContent.includes('import MappedInput from "@acme/ui";'));
  assert.ok(generatedScreenContent.includes("<MappedInput"));
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

test("deterministic screen rendering keeps semantic labels and avoids Mui internal text leakage", () => {
  const screen = createRegressionScreen();
  const screenFile = createDeterministicScreenFile(screen);
  const content = screenFile.content;

  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.ok(content.includes('>{"Weiter"}</Button>'));
  assert.ok(content.includes("TextField"));
  assert.ok(content.includes("MenuItem"));
  assert.ok(content.includes("InputAdornment"));

  assert.equal(content.includes('{"MuiInputRoot"}'), false);
  assert.equal(content.includes('{"MuiInputBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonEndIcon"}'), false);
  assert.equal(/>\s*"/.test(content), false);
});
