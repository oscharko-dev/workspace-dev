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

