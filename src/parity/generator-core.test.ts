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

const extractMuiIconImportLines = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^import\s+\w+\s+from\s+"@mui\/icons-material/.test(line));
};

const hasMuiIconBarrelImport = (content: string): boolean => {
  return /from\s+"@mui\/icons-material";/.test(content);
};

const extractContainerMaxWidth = (content: string): "sm" | "md" | "lg" | "xl" | undefined => {
  const match = content.match(/<Container maxWidth="(sm|md|lg|xl)"/);
  if (!match) {
    return undefined;
  }
  const value = match[1];
  if (value === "sm" || value === "md" || value === "lg" || value === "xl") {
    return value;
  }
  return undefined;
};

const findRenderedButtonLine = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const line = content
    .split("\n")
    .find((entry) => entry.includes("<Button ") && entry.includes(`{"${label}"}`));
  assert.ok(line, `Expected rendered Button line for label '${label}'`);
  return line ?? "";
};

const findRenderedTextFieldBlock = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const textFieldBlocks = content.match(/<TextField[\s\S]*?\/>/g) ?? [];
  const block = textFieldBlocks.find((entry) => entry.includes(`label={"${label}"}`));
  assert.ok(block, `Expected rendered TextField block for label '${label}'`);
  return block ?? "";
};

const findRenderedFormControlBlock = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const formControlBlocks = content.match(/<FormControl[\s\S]*?<\/FormControl>/g) ?? [];
  const block = formControlBlocks.find((entry) => entry.includes(`label={"${label}"}`));
  assert.ok(block, `Expected rendered FormControl block for label '${label}'`);
  return block ?? "";
};

const findRenderedTypographyLine = ({
  content,
  text
}: {
  content: string;
  text: string;
}): string => {
  const line = content
    .split("\n")
    .find((entry) => entry.includes("<Typography") && entry.includes(`{"${text}"}`));
  assert.ok(line, `Expected rendered Typography line for text '${text}'`);
  return line ?? "";
};

const createSemanticInputNode = ({
  id,
  name,
  label,
  placeholder,
  width = 320,
  height = 72
}: {
  id: string;
  name: string;
  label?: string;
  placeholder?: string;
  width?: number;
  height?: number;
}): any => {
  const children: any[] = [];
  if (label) {
    children.push({
      id: `${id}-label`,
      name: "Label",
      nodeType: "TEXT",
      type: "text" as const,
      text: label,
      y: 0
    });
  }
  if (placeholder) {
    children.push({
      id: `${id}-placeholder`,
      name: "Placeholder",
      nodeType: "TEXT",
      type: "text" as const,
      text: placeholder,
      textRole: "placeholder" as const,
      y: label ? 24 : 0
    });
  }

  return {
    id,
    name,
    nodeType: "FRAME",
    type: "input" as const,
    layoutMode: "VERTICAL" as const,
    gap: 4,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    width,
    height,
    children
  };
};

test("deterministic file helpers create expected paths and content", () => {
  const ir = createIr();
  const screen = ir.screens[0];

  assert.equal(toDeterministicScreenPath("Kredit Übersicht"), "src/screens/Kredit_bersicht.tsx");
  assert.equal(createDeterministicThemeFile(ir).path, "src/theme/theme.ts");
  assert.equal(createDeterministicScreenFile(screen).path.startsWith("src/screens/"), true);
  assert.equal(createDeterministicAppFile(ir.screens).path, "src/App.tsx");
});

test("deterministic screen rendering uses a single root Container without unnecessary Box import", () => {
  const screen = {
    id: "single-root-container-screen",
    name: "Single Root Container",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-root-container-text",
        name: "Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Hello Container"
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const materialImportLine = content
    .split("\n")
    .find((line) => line.startsWith("import { ") && line.endsWith(' } from "@mui/material";'));
  assert.ok(materialImportLine);
  assert.ok(materialImportLine?.includes("Container"));
  assert.ok(materialImportLine?.includes("Typography"));
  assert.equal(materialImportLine?.includes("Box"), false);
  assert.equal((content.match(/<Container /g) ?? []).length, 1);
  assert.equal(content.includes('<Box sx={{ minHeight: "100vh"'), false);
  assert.ok(content.includes('sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)"'));
});

test("deterministic screen rendering maps container maxWidth boundaries from content width", () => {
  const buildScreen = (width: number) => ({
    id: `container-width-${width}`,
    name: `Container Width ${width}`,
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: `paper-width-${width}`,
        name: `Paper ${width}`,
        nodeType: "FRAME",
        type: "paper" as const,
        x: 0,
        y: 0,
        width,
        height: 80,
        fillColor: "#ffffff",
        children: []
      }
    ]
  });

  const cases: Array<{ width: number; expected: "sm" | "md" | "lg" | "xl" }> = [
    { width: 600, expected: "sm" },
    { width: 601, expected: "md" },
    { width: 900, expected: "md" },
    { width: 901, expected: "lg" },
    { width: 1200, expected: "lg" },
    { width: 1201, expected: "xl" },
    { width: 1536, expected: "xl" },
    { width: 1537, expected: "xl" }
  ];

  for (const testCase of cases) {
    const content = createDeterministicScreenFile(buildScreen(testCase.width)).content;
    assert.equal(
      extractContainerMaxWidth(content),
      testCase.expected,
      `Expected width ${testCase.width} to map to maxWidth=${testCase.expected}`
    );
  }
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
  assert.equal(result.generatedPaths.includes("generation-metrics.json"), true);
  assert.equal(result.generationMetrics.fetchedNodes, 0);
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

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as { skippedHidden?: number; truncatedScreens?: unknown[] };
  assert.equal(typeof metrics.skippedHidden, "number");
  assert.equal(Array.isArray(metrics.truncatedScreens), true);
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

test("generateArtifacts logs and writes accessibility contrast warnings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-a11y-"));
  const logs: string[] = [];
  const ir = createIr();
  ir.screens = [
    {
      id: "contrast-screen",
      name: "Contrast Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      fillColor: "#ffffff",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "low-contrast-text",
          name: "Primary Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Low contrast copy",
          fillColor: "#8a8a8a",
          fontSize: 16,
          fontWeight: 400
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "qwen",
    onLog: (message) => logs.push(message)
  });

  assert.ok(logs.some((entry) => entry.includes("[a11y] Low contrast")));
  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as { accessibilityWarnings?: Array<{ code?: string }> };
  assert.equal(Array.isArray(metrics.accessibilityWarnings), true);
  assert.ok((metrics.accessibilityWarnings ?? []).length > 0);
  assert.equal(metrics.accessibilityWarnings?.[0]?.code, "W_A11Y_LOW_CONTRAST");
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

test("createDeterministicAppFile disambiguates duplicate screen names", () => {
  const ir = createIr();
  const duplicateScreens = [
    { ...ir.screens[0], id: "screen-a", name: "Overview" },
    { ...ir.screens[0], id: "screen-b", name: "Overview" },
    { ...ir.screens[0], id: "screen-c", name: "Overview" }
  ];

  const appFile = createDeterministicAppFile(duplicateScreens);
  assert.ok(appFile.content.includes('path="/overview"'));
  assert.ok(appFile.content.includes('path="/overview-'));
  assert.ok(appFile.content.includes('import OverviewScreen from "./screens/Overview";'));
  assert.ok(appFile.content.includes('const LazyOverview'));
});

test("deterministic screen rendering keeps semantic labels and avoids Mui internal text leakage", () => {
  const screen = createRegressionScreen();
  const screenFile = createDeterministicScreenFile(screen);
  const content = screenFile.content;

  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.ok(content.includes('>{"Weiter"}</Button>'));
  assert.ok(content.includes('endIcon={<ChevronRightIcon'));
  assert.ok(content.includes("TextField"));
  assert.ok(content.includes("MenuItem"));
  assert.ok(content.includes("InputAdornment"));

  assert.equal(content.includes('{"MuiInputRoot"}'), false);
  assert.equal(content.includes('{"MuiInputBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonEndIcon"}'), false);
  assert.equal(/>\s*"/.test(content), false);
  assert.ok(content.includes('top: "40px"'));
  assert.ok(content.includes('width: "560px"'));
  assert.ok(content.includes('minHeight: "66px"'));
});

test("deterministic screen rendering maps textRole placeholder to TextField placeholder without default prefill", () => {
  const screen = {
    id: "placeholder-screen",
    name: "Placeholder Screen",
    layoutMode: "VERTICAL" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "input-1",
        name: "Loan Input",
        nodeType: "FRAME",
        type: "input" as const,
        layoutMode: "VERTICAL" as const,
        gap: 4,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        width: 320,
        height: 72,
        children: [
          {
            id: "input-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Loan amount",
            y: 0
          },
          {
            id: "input-placeholder",
            name: "Placeholder",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Type here",
            textRole: "placeholder" as const,
            y: 24
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('label={"Loan amount"}'));
  assert.ok(content.includes('placeholder={"Type here"}'));
  assert.equal(/":\s*"Type here"/.test(content), false);
});

test("deterministic screen rendering infers TextField type and conservative autoComplete from semantic labels", () => {
  const screen = {
    id: "textfield-type-label-screen",
    name: "TextField Type Label Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "input-email", name: "Email Field", label: "Email" }),
      createSemanticInputNode({ id: "input-password", name: "Password Field", label: "Passwort" }),
      createSemanticInputNode({ id: "input-phone", name: "Phone Field", label: "Telefon" }),
      createSemanticInputNode({ id: "input-number", name: "Number Field", label: "Betrag" }),
      createSemanticInputNode({ id: "input-date", name: "Date Field", label: "Datum" }),
      createSemanticInputNode({ id: "input-url", name: "URL Field", label: "Website" }),
      createSemanticInputNode({ id: "input-search", name: "Search Field", label: "Suche" })
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const cases: Array<{ label: string; type: string; autoComplete?: string }> = [
    { label: "Email", type: "email", autoComplete: "email" },
    { label: "Passwort", type: "password", autoComplete: "current-password" },
    { label: "Telefon", type: "tel", autoComplete: "tel" },
    { label: "Betrag", type: "number" },
    { label: "Datum", type: "date" },
    { label: "Website", type: "url", autoComplete: "url" },
    { label: "Suche", type: "search" }
  ];

  for (const testCase of cases) {
    const block = findRenderedTextFieldBlock({ content, label: testCase.label });
    assert.ok(block.includes(`type={"${testCase.type}"}`));
    if (testCase.autoComplete) {
      assert.ok(block.includes(`autoComplete={"${testCase.autoComplete}"}`));
    } else {
      assert.equal(block.includes("autoComplete={"), false);
    }
    assert.ok(block.includes("value={formValues["));
    assert.ok(block.includes("onChange={(event) => updateFieldValue("));
  }
});

test("deterministic screen rendering infers TextField type from node name and placeholder hints", () => {
  const screen = {
    id: "textfield-type-hints-screen",
    name: "TextField Type Hints Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "name-email", name: "input-email", label: "Kontakt" }),
      createSemanticInputNode({ id: "name-password", name: "password-field", label: "Zugang" }),
      createSemanticInputNode({
        id: "placeholder-url",
        name: "generic-input",
        label: "Wert",
        placeholder: "Website Link eingeben"
      })
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const emailBlock = findRenderedTextFieldBlock({ content, label: "Kontakt" });
  assert.ok(emailBlock.includes('type={"email"}'));
  assert.ok(emailBlock.includes('autoComplete={"email"}'));

  const passwordBlock = findRenderedTextFieldBlock({ content, label: "Zugang" });
  assert.ok(passwordBlock.includes('type={"password"}'));
  assert.ok(passwordBlock.includes('autoComplete={"current-password"}'));

  const placeholderBlock = findRenderedTextFieldBlock({ content, label: "Wert" });
  assert.ok(placeholderBlock.includes('placeholder={"Website Link eingeben"}'));
  assert.ok(placeholderBlock.includes('type={"url"}'));
  assert.ok(placeholderBlock.includes('autoComplete={"url"}'));
});

test("deterministic screen rendering prioritizes password type when multiple semantic keywords match", () => {
  const screen = {
    id: "textfield-type-priority-screen",
    name: "TextField Type Priority Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "priority-field", name: "priority-field", label: "Email Passwort" })]
  };

  const content = createDeterministicScreenFile(screen).content;
  const block = findRenderedTextFieldBlock({ content, label: "Email Passwort" });
  assert.ok(block.includes('type={"password"}'));
  assert.ok(block.includes('autoComplete={"current-password"}'));
});

test("deterministic screen rendering infers required fields from star labels and removes star from TextField label", () => {
  const screen = {
    id: "textfield-required-screen",
    name: "TextField Required Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "required-email", name: "Email Input", label: "Email *" })]
  };

  const content = createDeterministicScreenFile(screen).content;
  const block = findRenderedTextFieldBlock({ content, label: "Email" });
  assert.equal(block.includes('label={"Email *"}'), false);
  assert.ok(block.includes('label={"Email"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"email_input_required_email-helper-text"}'));
  assert.ok(block.includes('"aria-required": "true"'));
  assert.ok(block.includes('FormHelperTextProps={{ id: "email_input_required_email-helper-text" }}'));
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("helperText={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
});

test("deterministic screen rendering emits form validation state scaffolding for interactive fields", () => {
  const screen = {
    id: "validation-scaffold-screen",
    name: "Validation Scaffold Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "email-field", name: "Email Input", label: "Email *", placeholder: "name@example.com" }),
      {
        id: "primary-submit",
        name: "Primary Submit",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 100,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "primary-submit-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Continue",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('component="form" onSubmit={handleSubmit} noValidate'));
  assert.ok(content.includes("const initialVisualErrors: Record<string, string> = "));
  assert.ok(content.includes("const requiredFields: Record<string, boolean> = "));
  assert.ok(content.includes("const fieldValidationTypes: Record<string, string> = "));
  assert.ok(content.includes("const fieldValidationMessages: Record<string, string> = "));
  assert.ok(content.includes("const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);"));
  assert.ok(content.includes("const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});"));
  assert.ok(content.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"));
  assert.ok(content.includes("const validateForm = (values: Record<string, string>): Record<string, string> => {"));
  assert.ok(content.includes("const handleFieldBlur = (fieldKey: string): void => {"));
  assert.ok(content.includes("const handleSubmit = (event: { preventDefault: () => void }): void => {"));
  assert.ok(content.includes('const primarySubmitButtonKey = "primary_submit_primary_submit";'));
});

test("deterministic screen rendering seeds visual error examples from red outlines", () => {
  const screen = {
    id: "visual-error-screen",
    name: "Visual Error Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "visual-error-field",
        name: "Email Input",
        nodeType: "FRAME",
        type: "input" as const,
        layoutMode: "VERTICAL" as const,
        gap: 4,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        width: 320,
        height: 72,
        strokeColor: "#d32f2f",
        children: [
          {
            id: "visual-error-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Email",
            y: 0
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('"email_input_visual_error_field": "Please enter a valid email address."'));
  const block = findRenderedTextFieldBlock({ content, label: "Email" });
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("helperText={"));
});

test("deterministic screen rendering applies validation bindings for select controls", () => {
  const screen = {
    id: "select-validation-screen",
    name: "Select Validation Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "status-select",
        name: "Status Select",
        nodeType: "FRAME",
        type: "select" as const,
        width: 260,
        height: 56,
        strokeColor: "#d32f2f",
        children: [
          {
            id: "status-select-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Status *"
          },
          {
            id: "status-select-option-1",
            name: "Option 1",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Aktiv"
          },
          {
            id: "status-select-option-2",
            name: "Option 2",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Inaktiv"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const block = findRenderedFormControlBlock({ content, label: "Status" });
  assert.equal(block.includes('label={"Status *"}'), false);
  assert.ok(block.includes('label={"Status"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"status_select_status_select-helper-text"}'));
  assert.ok(block.includes('aria-required="true"'));
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
  assert.ok(block.includes('<FormHelperText id={"status_select_status_select-helper-text"}>{'));
});

test("deterministic screen rendering assigns a single primary submit button and explicit button types", () => {
  const screen = {
    id: "submit-wiring-screen",
    name: "Submit Wiring Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 360,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "submit-email", name: "Email Input", label: "Email" }),
      {
        id: "btn-secondary",
        name: "Secondary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 120,
        width: 180,
        height: 36,
        strokeColor: "#565656",
        children: [
          {
            id: "btn-secondary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Secondary",
            fillColor: "#292929"
          }
        ]
      },
      {
        id: "btn-primary",
        name: "Primary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 176,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "btn-primary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Primary",
            fillColor: "#ffffff"
          }
        ]
      },
      {
        id: "btn-disabled",
        name: "Disabled Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 236,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        opacity: 0.45,
        children: [
          {
            id: "btn-disabled-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Disabled",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('const primarySubmitButtonKey = "primary_action_btn_primary";'));

  const secondaryLine = findRenderedButtonLine({ content, label: "Secondary" });
  assert.ok(secondaryLine.includes('type={primarySubmitButtonKey === "secondary_action_btn_secondary" ? "submit" : "button"}'));

  const primaryLine = findRenderedButtonLine({ content, label: "Primary" });
  assert.ok(primaryLine.includes('type={primarySubmitButtonKey === "primary_action_btn_primary" ? "submit" : "button"}'));

  const disabledLine = findRenderedButtonLine({ content, label: "Disabled" });
  assert.ok(disabledLine.includes('type={primarySubmitButtonKey === "disabled_action_btn_disabled" ? "submit" : "button"}'));
});

test("deterministic screen rendering infers heading hierarchy components from typography prominence", () => {
  const screen = {
    id: "heading-hierarchy-screen",
    name: "Heading Hierarchy Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "heading-main",
        name: "Main Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Main Heading",
        fontSize: 40,
        fontWeight: 700
      },
      {
        id: "heading-section",
        name: "Section Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Section Heading",
        fontSize: 30,
        fontWeight: 650
      },
      {
        id: "heading-sub",
        name: "Sub Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Sub Heading",
        fontSize: 24,
        fontWeight: 600
      },
      {
        id: "body-copy",
        name: "Body Copy",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Body text",
        fontSize: 14,
        fontWeight: 400
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const h1Line = findRenderedTypographyLine({ content, text: "Main Heading" });
  const h2Line = findRenderedTypographyLine({ content, text: "Section Heading" });
  const h3Line = findRenderedTypographyLine({ content, text: "Sub Heading" });
  const bodyLine = findRenderedTypographyLine({ content, text: "Body text" });
  assert.ok(h1Line.includes('component="h1"'));
  assert.ok(h2Line.includes('component="h2"'));
  assert.ok(h3Line.includes('component="h3"'));
  assert.equal(bodyLine.includes('component="h'), false);
});

test("deterministic screen rendering emits image accessibility semantics for informative and decorative images", () => {
  const screen = {
    id: "image-a11y-screen",
    name: "Image Accessibility Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "product-image",
        name: "Product Image",
        nodeType: "RECTANGLE",
        type: "image" as const,
        width: 320,
        height: 180,
        fillColor: "#d9d9d9"
      },
      {
        id: "decorative-image",
        name: "Decorative Background Shape",
        nodeType: "RECTANGLE",
        type: "image" as const,
        width: 320,
        height: 80,
        fillColor: "#f5f5f5"
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('<Box role="img" aria-label={"Product Image"}'));
  assert.ok(content.includes('<Box aria-hidden="true"'));
});

test("deterministic screen rendering infers navigation landmark roles for nav-like containers", () => {
  const buttonNode = (id: string, text: string, y: number) => ({
    id,
    name: `${text} Button`,
    nodeType: "FRAME",
    type: "button" as const,
    x: 0,
    y,
    width: 140,
    height: 40,
    fillColor: "#d4001a",
    children: [
      {
        id: `${id}-label`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text,
        fillColor: "#ffffff"
      }
    ]
  });
  const screen = {
    id: "nav-landmark-screen",
    name: "Navigation Landmark Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "main-nav-container",
        name: "Main Navigation",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        width: 320,
        height: 140,
        gap: 8,
        children: [buttonNode("nav-home", "Home", 0), buttonNode("nav-search", "Search", 50)]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('role="navigation"'));
});

test("deterministic screen rendering preserves auto-layout alignment and icon fallbacks", () => {
  const screen = {
    id: "layout-screen",
    name: "Layout Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "header-row",
        name: "Header Row",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 48,
        layoutMode: "HORIZONTAL" as const,
        primaryAxisAlignItems: "SPACE_BETWEEN" as const,
        counterAxisAlignItems: "CENTER" as const,
        children: [
          {
            id: "left-label",
            name: "Left Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Left"
          },
          {
            id: "right-label",
            name: "Right Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Right"
          }
        ]
      },
      {
        id: "bookmark-button",
        name: "Bookmark Button",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 64,
        width: 40,
        height: 40,
        fillColor: "#ffffff",
        cornerRadius: 64,
        children: [
          {
            id: "bookmark-icon",
            name: "ic_bookmark_outline",
            nodeType: "INSTANCE",
            type: "container" as const,
            x: 8,
            y: 72,
            width: 24,
            height: 24,
            fillColor: "#565656"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes('justifyContent="space-between"'));
  assert.ok(content.includes('alignItems="center"'));
  assert.ok(content.includes("IconButton"));
  assert.ok(content.includes('import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";'));
  assert.ok(content.includes('<IconButton aria-label="Bookmark Button"'));
});

test("deterministic screen rendering maps simple vertical containers to Stack", () => {
  const screen = {
    id: "stack-vertical-screen",
    name: "Stack Vertical",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "simple-vertical-container",
        name: "Simple Vertical Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        gap: 16,
        children: [
          {
            id: "simple-vertical-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Kontostand"
          },
          {
            id: "simple-vertical-value",
            name: "Value",
            nodeType: "TEXT",
            type: "text" as const,
            text: "1.250 EUR"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes('<Stack direction="column" spacing={2}'));
  assert.equal(content.includes('display: "flex"'), false);
  assert.equal(content.includes('flexDirection: "column"'), false);
});

test("deterministic screen rendering maps simple horizontal containers to Stack with alignment props", () => {
  const screen = {
    id: "stack-horizontal-screen",
    name: "Stack Horizontal",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "simple-horizontal-container",
        name: "Simple Horizontal Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        primaryAxisAlignItems: "SPACE_BETWEEN" as const,
        counterAxisAlignItems: "CENTER" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 56,
        gap: 12,
        children: [
          {
            id: "simple-horizontal-left",
            name: "Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Links"
          },
          {
            id: "simple-horizontal-right",
            name: "Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Rechts"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes('<Stack direction="row" spacing={1.5}'));
  assert.ok(content.includes('alignItems="center"'));
  assert.ok(content.includes('justifyContent="space-between"'));
  assert.equal(content.includes('display: "flex"'), false);
});

test("deterministic screen rendering keeps styled flex containers as Box with flex sx", () => {
  const screen = {
    id: "stack-negative-styled-screen",
    name: "Stack Negative Styled",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "styled-horizontal-container",
        name: "Styled Horizontal Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 64,
        fillColor: "#f5f5f5",
        children: [
          {
            id: "styled-horizontal-left",
            name: "Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "A"
          },
          {
            id: "styled-horizontal-right",
            name: "Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "B"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes("<Box sx={{"));
  assert.ok(content.includes('display: "flex"'));
  assert.ok(content.includes('flexDirection: "row"'));
  assert.equal(content.includes('<Stack direction="row"'), false);
});

test("deterministic screen rendering promotes elevated surface containers with content to Paper", () => {
  const screen = {
    id: "paper-surface-elevated-screen",
    name: "Paper Surface Elevated",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    fillColor: "#ffffff",
    children: [
      {
        id: "paper-surface-elevated-container",
        name: "Surface Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        fillColor: "#f5f7fb",
        cornerRadius: 12,
        elevation: 6,
        children: [
          {
            id: "paper-surface-elevated-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Kontostand"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes("<Paper elevation={6}"));
  assert.equal(content.includes('<Box sx={{ position: "absolute", left: "0px", top: "0px", width: "320px"'), false);
});

test("deterministic screen rendering promotes outlined surface containers with content to Paper", () => {
  const screen = {
    id: "paper-surface-outlined-screen",
    name: "Paper Surface Outlined",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    fillColor: "#ffffff",
    children: [
      {
        id: "paper-surface-outlined-container",
        name: "Outlined Surface Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        strokeColor: "#d1d5db",
        strokeWidth: 1,
        cornerRadius: 8,
        children: [
          {
            id: "paper-surface-outlined-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Transaktionen"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.ok(content.includes('<Paper variant="outlined"'));
  assert.equal(content.includes('<Box sx={{ position: "absolute", left: "0px", top: "0px", width: "320px"'), false);
});

test("deterministic screen rendering keeps decorative elevated containers on Box fallback", () => {
  const screen = {
    id: "paper-surface-negative-decorative-screen",
    name: "Paper Surface Negative Decorative",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    fillColor: "#ffffff",
    children: [
      {
        id: "paper-surface-negative-decorative-container",
        name: "Decorative Surface Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 96,
        height: 96,
        fillColor: "#f5f7fb",
        cornerRadius: 12,
        elevation: 4,
        children: [
          {
            id: "paper-surface-negative-decorative-shape",
            name: "Decorative Background Shape",
            nodeType: "RECTANGLE",
            type: "image" as const,
            x: 0,
            y: 0,
            width: 24,
            height: 24,
            fillColor: "#d8deeb"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.equal(content.includes("<Paper elevation={4}"), false);
  assert.ok(content.includes("boxShadow: 4"));
  assert.ok(content.includes("<Box sx={{") || content.includes('<Box aria-hidden="true" sx={{'));
});

test("deterministic screen rendering keeps same-background elevated containers on Box fallback", () => {
  const screen = {
    id: "paper-surface-negative-background-screen",
    name: "Paper Surface Negative Background",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    fillColor: "#ffffff",
    children: [
      {
        id: "paper-surface-negative-background-container",
        name: "Same Background Surface Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        fillColor: "#ffffff",
        cornerRadius: 10,
        elevation: 4,
        children: [
          {
            id: "paper-surface-negative-background-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Saldo"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;

  assert.equal(content.includes("<Paper elevation={4}"), false);
  assert.ok(content.includes("boxShadow: 4"));
  assert.ok(content.includes("<Box sx={{"));
});

test("deterministic screen rendering detects matrix-like container layouts and renders responsive Grid", () => {
  const screen = {
    id: "grid-matrix-detection-screen",
    name: "Grid Matrix Detection",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "metrics-grid-wrapper",
        name: "Metrics Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 620,
        height: 320,
        fillColor: "#f8fafc",
        children: [
          {
            id: "metric-tile-a",
            name: "Tile A",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 0,
            y: 0,
            width: 300,
            height: 140,
            fillColor: "#ffffff",
            children: []
          },
          {
            id: "metric-tile-b",
            name: "Tile B",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 320,
            y: 0,
            width: 300,
            height: 140,
            fillColor: "#ffffff",
            children: []
          },
          {
            id: "metric-tile-c",
            name: "Tile C",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 0,
            y: 170,
            width: 300,
            height: 140,
            fillColor: "#ffffff",
            children: []
          },
          {
            id: "metric-tile-d",
            name: "Tile D",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 320,
            y: 170,
            width: 300,
            height: 140,
            fillColor: "#ffffff",
            children: []
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Grid container"));
  assert.equal((content.match(/size=\{\{ xs: 12, sm: 6, md: 6 \}\}/g) ?? []).length, 4);
});

test("deterministic screen rendering detects equal-width row containers and emits equal grid columns", () => {
  const screen = {
    id: "grid-equal-row-screen",
    name: "Grid Equal Row",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "stats-row-wrapper",
        name: "Stats Row Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 660,
        height: 140,
        children: [
          {
            id: "stats-card-a",
            name: "Card A",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 0,
            y: 0,
            width: 200,
            height: 120,
            fillColor: "#ffffff",
            children: []
          },
          {
            id: "stats-card-b",
            name: "Card B",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 230,
            y: 0,
            width: 200,
            height: 120,
            fillColor: "#ffffff",
            children: []
          },
          {
            id: "stats-card-c",
            name: "Card C",
            nodeType: "FRAME",
            type: "paper" as const,
            x: 460,
            y: 0,
            width: 200,
            height: 120,
            fillColor: "#ffffff",
            children: []
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Grid container"));
  assert.equal((content.match(/size=\{\{ xs: 12, sm: 6, md: 4 \}\}/g) ?? []).length, 3);
});

test("deterministic screen rendering avoids false grid positives for vertical flow containers", () => {
  const screen = {
    id: "grid-negative-vertical-screen",
    name: "Grid Negative Vertical",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "vertical-flow-wrapper",
        name: "Vertical Flow Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        gap: 12,
        children: [
          {
            id: "vertical-flow-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Kontodaten",
            x: 0,
            y: 0
          },
          {
            id: "vertical-flow-value",
            name: "Value",
            nodeType: "TEXT",
            type: "text" as const,
            text: "1234567890",
            x: 0,
            y: 40
          },
          {
            id: "vertical-flow-hint",
            name: "Hint",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bitte prüfen",
            x: 0,
            y: 80
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<Grid container"), false);
  assert.ok(content.includes("Kontodaten"));
});

test("deterministic screen rendering emits path-based imports and only imports used icons", () => {
  const screen = {
    id: "single-icon-screen",
    name: "Single Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-bookmark-icon",
        name: "ic_bookmark_outline",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 4,
        y: 8,
        width: 24,
        height: 24,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconImportLines = extractMuiIconImportLines(content);

  assert.equal(hasMuiIconBarrelImport(content), false);
  assert.deepEqual(iconImportLines, ['import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";']);
});

test("deterministic screen rendering deduplicates repeated icon imports", () => {
  const screen = {
    id: "duplicate-icon-screen",
    name: "Duplicate Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "duplicate-bookmark-icon-1",
        name: "ic_bookmark_outline",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        children: []
      },
      {
        id: "duplicate-bookmark-icon-2",
        name: "ic_bookmark_outline",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 32,
        y: 0,
        width: 24,
        height: 24,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconImportLines = extractMuiIconImportLines(content);

  assert.deepEqual(iconImportLines, ['import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";']);
});

test("deterministic screen rendering orders icon imports deterministically", () => {
  const screen = {
    id: "ordered-icon-screen",
    name: "Ordered Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "search-icon",
        name: "ic_search",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        children: []
      },
      {
        id: "add-icon",
        name: "ic_add",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 32,
        y: 0,
        width: 24,
        height: 24,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconImportLines = extractMuiIconImportLines(content);

  assert.deepEqual(iconImportLines, [
    'import AddIcon from "@mui/icons-material/Add";',
    'import SearchIcon from "@mui/icons-material/Search";'
  ]);
});

test("deterministic screen rendering deduplicates duplicate sx keys for icon fallbacks", () => {
  const screen = {
    id: "dupe-sx-screen",
    name: "Dupe SX Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "dupe-icon",
        name: "ic_info_hint",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 10,
        y: 20,
        width: 24,
        height: 24,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconLine = content.split("\n").find((line) => line.includes("<InfoOutlinedIcon"));
  assert.ok(iconLine);

  const count = (source: string, token: string): number => source.split(token).length - 1;
  assert.equal(count(iconLine, "width:"), 1);
  assert.equal(count(iconLine, "height:"), 1);
  assert.equal(count(iconLine, "display:"), 1);
  assert.equal(count(iconLine, "alignItems:"), 1);
  assert.equal(count(iconLine, "justifyContent:"), 1);
  assert.equal(count(iconLine, "fontSize:"), 1);
});

test("deterministic screen rendering keeps avatar text for icon-like containers", () => {
  const screen = {
    id: "avatar-screen",
    name: "Avatar Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "avatar-node",
        name: "IconComponentAvatar",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        fillColor: "#d9d9d9",
        cornerRadius: 20,
        children: [
          {
            id: "avatar-text",
            name: "MuiTypographyRoot",
            nodeType: "TEXT",
            type: "text" as const,
            text: "PB",
            x: 10,
            y: 10,
            fillColor: "#222222",
            fontFamily: "Roboto",
            fontWeight: 700,
            fontSize: 14
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('>{"PB"}</Typography>'));
  assert.equal(content.includes("InfoOutlinedIcon"), false);
});

test("deterministic screen rendering maps down-indicator icon names to ExpandMoreIcon", () => {
  const screen = {
    id: "expand-screen",
    name: "Expand Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "expand-icon",
        name: "ic_down_s",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('import ExpandMoreIcon from "@mui/icons-material/ExpandMore";'));
  assert.ok(content.includes("<ExpandMoreIcon"));
  assert.equal(content.includes("InfoOutlinedIcon"), false);
});

test("deterministic screen rendering uses vector paths on non-VECTOR icon nodes", () => {
  const screen = {
    id: "vector-instance-screen",
    name: "Vector Instance Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "vector-instance",
        name: "ic_custom_instance",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        fillColor: "#111111",
        vectorPaths: ["M0 0L10 0L10 10Z"],
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<SvgIcon"));
  assert.ok(content.includes('d={"M0 0L10 0L10 10Z"}'));
  assert.equal(content.includes("InfoOutlinedIcon"), false);
});

test("deterministic screen rendering maps variant metadata to MUI props and pseudo-state sx overrides", () => {
  const screen = {
    id: "variant-mapping-screen",
    name: "Variant Mapping Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "variant-button",
        name: "Primary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        variantMapping: {
          properties: {
            state: "Disabled",
            size: "Small",
            variant: "Text"
          },
          muiProps: {
            variant: "text" as const,
            size: "small" as const,
            disabled: true
          },
          state: "disabled" as const,
          stateOverrides: {
            hover: {
              backgroundColor: "#c4001a"
            },
            active: {
              backgroundColor: "#9f0015"
            },
            disabled: {
              backgroundColor: "#d1d5db",
              color: "#6b7280"
            }
          }
        },
        children: [
          {
            id: "variant-button-text",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Weiter"
          }
        ]
      },
      {
        id: "variant-chip",
        name: "Status",
        nodeType: "FRAME",
        type: "chip" as const,
        x: 0,
        y: 60,
        width: 120,
        height: 32,
        variantMapping: {
          properties: {
            state: "Disabled",
            size: "Small",
            variant: "Outlined"
          },
          muiProps: {
            variant: "outlined" as const,
            size: "small" as const,
            disabled: true
          },
          state: "disabled" as const,
          stateOverrides: {
            active: {
              borderColor: "#6b7280"
            }
          }
        },
        children: [
          {
            id: "variant-chip-text",
            name: "Chip label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Status"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('variant="text" size="small" disabled disableElevation'));
  assert.ok(content.includes('<Chip label={"Status"} variant="outlined" size="small" disabled'));
  assert.ok(content.includes('"&:hover": { bgcolor: "#c4001a" }'));
  assert.ok(content.includes('"&:active": { bgcolor: "#9f0015" }'));
  assert.ok(content.includes('"&.Mui-disabled": { bgcolor: "#d1d5db", color: "#6b7280" }'));
  assert.ok(content.includes('"&:active": { borderColor: "#6b7280" }'));
});

test("deterministic screen rendering infers contained buttons and strips redundant contained sx when fullWidth is inferred", () => {
  const screen = {
    id: "button-contained-screen",
    name: "Button Contained Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 320,
    height: 120,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-contained-primary",
        name: "Primary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 48,
        fillColor: "#ee0000",
        children: [
          {
            id: "btn-contained-primary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Continue",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const buttonLine = findRenderedButtonLine({ content, label: "Continue" });
  assert.ok(buttonLine.includes('variant="contained" size="large" fullWidth disableElevation'));
  assert.equal(buttonLine.includes('width: "320px"'), false);
  assert.equal(buttonLine.includes('maxWidth: "320px"'), false);
  assert.equal(buttonLine.includes("border:"), false);
  assert.equal(buttonLine.includes("borderColor:"), false);
});

test("deterministic screen rendering infers outlined medium buttons and strips outlined variant sx", () => {
  const screen = {
    id: "button-outlined-screen",
    name: "Button Outlined Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 320,
    height: 140,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-outlined",
        name: "Secondary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 36,
        strokeColor: "#565656",
        children: [
          {
            id: "btn-outlined-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Secondary",
            fillColor: "#d4001a"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const buttonLine = findRenderedButtonLine({ content, label: "Secondary" });
  assert.ok(buttonLine.includes('variant="outlined" size="medium" disableElevation'));
  assert.equal(buttonLine.includes(" disabled "), false);
  assert.equal(buttonLine.includes("background:"), false);
  assert.equal(buttonLine.includes("bgcolor:"), false);
  assert.equal(buttonLine.includes("border:"), false);
  assert.equal(buttonLine.includes("borderColor:"), false);
});

test("deterministic screen rendering infers text small buttons and strips text variant sx", () => {
  const screen = {
    id: "button-text-screen",
    name: "Button Text Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 320,
    height: 140,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-text",
        name: "Text Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 130,
        height: 30,
        children: [
          {
            id: "btn-text-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Text Action",
            fillColor: "#292929"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const buttonLine = findRenderedButtonLine({ content, label: "Text Action" });
  assert.ok(buttonLine.includes('variant="text" size="small" disableElevation'));
  assert.equal(buttonLine.includes("background:"), false);
  assert.equal(buttonLine.includes("bgcolor:"), false);
  assert.equal(buttonLine.includes("border:"), false);
  assert.equal(buttonLine.includes("borderColor:"), false);
});

test("deterministic screen rendering infers disabled buttons from opacity and neutral gray fill/text patterns", () => {
  const screen = {
    id: "button-disabled-screen",
    name: "Button Disabled Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 320,
    height: 220,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-opacity-disabled",
        name: "Opacity Disabled",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 200,
        height: 44,
        opacity: 0.5,
        fillColor: "#ee0000",
        children: [
          {
            id: "btn-opacity-disabled-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Dimmed",
            fillColor: "#ffffff"
          }
        ]
      },
      {
        id: "btn-neutral-disabled",
        name: "Neutral Disabled",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 64,
        width: 200,
        height: 48,
        fillColor: "#d1d5db",
        children: [
          {
            id: "btn-neutral-disabled-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Muted",
            fillColor: "#6b7280"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const opacityLine = findRenderedButtonLine({ content, label: "Dimmed" });
  const neutralLine = findRenderedButtonLine({ content, label: "Muted" });
  assert.ok(opacityLine.includes('variant="contained" size="large" disabled disableElevation'));
  assert.ok(neutralLine.includes('variant="contained" size="large" disabled disableElevation'));
});

test("deterministic screen rendering keeps custom contained backgrounds in button sx", () => {
  const screen = {
    id: "button-custom-contained-screen",
    name: "Button Custom Contained Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 320,
    height: 140,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-custom-contained",
        name: "Brand Custom",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 200,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "btn-custom-contained-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Brand Custom",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const buttonLine = findRenderedButtonLine({ content, label: "Brand Custom" });
  assert.ok(buttonLine.includes('variant="contained" size="large" disableElevation'));
  assert.equal(buttonLine.includes(" fullWidth "), false);
  assert.ok(buttonLine.includes('bgcolor: "#d4001a"'));
});

test("deterministic screen rendering emits responsive maxWidth and layout overrides from ScreenIR metadata", () => {
  const screen = {
    id: "responsive-screen",
    name: "Responsive Screen",
    layoutMode: "VERTICAL" as const,
    gap: 24,
    width: 1336,
    height: 900,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    responsive: {
      groupKey: "login",
      baseBreakpoint: "lg" as const,
      variants: [
        {
          breakpoint: "xs" as const,
          nodeId: "screen-login-mobile",
          name: "Login - Mobile",
          width: 390,
          height: 844,
          layoutMode: "VERTICAL" as const,
          gap: 8,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          isBase: false
        },
        {
          breakpoint: "sm" as const,
          nodeId: "screen-login-tablet",
          name: "Login - Tablet",
          width: 768,
          height: 1024,
          layoutMode: "VERTICAL" as const,
          gap: 16,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          isBase: false
        },
        {
          breakpoint: "lg" as const,
          nodeId: "screen-login-desktop",
          name: "Login - Desktop",
          width: 1336,
          height: 900,
          layoutMode: "VERTICAL" as const,
          gap: 24,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          isBase: true
        }
      ],
      rootLayoutOverrides: {
        xs: { gap: 8 },
        sm: { gap: 16 }
      },
      topLevelLayoutOverrides: {
        "cta-row": {
          xs: {
            layoutMode: "VERTICAL" as const,
            gap: 8,
            widthRatio: 1,
            minHeight: 120
          },
          sm: {
            gap: 12,
            widthRatio: 0.75
          }
        }
      }
    },
    children: [
      {
        id: "title",
        name: "Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Welcome",
        x: 0,
        y: 0
      },
      {
        id: "cta-row",
        name: "CTA Row",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 72,
        width: 600,
        height: 56,
        layoutMode: "HORIZONTAL" as const,
        gap: 16,
        children: [
          {
            id: "cta-a",
            name: "Action A",
            nodeType: "TEXT",
            type: "text" as const,
            text: "A",
            x: 0,
            y: 0
          },
          {
            id: "cta-b",
            name: "Action B",
            nodeType: "TEXT",
            type: "text" as const,
            text: "B",
            x: 60,
            y: 0
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes('<Box sx={{ minHeight: "100vh"'), false);
  assert.ok(content.includes("<Container maxWidth="));
  assert.ok(content.includes('"@media (max-width: 428px)": { maxWidth: "390px", gap: 1 }'));
  assert.ok(content.includes('"@media (min-width: 429px) and (max-width: 768px)": { maxWidth: "768px", gap: 2 }'));
  assert.ok(content.includes('"@media (min-width: 1025px) and (max-width: 1440px)": { maxWidth: "1336px" }'));
  assert.ok(content.includes('width: "44.9%"'));
  assert.ok(content.includes('maxWidth: "600px"'));
  assert.ok(
    content.includes('"@media (max-width: 428px)": { display: "flex", flexDirection: "column", gap: 1, width: "100%", minHeight: "120px" }')
  );
  assert.ok(content.includes('"@media (min-width: 429px) and (max-width: 768px)": { gap: 1.5, width: "75%" }'));
});

test("deterministic screen rendering keeps fallback behavior when responsive metadata is absent", () => {
  const content = createDeterministicScreenFile(createIr().screens[0]).content;
  assert.equal(content.includes("@media ("), false);
});

test("deterministic screen rendering emits gradient background sx and uses contained fallback for gradient buttons", () => {
  const screen = {
    id: "gradient-screen",
    name: "Gradient Screen",
    layoutMode: "VERTICAL" as const,
    gap: 0,
    fillGradient: "linear-gradient(90deg, #d4001a 0%, #f0b400 100%)",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "gradient-hero",
        name: "Gradient Hero",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 520,
        height: 180,
        fillGradient: "radial-gradient(circle, #fff5d6 0%, #d4001a 100%)",
        children: []
      },
      {
        id: "gradient-button",
        name: "Continue",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 200,
        width: 220,
        height: 48,
        fillGradient: "linear-gradient(135deg, #d4001a 0%, #f06a00 100%)",
        children: [
          {
            id: "gradient-button-text",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Weiter"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('background: "linear-gradient(90deg, #d4001a 0%, #f0b400 100%)"'));
  assert.ok(content.includes('background: "radial-gradient(circle, #fff5d6 0%, #d4001a 100%)"'));
  assert.ok(content.includes('background: "linear-gradient(135deg, #d4001a 0%, #f06a00 100%)"'));
  assert.ok(content.includes('<Button variant="contained"'));
  assert.equal(content.includes('bgcolor: "background.default"'), false);
});

test("deterministic screen rendering emits opacity in sx and keeps low-opacity elements renderable", () => {
  const screen = {
    id: "opacity-screen",
    name: "Opacity Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "opacity-surface",
        name: "Opacity Surface",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        opacity: 0.42,
        children: []
      },
      {
        id: "opacity-overlay",
        name: "Opacity Overlay",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 140,
        width: 320,
        height: 120,
        opacity: 0.2,
        children: []
      },
      {
        id: "opacity-full",
        name: "Opacity Full",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 280,
        width: 320,
        height: 120,
        opacity: 1,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("opacity: 0.42"));
  assert.ok(content.includes("opacity: 0.2"));
  assert.equal(content.includes("opacity: 1"), false);
  assert.equal((content.match(/opacity:/g) ?? []).length, 2);
});

test("deterministic screen rendering maps shadow metadata to Card elevation and Box boxShadow with priority rules", () => {
  const screen = {
    id: "shadow-screen",
    name: "Shadow Screen",
    layoutMode: "VERTICAL" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "shadow-card",
        name: "Summary Card",
        nodeType: "FRAME",
        type: "card" as const,
        x: 0,
        y: 0,
        width: 420,
        height: 200,
        elevation: 14,
        insetShadow: "inset 0px 1px 3px rgba(0, 0, 0, 0.2)",
        children: [
          {
            id: "shadow-card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Finanzstatus"
          }
        ]
      },
      {
        id: "shadow-container-elevation",
        name: "Elevated Box",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 220,
        width: 320,
        height: 96,
        elevation: 5,
        children: []
      },
      {
        id: "shadow-container-inset",
        name: "Inset Box",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 332,
        width: 320,
        height: 96,
        elevation: 8,
        insetShadow: "inset 2px 4px 6px rgba(17, 34, 51, 0.25)",
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Card elevation={14}"));
  assert.ok(content.includes("boxShadow: 5"));
  assert.ok(content.includes('boxShadow: "inset 2px 4px 6px rgba(17, 34, 51, 0.25)"'));
  assert.equal(content.includes('boxShadow: "inset 0px 1px 3px rgba(0, 0, 0, 0.2)"'), false);
  assert.equal(content.includes("<Paper elevation={5}"), false);
  assert.equal(content.includes("<Paper elevation={8}"), false);
});

test("deterministic screen rendering emits spacing units and rem typography without px literals", () => {
  const screen = {
    id: "spacing-typography-screen",
    name: "Spacing Typography Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "spacing-group",
        name: "Spacing Group",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 220,
        layoutMode: "VERTICAL" as const,
        gap: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        children: [
          {
            id: "spacing-text",
            name: "Body Text",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Hallo",
            fontSize: 14,
            lineHeight: 20
          },
          {
            id: "spacing-button",
            name: "Primary Button",
            nodeType: "FRAME",
            type: "button" as const,
            width: 180,
            height: 48,
            fontSize: 16,
            lineHeight: 24,
            fillColor: "#d4001a",
            children: [
              {
                id: "spacing-button-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Weiter"
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("gap: 1.5"));
  assert.ok(content.includes("pt: 2"));
  assert.ok(content.includes("pr: 2"));
  assert.ok(content.includes("pb: 2"));
  assert.ok(content.includes("pl: 2"));
  assert.ok(content.includes('fontSize: "0.875rem"'));
  assert.ok(content.includes('lineHeight: "1.25rem"'));
  assert.ok(content.includes('fontSize: "1rem"'));
  assert.ok(content.includes('lineHeight: "1.5rem"'));
  assert.equal(/\b(gap|p[trbl]|fontSize|lineHeight):\s*"[0-9.]+px"/.test(content), false);
});

test("generateArtifacts maps exact token palette colors to MUI theme references in sx", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-token-colors-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "token-color-screen",
      name: "Token Color Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      fillColor: "#fafafa",
      children: [
        {
          id: "token-surface",
          name: "Token Surface",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 280,
          height: 120,
          fillColor: "#fafafa",
          strokeColor: "#00aa55",
          children: [
            {
              id: "token-text",
              name: "Token Text",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Welcome",
              fillColor: "#222222",
              fontSize: 14,
              lineHeight: 20
            }
          ]
        },
        {
          id: "token-button",
          name: "Token Button",
          nodeType: "FRAME",
          type: "button" as const,
          x: 0,
          y: 140,
          width: 200,
          height: 48,
          fillColor: "#ee0000",
          children: [
            {
              id: "token-button-label",
              name: "Label",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Continue"
            }
          ]
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const content = await readFile(path.join(projectDir, toDeterministicScreenPath("Token Color Screen")), "utf8");
  assert.ok(content.includes('bgcolor: "background.default"'));
  assert.ok(content.includes('borderColor: "secondary.main"'));
  assert.ok(content.includes('color: "text.primary"'));
  const tokenButtonLine = findRenderedButtonLine({ content, label: "Continue" });
  assert.ok(tokenButtonLine.includes('variant="contained" size="large"'));
  assert.equal(tokenButtonLine.includes('bgcolor: "primary.main"'), false);
});

test("generateArtifacts emits truncation notice comment when screen was budget-truncated", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-truncation-"));
  const ir = createIr();
  ir.metrics = {
    fetchedNodes: 4,
    skippedHidden: 2,
    skippedPlaceholders: 3,
    screenElementCounts: [{ screenId: "screen-1", screenName: "Übersicht", elements: 1400 }],
    truncatedScreens: [
      {
        screenId: "screen-1",
        screenName: "Übersicht",
        originalElements: 1400,
        retainedElements: 1200,
        budget: 1200
      }
    ],
    degradedGeometryNodes: ["1:1"]
  };

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(generatedScreenContent.includes("Screen IR exceeded budget"));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  assert.ok(metricsContent.includes("\"degradedGeometryNodes\""));
  assert.equal(result.generationMetrics.truncatedScreens.length, 1);
});

test("deterministic screen rendering supports extended semantic MUI element types", () => {
  const basePadding = { top: 0, right: 0, bottom: 0, left: 0 };
  const textNode = (id: string, name: string, text: string): any => ({
    id,
    name,
    nodeType: "TEXT",
    type: "text" as const,
    text
  });
  const frameNode = (node: Record<string, unknown>): any => ({
    nodeType: "FRAME",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: basePadding,
    children: [],
    ...node
  });

  const screen = {
    id: "extended-types-screen",
    name: "Extended Types",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: basePadding,
    children: [
      frameNode({
        id: "input-node",
        name: "Kontonummer Feld",
        type: "input" as const,
        width: 260,
        height: 56,
        strokeColor: "#c4c4c4"
      }),
      frameNode({
        id: "card-node",
        name: "Summary Card",
        type: "card" as const,
        width: 280,
        height: 160,
        fillColor: "#ffffff",
        cornerRadius: 12,
        children: [
          {
            id: "card-media",
            name: "Card Media",
            nodeType: "RECTANGLE",
            type: "image" as const,
            width: 280,
            height: 100,
            fillColor: "#e5e7eb"
          },
          textNode("card-title", "Card Title", "Card Content"),
          frameNode({
            id: "card-action",
            name: "Card Action",
            type: "button" as const,
            width: 120,
            height: 36,
            fillColor: "#d4001a",
            children: [textNode("card-action-text", "Action Text", "Details")]
          })
        ]
      }),
      frameNode({
        id: "chip-node",
        name: "Status Chip",
        type: "chip" as const,
        width: 120,
        height: 32,
        fillColor: "#f2f2f2"
      }),
      frameNode({
        id: "switch-node",
        name: "Switch Field",
        type: "switch" as const,
        width: 180,
        height: 30,
        children: [textNode("switch-label", "Switch Label", "Switch aktiv")]
      }),
      frameNode({
        id: "checkbox-node",
        name: "Checkbox Field",
        type: "checkbox" as const,
        width: 180,
        height: 30,
        children: [textNode("checkbox-label", "Checkbox Label", "Checkbox aktiv")]
      }),
      frameNode({
        id: "radio-node",
        name: "Radio Field",
        type: "radio" as const,
        width: 180,
        height: 30,
        children: [
          textNode("radio-option-a", "Radio Option A", "Option A"),
          textNode("radio-option-b", "Radio Option B", "Option B")
        ]
      }),
      frameNode({
        id: "list-node",
        name: "Detail List",
        type: "list" as const,
        width: 260,
        height: 80,
        children: [
          frameNode({
            id: "list-item-a",
            name: "List item A",
            type: "container" as const,
            children: [
              {
                id: "list-item-a-icon",
                name: "ic_search",
                nodeType: "INSTANCE",
                type: "container" as const,
                width: 20,
                height: 20,
                children: []
              },
              textNode("list-item-a-text", "List item A text", "Erster Punkt")
            ]
          }),
          frameNode({
            id: "list-item-b",
            name: "List item B",
            type: "container" as const,
            children: [
              {
                id: "list-item-b-icon",
                name: "ic_add",
                nodeType: "INSTANCE",
                type: "container" as const,
                width: 20,
                height: 20,
                children: []
              },
              textNode("list-item-b-text", "List item B text", "Zweiter Punkt")
            ]
          })
        ]
      }),
      frameNode({
        id: "grid-node",
        name: "Metrics Grid",
        type: "grid" as const,
        width: 420,
        height: 220,
        children: [
          frameNode({
            id: "grid-tile-a",
            name: "Tile A",
            type: "paper" as const,
            width: 200,
            height: 100,
            fillColor: "#ffffff",
            children: [textNode("grid-tile-a-text", "Tile A Text", "A")]
          }),
          frameNode({
            id: "grid-tile-b",
            name: "Tile B",
            type: "paper" as const,
            width: 200,
            height: 100,
            fillColor: "#ffffff",
            children: [textNode("grid-tile-b-text", "Tile B Text", "B")]
          })
        ]
      }),
      frameNode({
        id: "stack-node",
        name: "Actions Stack",
        type: "stack" as const,
        layoutMode: "VERTICAL" as const,
        gap: 8,
        width: 220,
        height: 120,
        children: [
          textNode("stack-item-1", "Stack Item 1", "Item 1"),
          textNode("stack-item-2", "Stack Item 2", "Item 2")
        ]
      }),
      frameNode({
        id: "paper-node",
        name: "Info Paper",
        type: "paper" as const,
        width: 260,
        height: 120,
        fillColor: "#ffffff",
        strokeColor: "#d1d5db",
        children: [textNode("paper-text", "Paper Text", "Paper content")]
      }),
      frameNode({
        id: "table-node",
        name: "Offers Table",
        type: "table" as const,
        width: 420,
        height: 140,
        children: [
          frameNode({
            id: "table-row-1",
            name: "Table Row 1",
            type: "container" as const,
            children: [
              textNode("table-row-1-col-1", "Row1 Col1", "Name"),
              textNode("table-row-1-col-2", "Row1 Col2", "Wert")
            ]
          }),
          frameNode({
            id: "table-row-2",
            name: "Table Row 2",
            type: "container" as const,
            children: [
              textNode("table-row-2-col-1", "Row2 Col1", "A"),
              textNode("table-row-2-col-2", "Row2 Col2", "1")
            ]
          })
        ]
      }),
      frameNode({
        id: "tooltip-node",
        name: "Tooltip Hilfe",
        type: "tooltip" as const,
        width: 120,
        height: 40,
        children: [textNode("tooltip-anchor", "Tooltip Anchor", "?")]
      }),
      frameNode({
        id: "drawer-node",
        name: "Main Drawer",
        type: "drawer" as const,
        width: 220,
        height: 200,
        children: [textNode("drawer-item-1", "Drawer Item 1", "Home"), textNode("drawer-item-2", "Drawer Item 2", "Konto")]
      }),
      frameNode({
        id: "breadcrumbs-node",
        name: "Breadcrumbs",
        type: "breadcrumbs" as const,
        width: 220,
        height: 40,
        children: [textNode("crumb-1", "Crumb 1", "Start"), textNode("crumb-2", "Crumb 2", "Details")]
      }),
      frameNode({
        id: "select-node",
        name: "Status Select",
        type: "select" as const,
        width: 260,
        height: 56,
        children: [textNode("select-option-1", "Option 1", "Aktiv"), textNode("select-option-2", "Option 2", "Inaktiv")]
      }),
      frameNode({
        id: "slider-node",
        name: "Budget Slider",
        type: "slider" as const,
        width: 260,
        height: 40,
        fillColor: "#f3f4f6"
      }),
      frameNode({
        id: "rating-node",
        name: "Rating",
        type: "rating" as const,
        width: 200,
        height: 36,
        fillColor: "#f3f4f6"
      }),
      frameNode({
        id: "snackbar-node",
        name: "Success Snackbar",
        type: "snackbar" as const,
        width: 260,
        height: 64,
        children: [textNode("snackbar-text", "Snackbar text", "Gespeichert")]
      }),
      frameNode({
        id: "skeleton-node",
        name: "Skeleton",
        type: "skeleton" as const,
        width: 260,
        height: 16,
        fillColor: "#f3f4f6"
      }),
      frameNode({
        id: "appbar-node",
        name: "Main AppBar",
        type: "appbar" as const,
        width: 320,
        height: 64,
        children: [textNode("appbar-title", "AppBar title", "Übersicht")]
      }),
      frameNode({
        id: "tabs-node",
        name: "Tabs",
        type: "tab" as const,
        width: 280,
        height: 48,
        children: [textNode("tab-a", "Tab A", "Start"), textNode("tab-b", "Tab B", "Details")]
      }),
      frameNode({
        id: "dialog-node",
        name: "Dialog",
        type: "dialog" as const,
        width: 300,
        height: 200,
        children: [textNode("dialog-title", "Dialog title", "Bestätigung")]
      }),
      frameNode({
        id: "stepper-node",
        name: "Stepper",
        type: "stepper" as const,
        width: 280,
        height: 64,
        children: [textNode("step-1", "Step One", "Schritt 1"), textNode("step-2", "Step Two", "Schritt 2")]
      }),
      frameNode({
        id: "progress-node",
        name: "Progress",
        type: "progress" as const,
        width: 240,
        height: 10,
        fillColor: "#d8d8d8"
      }),
      frameNode({
        id: "avatar-node",
        name: "Avatar",
        type: "avatar" as const,
        width: 40,
        height: 40,
        children: [textNode("avatar-text", "Avatar Text", "AB")]
      }),
      frameNode({
        id: "badge-node",
        name: "Badge",
        type: "badge" as const,
        width: 56,
        height: 40,
        children: [textNode("badge-child", "Badge child", "3")]
      }),
      {
        id: "divider-node",
        name: "Divider",
        nodeType: "RECTANGLE",
        type: "divider" as const,
        width: 280,
        height: 1,
        fillColor: "#d4d4d4",
        children: []
      },
      frameNode({
        id: "navigation-node",
        name: "Bottom navigation",
        type: "navigation" as const,
        width: 320,
        height: 64,
        children: [textNode("nav-1", "Home", "Home"), textNode("nav-2", "Search", "Suche")]
      })
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const muiImportLine = content
    .split("\n")
    .find((line) => line.startsWith("import { ") && line.endsWith(' } from "@mui/material";'));
  assert.ok(muiImportLine);
  const requiredImports = [
    "Alert",
    "AppBar",
    "Avatar",
    "Badge",
    "Breadcrumbs",
    "BottomNavigation",
    "BottomNavigationAction",
    "Card",
    "CardActions",
    "CardContent",
    "CardMedia",
    "Checkbox",
    "Chip",
    "Container",
    "Drawer",
    "Dialog",
    "DialogContent",
    "DialogTitle",
    "Divider",
    "FormControl",
    "FormControlLabel",
    "Grid",
    "InputLabel",
    "LinearProgress",
    "List",
    "ListItem",
    "ListItemIcon",
    "ListItemText",
    "MenuItem",
    "Radio",
    "RadioGroup",
    "Rating",
    "Select",
    "Skeleton",
    "Slider",
    "Snackbar",
    "Stack",
    "Paper",
    "Step",
    "StepLabel",
    "Stepper",
    "Switch",
    "Table",
    "TableBody",
    "TableCell",
    "TableHead",
    "TableRow",
    "Tab",
    "Tabs",
    "TextField",
    "Tooltip",
    "Toolbar"
  ];
  for (const requiredImport of requiredImports) {
    assert.ok(muiImportLine?.includes(requiredImport));
  }
  assert.ok(content.includes("<Card "));
  assert.ok(content.includes("<Chip "));
  assert.ok(content.includes("<Switch "));
  assert.ok(content.includes("<Checkbox "));
  assert.ok(content.includes("<RadioGroup "));
  assert.ok(content.includes("<List "));
  assert.ok(content.includes("<ListItemIcon>"));
  assert.ok(content.includes('<AppBar role="banner" '));
  assert.ok(content.includes("<Tabs "));
  assert.ok(content.includes("<Dialog "));
  assert.ok(content.includes("<Stepper "));
  assert.ok(content.includes("<LinearProgress "));
  assert.ok(content.includes("<Avatar "));
  assert.ok(content.includes("<Badge "));
  assert.ok(content.includes('<Divider aria-hidden="true" '));
  assert.ok(content.includes('<BottomNavigation role="navigation" '));
  assert.ok(content.includes("<Grid container"));
  assert.ok(content.includes("<Stack "));
  assert.ok(content.includes("<Paper "));
  assert.ok(content.includes("<CardMedia "));
  assert.ok(content.includes("<CardActions>"));
  assert.ok(content.includes("<Table "));
  assert.ok(content.includes("<Tooltip "));
  assert.ok(content.includes('<Drawer open variant="persistent" PaperProps={{ role: "navigation" }}'));
  assert.ok(content.includes("<Breadcrumbs "));
  assert.ok(content.includes("<Select"));
  assert.ok(content.includes("<Slider "));
  assert.ok(content.includes("<Rating "));
  assert.ok(content.includes("<Snackbar "));
  assert.ok(content.includes("<Alert "));
  assert.ok(content.includes('<Skeleton aria-hidden="true" '));
  assert.equal(content.includes("<TextField\n  select"), false);
  assert.ok(content.includes("<TextField"));
  assert.ok(content.includes('<Container maxWidth="'));
  assert.ok(content.includes('role="main"'));
});

test("deterministic extended renderer falls back to container for implausible models", () => {
  const screen = {
    id: "fallback-screen",
    name: "Fallback Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "implausible-list",
        name: "List",
        nodeType: "FRAME",
        type: "list" as const,
        x: 0,
        y: 0,
        width: 120,
        height: 40,
        fillColor: "#efefef",
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<List "), false);
  assert.ok(content.includes('width: "120px"'));
  assert.ok(content.includes('height: "40px"'));
});
