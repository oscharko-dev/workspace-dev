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

  assert.ok(content.includes('justifyContent: "space-between"'));
  assert.ok(content.includes('alignItems: "center"'));
  assert.ok(content.includes("IconButton"));
  assert.ok(content.includes('import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";'));
  assert.ok(content.includes('<IconButton aria-label="Bookmark Button"'));
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

test("deterministic screen rendering emits responsive maxWidth and layout overrides from ScreenIR metadata", () => {
  const screen = {
    id: "responsive-screen",
    name: "Responsive Screen",
    layoutMode: "VERTICAL" as const,
    gap: 24,
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
            gap: 8
          },
          sm: {
            gap: 12
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
  assert.ok(content.includes('"@media (max-width: 428px)": { maxWidth: "390px", gap: "8px" }'));
  assert.ok(content.includes('"@media (min-width: 429px) and (max-width: 768px)": { maxWidth: "768px", gap: "16px" }'));
  assert.ok(content.includes('"@media (min-width: 1025px) and (max-width: 1440px)": { maxWidth: "1336px" }'));
  assert.ok(
    content.includes(
      '"@media (max-width: 428px)": { display: "flex", flexDirection: "column", gap: "8px" }'
    )
  );
  assert.ok(content.includes('"@media (min-width: 429px) and (max-width: 768px)": { gap: "12px" }'));
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
  const screen = {
    id: "extended-types-screen",
    name: "Extended Types",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "input-node",
        name: "Kontonummer Feld",
        nodeType: "FRAME",
        type: "input" as const,
        x: 0,
        y: 0,
        width: 260,
        height: 56,
        strokeColor: "#c4c4c4",
        children: []
      },
      {
        id: "card-node",
        name: "Summary Card",
        nodeType: "FRAME",
        type: "card" as const,
        x: 0,
        y: 70,
        width: 280,
        height: 120,
        fillColor: "#ffffff",
        cornerRadius: 12,
        children: [
          {
            id: "card-title",
            name: "Card title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Card Content"
          }
        ]
      },
      {
        id: "chip-node",
        name: "Status Chip",
        nodeType: "FRAME",
        type: "chip" as const,
        x: 0,
        y: 200,
        width: 120,
        height: 32,
        fillColor: "#f2f2f2"
      },
      {
        id: "switch-node",
        name: "Switch Field",
        nodeType: "FRAME",
        type: "switch" as const,
        x: 0,
        y: 244,
        width: 180,
        height: 30,
        children: [
          {
            id: "switch-label",
            name: "Switch Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Switch aktiv"
          }
        ]
      },
      {
        id: "checkbox-node",
        name: "Checkbox Field",
        nodeType: "FRAME",
        type: "checkbox" as const,
        x: 0,
        y: 282,
        width: 180,
        height: 30,
        children: [
          {
            id: "checkbox-label",
            name: "Checkbox Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Checkbox aktiv"
          }
        ]
      },
      {
        id: "radio-node",
        name: "Radio Field",
        nodeType: "FRAME",
        type: "radio" as const,
        x: 0,
        y: 320,
        width: 180,
        height: 30,
        children: [
          {
            id: "radio-label",
            name: "Radio Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Radio aktiv"
          }
        ]
      },
      {
        id: "list-node",
        name: "Detail List",
        nodeType: "FRAME",
        type: "list" as const,
        x: 0,
        y: 360,
        width: 260,
        height: 80,
        children: [
          {
            id: "list-item-a",
            name: "List item A",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Erster Punkt"
          },
          {
            id: "list-item-b",
            name: "List item B",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Zweiter Punkt"
          }
        ]
      },
      {
        id: "appbar-node",
        name: "Main AppBar",
        nodeType: "FRAME",
        type: "appbar" as const,
        x: 0,
        y: 450,
        width: 320,
        height: 64,
        children: [
          {
            id: "appbar-title",
            name: "AppBar title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Übersicht"
          }
        ]
      },
      {
        id: "tabs-node",
        name: "Tabs",
        nodeType: "FRAME",
        type: "tab" as const,
        x: 0,
        y: 522,
        width: 280,
        height: 48,
        children: [
          {
            id: "tab-a",
            name: "Tab A",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Start"
          },
          {
            id: "tab-b",
            name: "Tab B",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Details"
          }
        ]
      },
      {
        id: "dialog-node",
        name: "Dialog",
        nodeType: "FRAME",
        type: "dialog" as const,
        x: 0,
        y: 580,
        width: 300,
        height: 200,
        children: [
          {
            id: "dialog-title",
            name: "Dialog title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bestätigung"
          }
        ]
      },
      {
        id: "stepper-node",
        name: "Stepper",
        nodeType: "FRAME",
        type: "stepper" as const,
        x: 0,
        y: 790,
        width: 280,
        height: 64,
        children: [
          {
            id: "step-1",
            name: "Step One",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Schritt 1"
          },
          {
            id: "step-2",
            name: "Step Two",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Schritt 2"
          }
        ]
      },
      {
        id: "progress-node",
        name: "Progress",
        nodeType: "FRAME",
        type: "progress" as const,
        x: 0,
        y: 862,
        width: 240,
        height: 10,
        fillColor: "#d8d8d8"
      },
      {
        id: "avatar-node",
        name: "Avatar",
        nodeType: "FRAME",
        type: "avatar" as const,
        x: 0,
        y: 882,
        width: 40,
        height: 40,
        children: [
          {
            id: "avatar-text",
            name: "Avatar Text",
            nodeType: "TEXT",
            type: "text" as const,
            text: "AB"
          }
        ]
      },
      {
        id: "badge-node",
        name: "Badge",
        nodeType: "FRAME",
        type: "badge" as const,
        x: 60,
        y: 882,
        width: 56,
        height: 40,
        children: [
          {
            id: "badge-child",
            name: "Badge child",
            nodeType: "TEXT",
            type: "text" as const,
            text: "3"
          }
        ]
      },
      {
        id: "divider-node",
        name: "Divider",
        nodeType: "RECTANGLE",
        type: "divider" as const,
        x: 0,
        y: 930,
        width: 280,
        height: 1,
        fillColor: "#d4d4d4"
      },
      {
        id: "navigation-node",
        name: "Bottom navigation",
        nodeType: "FRAME",
        type: "navigation" as const,
        x: 0,
        y: 940,
        width: 320,
        height: 64,
        children: [
          {
            id: "nav-1",
            name: "Home",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Home"
          },
          {
            id: "nav-2",
            name: "Search",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Suche"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const muiImportLine = content
    .split("\n")
    .find((line) => line.startsWith("import { ") && line.endsWith(' } from "@mui/material";'));
  assert.ok(muiImportLine);
  const requiredImports = [
    "AppBar",
    "Avatar",
    "Badge",
    "BottomNavigation",
    "BottomNavigationAction",
    "Card",
    "CardContent",
    "Checkbox",
    "Chip",
    "Dialog",
    "DialogContent",
    "DialogTitle",
    "Divider",
    "FormControlLabel",
    "LinearProgress",
    "List",
    "ListItem",
    "ListItemText",
    "Radio",
    "Step",
    "StepLabel",
    "Stepper",
    "Switch",
    "Tab",
    "Tabs",
    "TextField",
    "Toolbar"
  ];
  for (const requiredImport of requiredImports) {
    assert.ok(muiImportLine?.includes(requiredImport));
  }
  assert.ok(content.includes("<Card "));
  assert.ok(content.includes("<Chip "));
  assert.ok(content.includes("<Switch "));
  assert.ok(content.includes("<Checkbox "));
  assert.ok(content.includes("<Radio "));
  assert.ok(content.includes("<List "));
  assert.ok(content.includes("<AppBar "));
  assert.ok(content.includes("<Tabs "));
  assert.ok(content.includes("<Dialog "));
  assert.ok(content.includes("<Stepper "));
  assert.ok(content.includes("<LinearProgress "));
  assert.ok(content.includes("<Avatar "));
  assert.ok(content.includes("<Badge "));
  assert.ok(content.includes("<Divider "));
  assert.ok(content.includes("<BottomNavigation "));
  assert.ok(content.includes("<TextField"));
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
