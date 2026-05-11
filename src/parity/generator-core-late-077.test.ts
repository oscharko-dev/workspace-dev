import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeterministicAppFile,
  createDeterministicScreenFile,
  createDeterministicThemeFile,
  generateArtifacts,
  toDeterministicScreenPath,
  detectFormGroups,
  normalizeIconImports,
  isDeepIconImport,
  extractSharedSxConstantsFromScreenContent
} from "./generator-core.js";
import { figmaToDesignIr } from "./ir.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const toRgba = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  const payload = normalized.length >= 6 ? normalized.slice(0, 6) : normalized;
  if (!/^[0-9a-f]{6}$/i.test(payload)) {
    throw new Error(`Invalid hex color '${hex}'`);
  }
  return {
    r: Number.parseInt(payload.slice(0, 2), 16),
    g: Number.parseInt(payload.slice(2, 4), 16),
    b: Number.parseInt(payload.slice(4, 6), 16)
  };
};

const toLuminance = (hex: string): number => {
  const { r, g, b } = toRgba(hex);
  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = toLuminance(foreground);
  const backgroundLuminance = toLuminance(background);
  const brighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (brighter + 0.05) / (darker + 0.05);
};

const extractThemeHex = ({
  themeContent,
  scheme,
  token
}: {
  themeContent: string;
  scheme: "light" | "dark";
  token: "primary" | "secondary" | "success" | "warning" | "error" | "info" | "background" | "divider";
}): string => {
  const pattern =
    token === "background"
      ? new RegExp(`${scheme}: \\{[\\s\\S]*?background: \\{ default: "(#[0-9a-f]+)"`, "i")
      : token === "divider"
        ? new RegExp(`${scheme}: \\{[\\s\\S]*?divider: "(#[0-9a-f]+)"`, "i")
        : new RegExp(`${scheme}: \\{[\\s\\S]*?${token}: \\{ main: "(#[0-9a-f]+)"`, "i");
  const match = themeContent.match(pattern);
  assert.ok(match?.[1], `Expected ${scheme}.${token} hex in generated theme.`);
  return match[1];
};

const countOccurrences = (source: string, token: string): number => source.split(token).length - 1;

const GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL = Symbol.for("workspace-dev.parity.generateArtifacts.runtimeAdapters");

const writeGeneratedFileFromRuntimeAdapter = async ({
  rootDir,
  relativePath,
  content
}: {
  rootDir: string;
  relativePath: string;
  content: string;
}): Promise<void> => {
  const absolutePath = path.resolve(rootDir, relativePath);
  const normalizedRootDir = path.resolve(rootDir);
  if (!absolutePath.startsWith(`${normalizedRootDir}${path.sep}`)) {
    throw new Error(`LLM attempted path traversal: ${relativePath}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
};

const collectDeterministicSnapshot = async ({
  projectDir,
  screenName
}: {
  projectDir: string;
  screenName: string;
}): Promise<{
  appContent: string;
  screenContent: string;
  themeContent: string;
  tokensContent: string;
  metricsContent: string;
}> => {
  return {
    appContent: await readFile(path.join(projectDir, "src", "App.tsx"), "utf8"),
    screenContent: await readFile(path.join(projectDir, toDeterministicScreenPath(screenName)), "utf8"),
    themeContent: await readFile(path.join(projectDir, "src", "theme", "theme.ts"), "utf8"),
    tokensContent: await readFile(path.join(projectDir, "src", "theme", "tokens.json"), "utf8"),
    metricsContent: await readFile(path.join(projectDir, "generation-metrics.json"), "utf8")
  };
};

const readGeneratedStringArrayLiteral = ({
  source,
  variableName
}: {
  source: string;
  variableName: string;
}): string[] => {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`const ${escapedName}: string\\[] = (\\[[\\s\\S]*?\\]);`));
  assert.ok(match?.[1], `Expected array literal declaration for '${variableName}'.`);
  return JSON.parse(match?.[1] ?? "[]") as string[];
};

const createIr = () => ({
  sourceName: "Demo",
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#00aa55",
      background: "#fafafa",
      text: "#222222",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#2222221f",
      action: {
        active: "#2222228a",
        hover: "#ee00000a",
        selected: "#ee000014",
        disabled: "#22222242",
        disabledBackground: "#2222221f",
        focus: "#ee00001f"
      }
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16
    })
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

const createMixedFallbackStageIr = () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "mixed-stage-screen",
      name: "Mixed Fallback Stage",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "mixed-stage-title",
          name: "Header Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Dashboard"
        },
        {
          id: "mixed-stage-nav",
          name: "Open Details",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Open Details",
          prototypeNavigation: {
            targetScreenId: "mixed-stage-target-screen",
            mode: "replace" as const
          }
        },
        {
          id: "mixed-stage-search-icon",
          name: "ic_search",
          nodeType: "INSTANCE",
          type: "container" as const,
          width: 24,
          height: 24,
          children: []
        },
        {
          id: "mixed-stage-input",
          name: "Kontonummer Input",
          nodeType: "FRAME",
          type: "input" as const,
          text: "Kontonummer"
        },
        {
          id: "mixed-offer-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "mixed-offer-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "mixed-offer-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "mixed-offer-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "mixed-offer-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "mixed-offer-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    },
    {
      id: "mixed-stage-target-screen",
      name: "Mixed Stage Target",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "mixed-stage-target-title",
          name: "Target Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Destination"
        }
      ]
    }
  ];
  return ir;
};

const mixedFallbackStageImageAssetMap = {
  "mixed-offer-image-a": "/images/mixed-offer-a.png",
  "mixed-offer-image-b": "/images/mixed-offer-b.png",
  "mixed-offer-image-c": "/images/mixed-offer-c.png"
};

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
  const match = content.match(/<Container\b[^>]*\bmaxWidth="(sm|md|lg|xl)"/);
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

const findThemeComponentBlock = ({
  themeContent,
  componentName
}: {
  themeContent: string;
  componentName: string;
}): string => {
  const marker = `    ${componentName}: {`;
  const startIndex = themeContent.indexOf(marker);
  assert.ok(startIndex >= 0, `Expected theme component block for '${componentName}'.`);
  const openingBraceIndex = themeContent.indexOf("{", startIndex);
  assert.ok(openingBraceIndex >= 0, `Expected opening brace for '${componentName}'.`);
  let depth = 0;
  for (let index = openingBraceIndex; index < themeContent.length; index += 1) {
    const char = themeContent[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return themeContent.slice(startIndex, index + 1);
      }
    }
  }
  assert.fail(`Failed to parse theme component block for '${componentName}'.`);
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

const assertMarkersInOrder = ({
  content,
  markers
}: {
  content: string;
  markers: string[];
}): void => {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    assert.ok(index >= 0, `Expected marker '${marker}' to be present in output.`);
    assert.ok(index > previousIndex, `Expected marker '${marker}' to appear after previous markers.`);
    previousIndex = index;
  }
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

const createSemanticSelectInputNode = ({
  id,
  label,
  value
}: {
  id: string;
  label: string;
  value: string;
}): any => {
  return {
    id,
    name: "Styled(div)",
    nodeType: "FRAME",
    type: "input" as const,
    width: 320,
    height: 72,
    children: [
      {
        id: `${id}-label`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text: label,
        y: 0
      },
      {
        id: `${id}-value`,
        name: "MuiSelectSelect",
        nodeType: "TEXT",
        type: "text" as const,
        text: value,
        y: 24
      }
    ]
  };
};

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
  assert.ok(content.includes("<AppBar "));
  assert.ok(content.includes('role="banner"'));
  assert.ok(content.includes("<Tabs "));
  assert.ok(content.includes("<Dialog "));
  assert.ok(content.includes("<Stepper "));
  assert.ok(content.includes("<LinearProgress "));
  assert.ok(content.includes("<Avatar "));
  assert.ok(content.includes("<Badge "));
  assert.ok(content.includes("<Divider "));
  assert.ok(content.includes('aria-hidden="true"'));
  assert.ok(content.includes("<BottomNavigation "));
  assert.ok(content.includes('role="navigation"'));
  assert.ok(content.includes("<Grid "));
  assert.ok(content.includes("container"));
  assert.ok(content.includes("<Stack "));
  assert.ok(content.includes("<Paper "));
  assert.ok(content.includes("<CardMedia "));
  assert.ok(content.includes("<CardActions>"));
  assert.ok(content.includes("<Table "));
  assert.ok(content.includes("<Tooltip "));
  assert.ok(content.includes("<Drawer "));
  assert.ok(content.includes("open"));
  assert.ok(content.includes('variant="persistent"'));
  assert.ok(content.includes('slotProps={{ paper: { role: "navigation" } }}'));
  assert.equal(content.includes("PaperProps={{"), false);
  assert.ok(content.includes("<Breadcrumbs "));
  assert.ok(content.includes("<Select"));
  assert.ok(content.includes("<Slider "));
  assert.ok(content.includes("<Rating "));
  assert.ok(content.includes("<Snackbar "));
  assert.ok(content.includes("<Alert "));
  assert.ok(content.includes('<Skeleton '));
  assert.ok(content.includes('aria-hidden="true"'));
  assert.equal(content.includes("<TextField\n  select"), false);
  assert.ok(content.includes("<TextField"));
  assert.ok(content.includes('<Container '));
  assert.ok(content.includes('maxWidth="'));
  assert.ok(content.includes('role="main"'));
});

test("deterministic screen rendering assembles explicit card and accordion slots without placeholders", () => {
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
    id: "explicit-slot-screen",
    name: "Explicit Slots",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: basePadding,
    children: [
      frameNode({
        id: "explicit-card",
        name: "<Card>",
        type: "card" as const,
        width: 320,
        height: 240,
        fillColor: "#ffffff",
        children: [
          frameNode({
            id: "card-header-slot",
            name: "_<CardHeader>",
            type: "container" as const,
            semanticType: "CardHeader",
            children: [
              textNode("card-header-title", "Card Header Title", "Premium Account"),
              textNode("card-header-subtitle", "Card Header Subtitle", "Updated today")
            ]
          }),
          {
            id: "card-media-slot",
            name: "_<CardMedia>",
            nodeType: "RECTANGLE",
            type: "container" as const,
            semanticType: "CardMedia",
            width: 320,
            height: 120,
            fillColor: "#e5e7eb",
            children: []
          },
          frameNode({
            id: "card-content-slot",
            name: "_<CardContent>",
            type: "container" as const,
            semanticType: "CardContent",
            children: [textNode("card-content-text", "Card Content Text", "Explicit body")]
          }),
          textNode("card-unmatched-text", "Card Unmatched Text", "Unmatched body copy"),
          frameNode({
            id: "card-actions-slot",
            name: "_<CardActions>",
            type: "container" as const,
            semanticType: "CardActions",
            children: [
              frameNode({
                id: "card-action-button",
                name: "Details CTA",
                type: "button" as const,
                children: [textNode("card-action-label", "Card Action Label", "Details")]
              })
            ]
          })
        ]
      }),
      frameNode({
        id: "explicit-accordion",
        name: "<Accordion>",
        type: "accordion" as const,
        semanticType: "Accordion",
        width: 320,
        height: 200,
        children: [
          frameNode({
            id: "accordion-summary-slot",
            name: "_<AccordionSummary>",
            type: "container" as const,
            semanticType: "AccordionSummary",
            children: [textNode("accordion-summary-text", "Accordion Summary Text", "Show details")]
          }),
          frameNode({
            id: "accordion-details-slot",
            name: "_<AccordionDetails>",
            type: "container" as const,
            semanticType: "AccordionDetails",
            children: [textNode("accordion-details-text", "Accordion Details Text", "Hidden body")]
          })
        ]
      })
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const muiImportLine = content
    .split("\n")
    .find((line) => line.startsWith("import { ") && line.endsWith(' } from "@mui/material";'));
  assert.ok(muiImportLine);
  assert.ok(muiImportLine?.includes("CardHeader"));
  assert.ok(muiImportLine?.includes("CardMedia"));
  assert.ok(muiImportLine?.includes("CardContent"));
  assert.ok(muiImportLine?.includes("CardActions"));
  assert.ok(muiImportLine?.includes("AccordionSummary"));
  assert.ok(muiImportLine?.includes("AccordionDetails"));
  assert.ok(content.includes("<CardHeader"));
  assert.ok(content.includes('title={"Premium Account"}'));
  assert.ok(content.includes('subheader={"Updated today"}'));
  assert.ok(content.includes("<CardMedia "));
  assert.ok(content.includes('"Explicit body"'));
  assert.ok(content.includes('"Unmatched body copy"'));
  assert.ok(content.includes("<CardActions>"));
  assert.ok(content.includes('"Hidden body"'));
  assert.equal(content.includes("<CardContent />"), false);
  assert.equal(content.includes('component="main" role="main"'), false);
  assert.equal(content.includes("<Box />"), false);
  assert.ok(content.indexOf("<CardHeader") < content.indexOf("<CardMedia"));
  assert.ok(content.indexOf("<CardMedia") < content.indexOf("<CardContent>"));
  assert.ok(content.indexOf("<CardContent>") < content.indexOf("<CardActions>"));
  assert.ok(
    content.indexOf("<AccordionSummary") !== -1,
    "Expected <AccordionSummary in output"
  );
  assert.ok(
    content.indexOf("<AccordionDetails") !== -1,
    "Expected <AccordionDetails in output"
  );
  assert.ok(
    content.indexOf("<AccordionSummary") < content.indexOf("<AccordionDetails"),
    "Expected AccordionSummary to precede AccordionDetails in output"
  );
});
