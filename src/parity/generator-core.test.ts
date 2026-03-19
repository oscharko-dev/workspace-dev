import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

test("deterministic file helpers create expected paths and content", () => {
  const ir = createIr();
  const screen = ir.screens[0];
  const themeContent = createDeterministicThemeFile(ir).content;
  const appContent = createDeterministicAppFile(ir.screens).content;

  assert.equal(toDeterministicScreenPath("Kredit Übersicht"), "src/screens/Kredit_bersicht.tsx");
  assert.equal(createDeterministicThemeFile(ir).path, "src/theme/theme.ts");
  assert.equal(createDeterministicScreenFile(screen).path.startsWith("src/screens/"), true);
  assert.equal(createDeterministicAppFile(ir.screens).path, "src/App.tsx");
  assert.ok(themeContent.includes("colorSchemes: {"));
  assert.ok(themeContent.includes("light: {"));
  assert.ok(themeContent.includes("dark: {"));
  assert.equal(themeContent.includes('palette: {\n    mode: "light"'), false);
  assert.ok(themeContent.includes('success: { main: "#16a34a" }'));
  assert.ok(themeContent.includes('warning: { main: "#d97706" }'));
  assert.ok(themeContent.includes('error: { main: "#dc2626" }'));
  assert.ok(themeContent.includes('info: { main: "#0288d1" }'));
  assert.ok(themeContent.includes('divider: "#2222221f"'));
  assert.ok(themeContent.includes('focus: "#ee00001f"'));
  assert.ok(themeContent.includes('background: { default: "#121212", paper: "#1e1e1e" }'));
  assert.ok(themeContent.includes('divider: "#f5f7fb1f"'));
  assert.ok(themeContent.includes('subtitle1: { fontSize:'));
  assert.ok(themeContent.includes('button: { fontSize:'));
  assert.ok(themeContent.includes('overline: { fontSize:'));
  assert.ok(themeContent.includes('letterSpacing: "0.08em"'));
  assert.ok(themeContent.includes('textTransform: "none"'));
  assert.equal(themeContent.includes("breakpoints: {"), false);
  assert.ok(appContent.includes('import { useColorScheme } from "@mui/material/styles";'));
  assert.ok(appContent.includes('import ErrorBoundary from "./components/ErrorBoundary";'));
  assert.ok(appContent.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appContent.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appContent.includes('data-testid="theme-mode-toggle"'));
  assert.ok(appContent.includes("element={<ErrorBoundary><"));
  assert.ok(appContent.includes('window.matchMedia("(prefers-color-scheme: dark)")'));
  assert.ok(appContent.includes('setMode(nextMode)'));
});

test("createDeterministicThemeFile derives deterministic component overrides from IR samples", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-defaults-screen",
      name: "Theme Defaults Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "theme-card-a",
          name: "Card A",
          nodeType: "FRAME",
          type: "card" as const,
          x: 0,
          y: 0,
          width: 280,
          height: 160,
          cornerRadius: 18,
          elevation: 7,
          children: [{ id: "theme-card-a-text", name: "Card A Text", nodeType: "TEXT", type: "text" as const, text: "A" }]
        },
        {
          id: "theme-card-b",
          name: "Card B",
          nodeType: "FRAME",
          type: "card" as const,
          x: 0,
          y: 180,
          width: 280,
          height: 160,
          cornerRadius: 18,
          elevation: 7,
          children: [{ id: "theme-card-b-text", name: "Card B Text", nodeType: "TEXT", type: "text" as const, text: "B" }]
        },
        {
          id: "theme-input",
          name: "Styled(div)",
          nodeType: "FRAME",
          type: "input" as const,
          x: 0,
          y: 360,
          width: 280,
          height: 56,
          cornerRadius: 10,
          children: [{ id: "theme-input-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "IBAN" }]
        },
        {
          id: "theme-chip",
          name: "Status Chip",
          nodeType: "FRAME",
          type: "chip" as const,
          x: 0,
          y: 436,
          width: 120,
          height: 24,
          cornerRadius: 14,
          children: [{ id: "theme-chip-text", name: "Chip Label", nodeType: "TEXT", type: "text" as const, text: "Neu" }]
        },
        {
          id: "theme-paper",
          name: "Info Paper",
          nodeType: "FRAME",
          type: "paper" as const,
          x: 0,
          y: 480,
          width: 280,
          height: 120,
          elevation: 3,
          children: [{ id: "theme-paper-text", name: "Paper Text", nodeType: "TEXT", type: "text" as const, text: "Info" }]
        },
        {
          id: "theme-appbar",
          name: "Top AppBar",
          nodeType: "FRAME",
          type: "appbar" as const,
          x: 0,
          y: 620,
          width: 320,
          height: 64,
          fillColor: "#123456",
          children: [{ id: "theme-appbar-text", name: "AppBar Text", nodeType: "TEXT", type: "text" as const, text: "Übersicht" }]
        },
        {
          id: "theme-divider",
          name: "Divider",
          nodeType: "RECTANGLE",
          type: "divider" as const,
          x: 0,
          y: 704,
          width: 280,
          height: 1,
          fillColor: "#d4d4d4"
        },
        {
          id: "theme-avatar",
          name: "Avatar",
          nodeType: "FRAME",
          type: "avatar" as const,
          x: 0,
          y: 725,
          width: 42,
          height: 42,
          cornerRadius: 21,
          children: [{ id: "theme-avatar-text", name: "Avatar Text", nodeType: "TEXT", type: "text" as const, text: "AB" }]
        }
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const orderedComponents = ["MuiButton", "MuiCard", "MuiTextField", "MuiChip", "MuiPaper", "MuiAppBar", "MuiDivider", "MuiAvatar"];
  let previousIndex = -1;
  for (const componentName of orderedComponents) {
    const currentIndex = themeContent.indexOf(`${componentName}: {`);
    assert.ok(currentIndex > previousIndex, `Expected '${componentName}' in deterministic component order.`);
    previousIndex = currentIndex;
  }
  const cardBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiCard"
  });
  const chipBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiChip"
  });
  assert.ok(themeContent.includes("defaultProps: { elevation: 7 }"));
  assert.ok(cardBlock.includes('borderRadius: "18px"'));
  assert.ok(themeContent.includes("& .MuiOutlinedInput-root"));
  assert.ok(themeContent.includes('borderRadius: "10px"'));
  assert.ok(themeContent.includes('defaultProps: { size: "small" }'));
  assert.ok(chipBlock.includes('borderRadius: "14px"'));
  assert.ok(themeContent.includes("MuiPaper: {"));
  assert.ok(themeContent.includes("defaultProps: { elevation: 3 }"));
  assert.ok(themeContent.includes('backgroundColor: "#123456"'));
  assert.ok(themeContent.includes('borderColor: "#d4d4d4"'));
  assert.ok(themeContent.includes('width: "42px"'));
  assert.ok(themeContent.includes('height: "42px"'));
  assert.ok(themeContent.includes('borderRadius: "21px"'));
});

test("createDeterministicThemeFile derives C1 sx overrides at 70% threshold and keeps extraction conservative", () => {
  const createButtonNode = ({
    id,
    y,
    fillColor
  }: {
    id: string;
    y: number;
    fillColor: string;
  }) => ({
    id,
    name: `Button ${id}`,
    nodeType: "FRAME",
    type: "button" as const,
    x: 0,
    y,
    width: 220,
    height: 48,
    fillColor,
    children: [{ id: `${id}-label`, name: "Label", nodeType: "TEXT", type: "text" as const, text: "Weiter" }]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-threshold-screen",
      name: "Theme C1 Threshold",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        createButtonNode({ id: "c1-button-a", y: 0, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-b", y: 64, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-c", y: 128, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-d", y: 192, fillColor: "#226699" })
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const buttonBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiButton"
  });

  assert.ok(buttonBlock.includes('textTransform: "none"'));
  assert.ok(buttonBlock.includes('backgroundColor: "#1357aa"'));
  assert.equal(buttonBlock.includes("left:"), false);
  assert.equal(buttonBlock.includes("top:"), false);
  assert.equal(buttonBlock.includes("width:"), false);
  assert.equal(buttonBlock.includes("px:"), false);
});

test("createDeterministicThemeFile does not derive C1 overrides below minimum sample size", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-min-samples-screen",
      name: "Theme C1 Min Samples",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "c1-min-button-a",
          name: "Button A",
          nodeType: "FRAME",
          type: "button" as const,
          x: 0,
          y: 0,
          width: 220,
          height: 48,
          fillColor: "#0f4c81",
          children: [{ id: "c1-min-button-a-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Speichern" }]
        },
        {
          id: "c1-min-button-b",
          name: "Button B",
          nodeType: "FRAME",
          type: "button" as const,
          x: 0,
          y: 64,
          width: 220,
          height: 48,
          fillColor: "#0f4c81",
          children: [{ id: "c1-min-button-b-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Speichern" }]
        }
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const buttonBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiButton"
  });
  assert.equal(buttonBlock.includes("backgroundColor"), false);
});

test("createDeterministicThemeFile keeps deterministic ordering for C1-only component overrides", () => {
  const makeIconOnlyButton = ({ id, y }: { id: string; y: number }) => ({
    id,
    name: `Icon Button ${id}`,
    nodeType: "FRAME",
    type: "button" as const,
    x: 0,
    y,
    width: 40,
    height: 40,
    fillColor: "#f1f1f1",
    children: [{ id: `${id}-icon`, name: "ic_bookmark_outline", nodeType: "INSTANCE", type: "container" as const, width: 24, height: 24 }]
  });
  const makeSemanticSelectInputNode = ({
    id,
    y
  }: {
    id: string;
    y: number;
  }) => ({
    id,
    name: "Styled(div)",
    nodeType: "FRAME",
    type: "input" as const,
    x: 0,
    y,
    width: 320,
    height: 72,
    fillColor: "#f5f5f5",
    children: [
      {
        id: `${id}-label`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Kontotyp",
        y
      },
      {
        id: `${id}-value`,
        name: "MuiSelectSelect",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Privat",
        y: y + 24
      }
    ]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-order-screen",
      name: "Theme C1 Order",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        makeSemanticSelectInputNode({ id: "c1-select-a", y: 0 }),
        makeSemanticSelectInputNode({ id: "c1-select-b", y: 84 }),
        makeSemanticSelectInputNode({ id: "c1-select-c", y: 168 }),
        makeIconOnlyButton({ id: "c1-icon-a", y: 260 }),
        makeIconOnlyButton({ id: "c1-icon-b", y: 320 }),
        makeIconOnlyButton({ id: "c1-icon-c", y: 380 })
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const formControlIndex = themeContent.indexOf("MuiFormControl: {");
  const iconButtonIndex = themeContent.indexOf("MuiIconButton: {");
  assert.ok(formControlIndex >= 0);
  assert.ok(iconButtonIndex > formControlIndex);
});

test("createDeterministicThemeFile does not allow C1 to override A3 component defaults", () => {
  const createCardNode = ({ id, y }: { id: string; y: number }) => ({
    id,
    name: `Card ${id}`,
    nodeType: "FRAME",
    type: "card" as const,
    x: 0,
    y,
    width: 300,
    height: 160,
    cornerRadius: 12,
    elevation: 3,
    children: [{ id: `${id}-text`, name: "Text", nodeType: "TEXT", type: "text" as const, text: "Info" }]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-a3-precedence-screen",
      name: "Theme C1 A3 Precedence",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [createCardNode({ id: "c1-card-a", y: 0 }), createCardNode({ id: "c1-card-b", y: 176 }), createCardNode({ id: "c1-card-c", y: 352 })]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const cardBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiCard"
  });
  assert.ok(cardBlock.includes('borderRadius: "12px"'));
  assert.equal(/borderRadius:\s*1(?!\d)/.test(cardBlock), false);
});

test("createDeterministicThemeFile keeps fallback-safe deterministic output when component samples are invalid", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-invalid-screen",
      name: "Theme Invalid Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "theme-invalid-card",
          name: "Invalid Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 140,
          cornerRadius: Number.NaN,
          elevation: Number.POSITIVE_INFINITY,
          children: [{ id: "theme-invalid-card-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Invalid" }]
        },
        {
          id: "theme-invalid-paper",
          name: "Invalid Paper",
          nodeType: "FRAME",
          type: "paper" as const,
          width: 280,
          height: 120,
          elevation: Number.NaN,
          children: [{ id: "theme-invalid-paper-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Invalid" }]
        },
        {
          id: "theme-invalid-avatar",
          name: "Invalid Avatar",
          nodeType: "FRAME",
          type: "avatar" as const,
          width: Number.POSITIVE_INFINITY,
          height: Number.NaN,
          cornerRadius: Number.NaN,
          children: [{ id: "theme-invalid-avatar-text", name: "Avatar Text", nodeType: "TEXT", type: "text" as const, text: "AV" }]
        }
      ]
    }
  ];

  const firstTheme = createDeterministicThemeFile(ir).content;
  const secondTheme = createDeterministicThemeFile(ir).content;

  assert.equal(firstTheme, secondTheme);
  assert.ok(firstTheme.includes("MuiButton: {"));
  assert.equal(firstTheme.includes("MuiCard: {"), false);
  assert.equal(firstTheme.includes("MuiTextField: {"), false);
  assert.equal(firstTheme.includes("MuiChip: {"), false);
  assert.equal(firstTheme.includes("MuiPaper: {"), false);
  assert.equal(firstTheme.includes("MuiAppBar: {"), false);
  assert.equal(firstTheme.includes("MuiDivider: {"), false);
  assert.equal(firstTheme.includes("MuiAvatar: {"), false);
});

test("deterministic theme dark palette remains byte-stable and accessible on dark surfaces", () => {
  const ir = createIr();
  const firstTheme = createDeterministicThemeFile(ir).content;
  const secondTheme = createDeterministicThemeFile(ir).content;

  assert.equal(firstTheme, secondTheme);

  const darkBackground = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "background"
  });
  const darkPrimary = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "primary"
  });
  const darkSecondary = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "secondary"
  });
  const darkSuccess = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "success"
  });
  const darkWarning = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "warning"
  });
  const darkError = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "error"
  });
  const darkInfo = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "info"
  });

  for (const color of [darkPrimary, darkSecondary, darkSuccess, darkWarning, darkError, darkInfo]) {
    assert.ok(contrastRatio(color, darkBackground) >= 4.5);
  }
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

test("generateArtifacts simplify wrapper promotes deep GROUP multi-child containers and logs stats", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-group-deep-"));
  const logs: string[] = [];
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-group-deep-screen",
      name: "Simplify Group Deep",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "group-depth-root",
          name: "Depth Root",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 360,
          height: 280,
          fillColor: "#ffffff",
          children: [
            {
              id: "group-depth-inner",
              name: "Depth Inner",
              nodeType: "FRAME",
              type: "container" as const,
              x: 16,
              y: 16,
              width: 320,
              height: 220,
              fillColor: "#f8fafc",
              children: [
                {
                  id: "group-depth-target",
                  name: "Promotable Group",
                  nodeType: "GROUP",
                  type: "container" as const,
                  x: 24,
                  y: 24,
                  width: 280,
                  height: 100,
                  children: [
                    {
                      id: "group-depth-text-a",
                      name: "Group Text A",
                      nodeType: "TEXT",
                      type: "text" as const,
                      text: "Erster Eintrag",
                      x: 24,
                      y: 24
                    },
                    {
                      id: "group-depth-text-b",
                      name: "Group Text B",
                      nodeType: "TEXT",
                      type: "text" as const,
                      text: "Zweiter Eintrag",
                      x: 24,
                      y: 56
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 1);
  assert.equal(result.generationMetrics.simplification?.screens[0]?.promotedGroupMultiChild, 1);
  assert.ok(logs.some((entry) => entry.includes("Simplify stats:")));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as {
    simplification?: {
      aggregate?: { promotedGroupMultiChild?: number };
      screens?: Array<{ promotedGroupMultiChild?: number }>;
    };
  };
  assert.equal(metrics.simplification?.aggregate?.promotedGroupMultiChild, 1);
  assert.equal(metrics.simplification?.screens?.[0]?.promotedGroupMultiChild, 1);
});

test("generateArtifacts simplify wrapper does not promote shallow GROUP multi-child containers", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-group-shallow-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-group-shallow-screen",
      name: "Simplify Group Shallow",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "group-shallow-target",
          name: "Shallow Group",
          nodeType: "GROUP",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          children: [
            {
              id: "group-shallow-a",
              name: "Shallow A",
              nodeType: "TEXT",
              type: "text" as const,
              text: "A"
            },
            {
              id: "group-shallow-b",
              name: "Shallow B",
              nodeType: "TEXT",
              type: "text" as const,
              text: "B"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 0);
  assert.equal(result.generationMetrics.simplification?.screens[0]?.promotedGroupMultiChild, 0);
});

test("generateArtifacts simplify wrapper does not promote non-GROUP multi-child flex wrappers", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-frame-multi-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-frame-multi-screen",
      name: "Simplify Frame Multi",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "frame-multi-target",
          name: "Frame Multi Wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          layoutMode: "HORIZONTAL" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          children: [
            {
              id: "frame-multi-a",
              name: "Frame Multi A",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Element A"
            },
            {
              id: "frame-multi-b",
              name: "Frame Multi B",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Element B"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 0);
  assert.equal(result.generationMetrics.simplification?.aggregate.promotedSingleChild, 0);
});

test("deterministic screen rendering simplify wrapper merges parent margin and padding into promoted single child", () => {
  const screen = {
    id: "single-child-spacing-merge-screen",
    name: "Single Child Spacing Merge",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-child-spacing-wrapper",
        name: "Spacing Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        margin: { top: 8, right: 16, bottom: 24, left: 32 },
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        children: [
          {
            id: "single-child-spacing-target",
            name: "Promoted Target",
            nodeType: "FRAME",
            type: "container" as const,
            x: 0,
            y: 0,
            width: 280,
            height: 120,
            fillColor: "#ffffff",
            margin: { top: 8, right: 8, bottom: 8, left: 8 },
            children: [
              {
                id: "single-child-spacing-text",
                name: "Spacing Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Spacing merged"
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("mt: 3"));
  assert.ok(content.includes("mr: 4"));
  assert.ok(content.includes("mb: 5"));
  assert.ok(content.includes("ml: 6"));
});

test("generateArtifacts simplify wrapper guardrails keep navigation and icon wrappers from promotion", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-guardrails-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-guardrails-screen",
      name: "Simplify Guardrails",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "guardrail-nav-wrapper",
          name: "Navigation Wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          prototypeNavigation: {
            targetScreenId: "screen-1",
            mode: "push" as const
          },
          children: [
            {
              id: "guardrail-nav-text",
              name: "Navigation Text",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Open destination"
            }
          ]
        },
        {
          id: "guardrail-icon-wrapper",
          name: "icon/wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          children: [
            {
              id: "guardrail-icon-text",
              name: "Icon Label",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Icon wrapper text"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedSingleChild, 0);
  assert.equal((result.generationMetrics.simplification?.aggregate.guardedSkips ?? 0) >= 2, true);
});

test("deterministic screen rendering omits redundant boxSizing and visible overflow defaults", () => {
  const screen = {
    id: "no-redundant-defaults-screen",
    name: "No Redundant Defaults",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "defaults-container",
        name: "Defaults Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        fillColor: "#ffffff",
        children: [
          {
            id: "defaults-text",
            name: "Defaults Text",
            nodeType: "TEXT",
            type: "text" as const,
            x: 16,
            y: 16,
            width: 160,
            height: 20,
            text: "Kontostand"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assert.equal(content.includes('boxSizing: "border-box"'), false);
  assert.equal(content.includes('overflow: "visible"'), false);
  assert.ok(content.includes("<Container maxWidth="));
});

test("sortChildren visual hierarchy keeps row grouping for layout NONE with x interleaving", () => {
  const screen = {
    id: "sortchildren-row-grouping-screen",
    name: "SortChildren Row Grouping",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "row-grouping-container",
        name: "Row Grouping Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 220,
        children: [
          {
            id: "row-bottom-left",
            name: "Bottom Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bottom Left Item",
            x: 20,
            y: 120
          },
          {
            id: "row-top-right",
            name: "Top Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Top Right Item",
            x: 250,
            y: 10
          },
          {
            id: "row-bottom-right",
            name: "Bottom Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bottom Right Item",
            x: 260,
            y: 120
          },
          {
            id: "row-top-left",
            name: "Top Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Top Left Item",
            x: 10,
            y: 10
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Top Left Item"}', '{"Top Right Item"}', '{"Bottom Left Item"}', '{"Bottom Right Item"}']
  });
});

test("sortChildren visual hierarchy preserves overlap order via source index", () => {
  const screen = {
    id: "sortchildren-overlap-screen",
    name: "SortChildren Overlap",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "overlap-container",
        name: "Overlap Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 180,
        children: [
          {
            id: "overlap-first",
            name: "First Layer",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Overlap First Layer",
            x: 120,
            y: 24,
            width: 160,
            height: 28
          },
          {
            id: "overlap-second",
            name: "Second Layer",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Overlap Second Layer",
            x: 80,
            y: 24,
            width: 160,
            height: 28
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Overlap First Layer"}', '{"Overlap Second Layer"}']
  });
});

test("sortChildren visual hierarchy orders row semantics as header navigation content decorative", () => {
  const screen = {
    id: "sortchildren-semantic-screen",
    name: "SortChildren Semantic",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "semantic-container",
        name: "Semantic Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 420,
        height: 200,
        children: [
          {
            id: "semantic-content",
            name: "Body Copy",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Content",
            x: 20,
            y: 20
          },
          {
            id: "semantic-divider",
            name: "Decorative Divider",
            nodeType: "FRAME",
            type: "divider" as const,
            x: 140,
            y: 20,
            width: 200,
            height: 1,
            fillColor: "#e5e7eb"
          },
          {
            id: "semantic-navigation",
            name: "Main Navigation",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Navigation",
            x: 220,
            y: 20
          },
          {
            id: "semantic-header",
            name: "Page Heading",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Header",
            x: 320,
            y: 20,
            fontSize: 30,
            fontWeight: 700
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Semantic Header"}', '{"Semantic Navigation"}', '{"Semantic Content"}', '<Divider aria-hidden="true"']
  });
});

test("sortChildren visual hierarchy supports rtl locale x ordering for NONE rows", () => {
  const screen = {
    id: "sortchildren-rtl-screen",
    name: "SortChildren RTL",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "rtl-container",
        name: "RTL Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        children: [
          {
            id: "rtl-left",
            name: "Left Item",
            nodeType: "TEXT",
            type: "text" as const,
            text: "RTL Left",
            x: 20,
            y: 24
          },
          {
            id: "rtl-right",
            name: "Right Item",
            nodeType: "TEXT",
            type: "text" as const,
            text: "RTL Right",
            x: 220,
            y: 24
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { generationLocale: "ar-EG" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"RTL Right"}', '{"RTL Left"}']
  });
});

test("sortChildren regression keeps HORIZONTAL and VERTICAL ordering unchanged", () => {
  const screen = {
    id: "sortchildren-regression-screen",
    name: "SortChildren Regression",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "horizontal-container",
        name: "Horizontal",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 80,
        children: [
          {
            id: "horizontal-right",
            name: "Horizontal Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Right",
            x: 240,
            y: 10
          },
          {
            id: "horizontal-left",
            name: "Horizontal Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Left",
            x: 20,
            y: 10
          },
          {
            id: "horizontal-middle",
            name: "Horizontal Middle",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Middle",
            x: 140,
            y: 10
          }
        ]
      },
      {
        id: "vertical-container",
        name: "Vertical",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 120,
        width: 360,
        height: 140,
        children: [
          {
            id: "vertical-bottom",
            name: "Vertical Bottom",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Bottom",
            x: 0,
            y: 90
          },
          {
            id: "vertical-top",
            name: "Vertical Top",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Top",
            x: 0,
            y: 10
          },
          {
            id: "vertical-middle",
            name: "Vertical Middle",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Middle",
            x: 0,
            y: 50
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Horizontal Left"}', '{"Horizontal Middle"}', '{"Horizontal Right"}']
  });
  assertMarkersInOrder({
    content,
    markers: ['{"Vertical Top"}', '{"Vertical Middle"}', '{"Vertical Bottom"}']
  });
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
  assert.deepEqual(result.screenRejected, []);
  assert.deepEqual(result.llmWarnings, []);
  assert.equal(result.generatedPaths.includes("src/App.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/components/ErrorBoundary.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/components/ScreenSkeleton.tsx"), true);
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
  assert.ok(appContent.includes("BrowserRouter"));
  assert.equal(appContent.includes("HashRouter"), false);
  assert.ok(appContent.includes("Suspense"));
  assert.ok(appContent.includes('import ErrorBoundary from "./components/ErrorBoundary";'));
  assert.ok(appContent.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appContent.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appContent.includes("element={<ErrorBoundary><"));

  const errorBoundaryContent = await readFile(path.join(projectDir, "src", "components", "ErrorBoundary.tsx"), "utf8");
  assert.ok(errorBoundaryContent.includes("class ErrorBoundary extends Component"));
  assert.ok(errorBoundaryContent.includes("static getDerivedStateFromError"));
  assert.ok(errorBoundaryContent.includes("handleRetry"));
  assert.ok(errorBoundaryContent.includes("Try again"));

  const screenSkeletonContent = await readFile(path.join(projectDir, "src", "components", "ScreenSkeleton.tsx"), "utf8");
  assert.ok(screenSkeletonContent.includes("function ScreenSkeleton"));
  assert.ok(screenSkeletonContent.includes("LinearProgress"));
  assert.ok(screenSkeletonContent.includes("Skeleton"));

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(generatedScreenContent.includes('import MappedInput from "@acme/ui";'));
  assert.ok(generatedScreenContent.includes("<MappedInput"));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as { skippedHidden?: number; truncatedScreens?: unknown[] };
  assert.equal(typeof metrics.skippedHidden, "number");
  assert.equal(Array.isArray(metrics.truncatedScreens), true);
});

test("generateArtifacts caps representative screen test targets and keeps test output deterministic", async () => {
  const createTargetRichIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "target-rich-screen",
        name: "Target Rich Screen",
        layoutMode: "VERTICAL" as const,
        gap: 8,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        children: [
          ...Array.from({ length: 9 }, (_, index) => ({
            id: `target-rich-text-${index + 1}`,
            name: `Headline ${index + 1}`,
            nodeType: "TEXT" as const,
            type: "text" as const,
            text: `Headline ${String(index + 1).padStart(2, "0")}`
          })),
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `target-rich-button-${index + 1}`,
            name: `Action ${index + 1}`,
            nodeType: "FRAME" as const,
            type: "button" as const,
            width: 220,
            height: 48,
            fillColor: "#d4001a",
            children: [
              {
                id: `target-rich-button-${index + 1}-label`,
                name: "Label",
                nodeType: "TEXT" as const,
                type: "text" as const,
                text: `Action ${index + 1}`,
                fillColor: "#ffffff"
              }
            ]
          })),
          ...Array.from({ length: 7 }, (_, index) =>
            createSemanticInputNode({
              id: `target-rich-input-${index + 1}`,
              name: `Input Field ${index + 1}`,
              label: `Input ${index + 1}`
            })
          ),
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `target-rich-select-${index + 1}`,
            name: `Select Field ${index + 1}`,
            nodeType: "FRAME" as const,
            type: "select" as const,
            layoutMode: "VERTICAL" as const,
            gap: 4,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            width: 320,
            height: 72,
            children: [
              {
                id: `target-rich-select-${index + 1}-label`,
                name: "Label",
                nodeType: "TEXT" as const,
                type: "text" as const,
                text: `Select ${index + 1}`
              }
            ]
          }))
        ]
      }
    ];
    return ir;
  };

  const firstRunDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-screen-tests-caps-a-"));
  const secondRunDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-screen-tests-caps-b-"));
  const firstResult = await generateArtifacts({
    projectDir: firstRunDir,
    ir: createTargetRichIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const secondResult = await generateArtifacts({
    projectDir: secondRunDir,
    ir: createTargetRichIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const firstTestPath = firstResult.generatedPaths.find(
    (entry) => entry.startsWith("src/screens/__tests__/") && entry.endsWith(".test.tsx")
  );
  const secondTestPath = secondResult.generatedPaths.find(
    (entry) => entry.startsWith("src/screens/__tests__/") && entry.endsWith(".test.tsx")
  );
  assert.ok(firstTestPath, "Expected test file path for first run.");
  assert.ok(secondTestPath, "Expected test file path for second run.");

  const firstContent = await readFile(path.join(firstRunDir, firstTestPath ?? ""), "utf8");
  const secondContent = await readFile(path.join(secondRunDir, secondTestPath ?? ""), "utf8");
  assert.equal(firstContent, secondContent);
  assert.ok(firstContent.includes('import { render, screen } from "@testing-library/react";'));
  assert.ok(firstContent.includes('import userEvent from "@testing-library/user-event";'));
  assert.ok(firstContent.includes('import { axe } from "jest-axe";'));
  assert.ok(firstContent.includes("<ThemeProvider theme={appTheme} defaultMode=\"system\" noSsr>"));
  assert.ok(firstContent.includes("<MemoryRouter>"));
  assert.ok(firstContent.includes('it("renders without crashing"'));
  assert.ok(firstContent.includes('it("renders representative text content"'));
  assert.ok(firstContent.includes('it("keeps representative controls interactive"'));
  assert.ok(firstContent.includes('it("has no detectable accessibility violations"'));
  assert.ok(firstContent.includes("const normalizeTextForAssertion = (value: string): string => {"));
  assert.ok(firstContent.includes("const expectTextToBePresent = ({ container, expectedText }"));
  assert.ok(firstContent.includes('const axeConfig = {'));
  assert.ok(firstContent.includes('"heading-order": { enabled: false }'));
  assert.ok(firstContent.includes('"landmark-banner-is-top-level": { enabled: false }'));
  assert.ok(firstContent.includes("expectTextToBePresent({ container, expectedText });"));
  assert.ok(firstContent.includes("const results = await axe(container, axeConfig);"));
  assert.ok(firstContent.includes("expect(results).toHaveNoViolations();"));

  const expectedTexts = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedTexts"
  });
  const expectedButtonLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedButtonLabels"
  });
  const expectedInputLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedTextInputLabels"
  });
  const expectedSelectLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedSelectLabels"
  });

  assert.deepEqual(expectedTexts, [
    "Headline 01",
    "Headline 02",
    "Headline 03",
    "Headline 04",
    "Headline 05",
    "Headline 06",
    "Headline 07",
    "Headline 08"
  ]);
  assert.deepEqual(expectedButtonLabels, ["Action 1", "Action 2", "Action 3", "Action 4", "Action 5", "Action 6"]);
  assert.deepEqual(expectedInputLabels, [
    "Input Field 1",
    "Input Field 2",
    "Input Field 3",
    "Input Field 4",
    "Input Field 5",
    "Input Field 6"
  ]);
  assert.deepEqual(expectedSelectLabels, ["Select 1", "Select 2", "Select 3", "Select 4", "Select 5", "Select 6"]);
});

test("generateArtifacts extracts repeated screen-local card patterns into reusable component files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-extract-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "offers-screen",
      name: "Offers",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "offer-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "offer-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "offer-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "offer-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "offer-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "offer-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    imageAssetMap: {
      "offer-image-a": "/images/offer-a.png",
      "offer-image-b": "/images/offer-b.png",
      "offer-image-c": "/images/offer-c.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/OffersPattern1.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/context/OffersPatternContext.tsx"), true);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Offers")), "utf8");
  assert.ok(screenContent.includes('import { OffersPattern1 } from "../components/OffersPattern1";'));
  assert.ok(screenContent.includes('import { OffersPatternContextProvider, type OffersPatternContextState } from "../context/OffersPatternContext";'));
  assert.ok(screenContent.includes("const patternContextInitialState: OffersPatternContextState = {"));
  assert.ok(screenContent.includes("<OffersPatternContextProvider initialState={patternContextInitialState}>"));
  assert.equal(countOccurrences(screenContent, "<OffersPattern1"), 3);
  assert.equal(screenContent.includes("<Card"), false);
  assert.ok(screenContent.includes('instanceId={"offer-card-a"}'));
  assert.ok(screenContent.includes('"Starter Paket"'));
  assert.equal(screenContent.includes('offerTitleText={"Starter Paket"}'), false);
  assert.equal(screenContent.includes('offerImageSrc={"/images/offer-a.png"}'), false);

  const componentContent = await readFile(path.join(projectDir, "src", "components", "OffersPattern1.tsx"), "utf8");
  assert.ok(componentContent.includes("interface OffersPattern1Props"));
  assert.ok(componentContent.includes("instanceId: string;"));
  assert.ok(componentContent.includes("sx?: SxProps<Theme>;"));
  assert.ok(componentContent.includes('import { useOffersPatternContext } from "../context/OffersPatternContext";'));
  assert.ok(componentContent.includes("const patternContext = useOffersPatternContext();"));
  assert.equal(componentContent.includes("offerTitleText: string;"), false);
  assert.equal(componentContent.includes("offerImageSrc: string;"), false);
  assert.ok(componentContent.includes("sx={[{"));
  assert.equal(componentContent.includes("/images/offer-a.png"), false);

  const patternContextContent = await readFile(path.join(projectDir, "src", "context", "OffersPatternContext.tsx"), "utf8");
  assert.ok(patternContextContent.includes("export interface OffersPattern1State"));
  assert.ok(patternContextContent.includes("offerTitleText: string;"));
  assert.ok(patternContextContent.includes("offerImageSrc: string;"));
  assert.ok(patternContextContent.includes("export function OffersPatternContextProvider"));
});

test("generateArtifacts keeps pattern and form provider wrapping order stable when both are present", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-provider-order-"));
  const ir = createMixedFallbackStageIr();

  await generateArtifacts({
    projectDir,
    ir,
    imageAssetMap: mixedFallbackStageImageAssetMap,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Mixed Fallback Stage")), "utf8");
  const patternProviderMatch = screenContent.match(
    /import \{ ([A-Za-z0-9_]+PatternContextProvider), type [^}]+ \} from "\.\.\/context\/[^"]+";/
  );
  const formProviderMatch = screenContent.match(
    /import \{ ([A-Za-z0-9_]+FormContextProvider), [^}]+ \} from "\.\.\/context\/[^"]+";/
  );
  const screenContentComponentMatch = screenContent.match(/function ([A-Za-z0-9_]+ScreenContent)\(\)/);
  assert.ok(patternProviderMatch?.[1], "Expected pattern context provider import.");
  assert.ok(formProviderMatch?.[1], "Expected form context provider import.");
  assert.ok(screenContentComponentMatch?.[1], "Expected screen content function.");

  const patternProvider = patternProviderMatch?.[1] ?? "";
  const formProvider = formProviderMatch?.[1] ?? "";
  const screenContentComponent = screenContentComponentMatch?.[1] ?? "";
  const patternStart = screenContent.indexOf(`<${patternProvider} initialState={patternContextInitialState}>`);
  const formStart = screenContent.indexOf(`<${formProvider}>`);
  const contentStart = screenContent.indexOf(`<${screenContentComponent} />`);
  const formEnd = screenContent.indexOf(`</${formProvider}>`);
  const patternEnd = screenContent.indexOf(`</${patternProvider}>`);

  assert.ok(patternStart >= 0, "Expected pattern context wrapper.");
  assert.ok(formStart >= 0, "Expected form context wrapper.");
  assert.ok(contentStart >= 0, "Expected screen content wrapper.");
  assert.ok(formEnd >= 0, "Expected closing form context wrapper.");
  assert.ok(patternEnd >= 0, "Expected closing pattern context wrapper.");
  assert.ok(patternStart < formStart);
  assert.ok(formStart < contentStart);
  assert.ok(contentStart < formEnd);
  assert.ok(formEnd < patternEnd);
  assert.ok(screenContent.includes("import { Link as RouterLink } from \"react-router-dom\";"));
  assert.ok(screenContent.includes('import SearchIcon from "@mui/icons-material/Search";'));
});

test("generateArtifacts keeps mixed fallback files byte-stable across repeated generation runs", async () => {
  const firstProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-byte-stable-first-"));
  const secondProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-byte-stable-second-"));
  const ir = createMixedFallbackStageIr();

  const generateAndCollect = async (projectDir: string) => {
    await generateArtifacts({
      projectDir,
      ir,
      imageAssetMap: mixedFallbackStageImageAssetMap,
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      }
    });
    const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Mixed Fallback Stage")), "utf8");
    const componentImportMatches = Array.from(screenContent.matchAll(/from "\.\.\/components\/([^"]+)";/g));
    const contextImportMatches = Array.from(screenContent.matchAll(/from "\.\.\/context\/([^"]+)";/g));

    const componentContents = (
      await Promise.all(
        componentImportMatches.map(async (match) => {
          const moduleName = match[1] ?? "";
          const content = await readFile(path.join(projectDir, "src", "components", `${moduleName}.tsx`), "utf8");
          return {
            moduleName,
            content
          };
        })
      )
    ).sort((left, right) => left.moduleName.localeCompare(right.moduleName));

    const contextContents = (
      await Promise.all(
        contextImportMatches.map(async (match) => {
          const moduleName = match[1] ?? "";
          const content = await readFile(path.join(projectDir, "src", "context", `${moduleName}.tsx`), "utf8");
          return {
            moduleName,
            content
          };
        })
      )
    ).sort((left, right) => left.moduleName.localeCompare(right.moduleName));

    return {
      screenContent,
      componentContents,
      contextContents
    };
  };

  const first = await generateAndCollect(firstProjectDir);
  const second = await generateAndCollect(secondProjectDir);
  assert.equal(first.screenContent, second.screenContent);
  assert.deepEqual(first.componentContents, second.componentContents);
  assert.deepEqual(first.contextContents, second.contextContents);
});

test("generateArtifacts applies design-system mappings to screen and extracted pattern component files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-"));
  const designSystemFilePath = path.join(projectDir, "design-system.json");
  await writeFile(
    designSystemFilePath,
    `${JSON.stringify(
      {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "PrimaryButton",
            propMappings: {
              variant: "appearance"
            }
          },
          Card: {
            component: "ContentCard"
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const ir = createIr();
  ir.screens = [
    {
      id: "design-system-screen",
      name: "Design System",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "design-system-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Jetzt starten"
        },
        {
          id: "design-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "design-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "design-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "design-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "design-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "design-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    imageAssetMap: {
      "design-image-a": "/images/design-a.png",
      "design-image-b": "/images/design-b.png",
      "design-image-c": "/images/design-c.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/DesignSystemPattern1.tsx"), true);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Design System")), "utf8");
  assert.ok(screenContent.includes('import { PrimaryButton } from "@acme/ui";'));
  assert.ok(screenContent.includes("<PrimaryButton"));
  assert.ok(screenContent.includes("appearance="));
  assert.equal(screenContent.includes('import { Button } from "@mui/material";'), false);

  const patternContent = await readFile(path.join(projectDir, "src", "components", "DesignSystemPattern1.tsx"), "utf8");
  assert.ok(patternContent.includes('import { ContentCard } from "@acme/ui";'));
  assert.ok(patternContent.includes("<ContentCard"));
  assert.equal(/<Card(?=[\s>])/.test(patternContent), false);
});

test("generateArtifacts keeps MUI fallback when design-system config file is missing", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-missing-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "missing-design-system-screen",
      name: "Missing Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "missing-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
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

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Missing Design System")), "utf8");
  assert.ok(screenContent.includes("<Button"));
  assert.ok(screenContent.includes('import { Button, Container } from "@mui/material";'));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts logs warning and keeps MUI fallback when design-system config is invalid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-invalid-"));
  const designSystemFilePath = path.join(projectDir, "design-system.invalid.json");
  const logs: string[] = [];
  await writeFile(designSystemFilePath, `${JSON.stringify({ library: "", mappings: [] }, null, 2)}\n`, "utf8");

  const ir = createIr();
  ir.screens = [
    {
      id: "invalid-design-system-screen",
      name: "Invalid Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "invalid-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.ok(logs.some((entry) => entry.includes("Design system config") && entry.includes("invalid")));
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Invalid Design System")), "utf8");
  assert.ok(screenContent.includes("<Button"));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts keeps node-level componentMappings precedence over design-system mapping", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-priority-"));
  const designSystemFilePath = path.join(projectDir, "design-system.json");
  await writeFile(
    designSystemFilePath,
    `${JSON.stringify(
      {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "PrimaryButton",
            propMappings: {
              variant: "appearance"
            }
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const ir = createIr();
  ir.screens = [
    {
      id: "priority-design-system-screen",
      name: "Priority Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "priority-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "priority-design-button",
        componentName: "CustomActionButton",
        importPath: "@custom/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ],
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Priority Design System")), "utf8");
  assert.ok(screenContent.includes('from "@custom/ui";'));
  assert.ok(screenContent.includes("CustomActionButton"));
  assert.ok(screenContent.includes("<CustomActionButton"));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts keeps componentMappings precedence over pattern dispatch and remains byte-stable", async () => {
  const createDispatchPrecedenceIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "dispatch-precedence-screen",
        name: "Dispatch Precedence",
        layoutMode: "NONE" as const,
        gap: 0,
        width: 360,
        height: 640,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "mapped-header-container",
            name: "Primary Header",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            primaryAxisAlignItems: "SPACE_BETWEEN" as const,
            counterAxisAlignItems: "CENTER" as const,
            x: 0,
            y: 0,
            width: 360,
            height: 72,
            fillColor: "#ee0000",
            children: [
              {
                id: "mapped-header-title",
                name: "Header Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Dashboard",
                x: 16,
                y: 24,
                fillColor: "#ffffff"
              },
              {
                id: "mapped-header-action",
                name: "Open Menu",
                nodeType: "FRAME",
                type: "button" as const,
                x: 312,
                y: 20,
                width: 32,
                height: 32,
                children: []
              }
            ]
          }
        ]
      }
    ];
    return ir;
  };

  const componentMappings = [
    {
      boardKey: "board-1",
      nodeId: "mapped-header-container",
      componentName: "MappedHeader",
      importPath: "@custom/ui",
      priority: 0,
      source: "local_override" as const,
      enabled: true
    }
  ];

  const generateScreenContent = async (suffix: string): Promise<string> => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-generator-dispatch-precedence-${suffix}-`));
    await generateArtifacts({
      projectDir,
      ir: createDispatchPrecedenceIr(),
      componentMappings,
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      }
    });
    return await readFile(path.join(projectDir, toDeterministicScreenPath("Dispatch Precedence")), "utf8");
  };

  const first = await generateScreenContent("a");
  const second = await generateScreenContent("b");

  assert.equal(first, second);
  assert.ok(first.includes('from "@custom/ui";'));
  assert.ok(first.includes("<MappedHeader"));
  assert.equal(first.includes("<AppBar "), false);
  assert.equal(first.includes("<Toolbar>"), false);
});

test("generateArtifacts renders mapped VECTOR nodes and keeps unmapped VECTOR fallback behavior", async () => {
  const createVectorIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "mapped-vector-screen",
        name: "Mapped Vector Screen",
        layoutMode: "NONE" as const,
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "mapped-vector-node",
            name: "Mapped Vector",
            nodeType: "VECTOR",
            type: "container" as const,
            x: 0,
            y: 0,
            width: 24,
            height: 24,
            vectorPaths: ["M2 2 L22 22"]
          },
          {
            id: "unmapped-vector-node",
            name: "Unmapped Vector",
            nodeType: "VECTOR",
            type: "container" as const,
            x: 40,
            y: 0,
            width: 24,
            height: 24,
            vectorPaths: ["M22 2 L2 22"]
          },
          {
            id: "mapped-vector-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vector diagnostics"
          }
        ]
      }
    ];
    return ir;
  };

  const mappedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-vector-mapped-"));
  await generateArtifacts({
    projectDir: mappedProjectDir,
    ir: createVectorIr(),
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "mapped-vector-node",
        componentName: "CustomVectorIcon",
        importPath: "@custom/icons",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ],
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const mappedContent = await readFile(path.join(mappedProjectDir, toDeterministicScreenPath("Mapped Vector Screen")), "utf8");
  assert.ok(mappedContent.includes('from "@custom/icons";'));
  assert.ok(mappedContent.includes("<CustomVectorIcon"));
  assert.ok(mappedContent.includes('data-figma-node-id={"mapped-vector-node"}'));
  assert.equal(mappedContent.includes("unmapped-vector-node"), false);

  const fallbackProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-vector-fallback-"));
  await generateArtifacts({
    projectDir: fallbackProjectDir,
    ir: createVectorIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const fallbackContent = await readFile(path.join(fallbackProjectDir, toDeterministicScreenPath("Mapped Vector Screen")), "utf8");
  assert.equal(fallbackContent.includes("CustomVectorIcon"), false);
  assert.equal(fallbackContent.includes("mapped-vector-node"), false);
});

test("generateArtifacts keeps inline rendering when repeated pattern count is below extraction threshold", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-threshold-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "offer-pair-screen",
      name: "Offer Pair",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "offer-pair-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-pair-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-pair-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            }
          ]
        },
        {
          id: "offer-pair-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-pair-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-pair-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.some((entry) => /src\/components\/.*Pattern\d+\.tsx/.test(entry)), false);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Offer Pair")), "utf8");
  assert.equal(screenContent.includes("Pattern"), false);
  assert.ok(screenContent.includes("<Card"));
});

test("generateArtifacts skips pattern context when extracted clusters have no dynamic bindings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-no-context-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "static-offers-screen",
      name: "Static Offers",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
      children: [
        {
          id: "static-card-a",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-a-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-a-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        },
        {
          id: "static-card-b",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-b-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-b-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        },
        {
          id: "static-card-c",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-c-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-c-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/StaticOffersPattern1.tsx"), true);
  assert.equal(result.generatedPaths.some((entry) => /src\/context\/.*PatternContext\.tsx$/.test(entry)), false);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Static Offers")), "utf8");
  assert.ok(screenContent.includes("<StaticOffersPattern1"));
  assert.equal(screenContent.includes("instanceId={"), false);
  assert.equal(screenContent.includes("PatternContextProvider"), false);

  const componentContent = await readFile(path.join(projectDir, "src", "components", "StaticOffersPattern1.tsx"), "utf8");
  assert.equal(componentContent.includes("instanceId: string;"), false);
  assert.equal(componentContent.includes("PatternContext"), false);
});

test("generateArtifacts skips extraction when structure similarity threshold is not met", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-similarity-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "similarity-screen",
      name: "Similarity Screen",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "sim-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          children: [
            {
              id: "sim-title-a",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "A"
            },
            {
              id: "sim-image-a",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        },
        {
          id: "sim-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          children: [
            {
              id: "sim-title-b",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "B"
            },
            {
              id: "sim-image-b",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        },
        {
          id: "sim-card-c",
          name: "Different Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 220,
          children: [
            {
              id: "sim-title-c",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "C"
            },
            {
              id: "sim-subtitle-c",
              name: "Subtitle",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Extra"
            },
            {
              id: "sim-image-c",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.some((entry) => /src\/components\/.*Pattern\d+\.tsx/.test(entry)), false);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Similarity Screen")), "utf8");
  assert.equal(screenContent.includes("Pattern"), false);
});

test("generateArtifacts emits per-screen form context and rewires screen form state through hook usage", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-form-context-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "loan-form-screen",
      name: "Loan Form",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        createSemanticInputNode({ id: "loan-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" }),
        {
          id: "loan-submit-button",
          name: "Primary Submit",
          nodeType: "FRAME",
          type: "button" as const,
          width: 220,
          height: 48,
          fillColor: "#d4001a",
          children: [
            {
              id: "loan-submit-button-label",
              name: "Label",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Continue",
              fillColor: "#ffffff"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/context/LoanFormFormContext.tsx"), true);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Loan Form")), "utf8");
  assert.ok(screenContent.includes('import { LoanFormFormContextProvider, useLoanFormFormContext } from "../context/LoanFormFormContext";'));
  assert.ok(screenContent.includes("function LoanFormScreenContent() {"));
  assert.ok(
    screenContent.includes(
      "const { control, handleSubmit, onSubmit, resolveFieldErrorMessage } = useLoanFormFormContext();"
    )
  );
  assert.ok(screenContent.includes("<LoanFormFormContextProvider>"));
  assert.ok(screenContent.includes('component="form" onSubmit={handleSubmit(onSubmit)} noValidate'));
  assert.ok(screenContent.includes("<Controller"));
  assert.equal(screenContent.includes("const [formValues, setFormValues] = useState<Record<string, string>>("), false);
  assert.equal(screenContent.includes("const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);"), false);
  assert.equal(screenContent.includes("const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});"), false);

  const formContextContent = await readFile(path.join(projectDir, "src", "context", "LoanFormFormContext.tsx"), "utf8");
  assert.ok(formContextContent.includes("createContext"));
  assert.ok(formContextContent.includes('import { useForm, type UseFormReturn } from "react-hook-form";'));
  assert.ok(formContextContent.includes('import { zodResolver } from "@hookform/resolvers/zod";'));
  assert.ok(formContextContent.includes('import { z } from "zod";'));
  assert.ok(formContextContent.includes("const { control, handleSubmit } = useForm({"));
  assert.ok(formContextContent.includes("const onSubmit = (values: Record<string, string>): void => {"));
  assert.ok(formContextContent.includes("export const useLoanFormFormContext = (): LoanFormFormContextValue => {"));
});

test("generateArtifacts keeps legacy form scaffolding when formHandlingMode=legacy_use_state is requested", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-form-legacy-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "legacy-form-screen",
      name: "Legacy Form",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [createSemanticInputNode({ id: "legacy-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" })]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    formHandlingMode: "legacy_use_state",
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Legacy Form")), "utf8");
  assert.ok(screenContent.includes("<LegacyFormFormContextProvider>"));
  assert.ok(screenContent.includes("useLegacyFormFormContext"));
  assert.ok(screenContent.includes('component="form" onSubmit={handleSubmit} noValidate'));
  assert.equal(screenContent.includes("<Controller"), false);

  const formContextContent = await readFile(path.join(projectDir, "src", "context", "LegacyFormFormContext.tsx"), "utf8");
  assert.ok(formContextContent.includes("const [formValues, setFormValues] = useState<Record<string, string>>("));
  assert.ok(formContextContent.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"));
  assert.equal(formContextContent.includes("useForm<Record<string, string>>"), false);
});

test("generateArtifacts injects exported image asset paths into image and CardMedia rendering", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-images-"));
  const imageScreen = {
    id: "image-screen",
    name: "Image Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "hero-image",
        name: "Hero Image",
        nodeType: "RECTANGLE",
        type: "image" as const,
        width: 320,
        height: 180
      },
      {
        id: "summary-card",
        name: "Summary Card",
        nodeType: "FRAME",
        type: "card" as const,
        width: 320,
        height: 260,
        fillColor: "#ffffff",
        children: [
          {
            id: "card-media-image",
            name: "Card Media",
            nodeType: "RECTANGLE",
            type: "image" as const,
            width: 320,
            height: 140
          },
          {
            id: "card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Card headline"
          }
        ]
      },
      {
        id: "table-with-image",
        name: "Table With Image",
        nodeType: "FRAME",
        type: "table" as const,
        width: 400,
        height: 180,
        children: [
          {
            id: "table-header-row",
            name: "Header Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              {
                id: "table-header-col-1",
                name: "Product",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Product"
              },
              {
                id: "table-header-col-2",
                name: "Details",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Details"
              }
            ]
          },
          {
            id: "table-body-row",
            name: "Body Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              {
                id: "table-image-cell",
                name: "Table Image",
                nodeType: "RECTANGLE",
                type: "image" as const,
                width: 120,
                height: 80
              },
              {
                id: "table-text-cell",
                name: "Details Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Shown with image"
              }
            ]
          }
        ]
      }
    ]
  };

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [imageScreen]
    },
    imageAssetMap: {
      "hero-image": "/images/hero.png",
      "card-media-image": "/images/card-media.png",
      "table-image-cell": "/images/table-image.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Image Screen")), "utf8");
  assert.ok(generatedScreenContent.includes('component="img" src={"/images/hero.png"} alt={"Hero Image"}'));
  assert.ok(
    generatedScreenContent.includes(
      '<CardMedia component="img" image={"/images/card-media.png"} alt={"Card Media"}'
    )
  );
  assert.ok(generatedScreenContent.includes('component="img" src={"/images/table-image.png"} alt={"Table Image"}'));
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

test("generateArtifacts wires prototype interactions from IR to deterministic route links across screens", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-prototype-navigation-"));
  const ir = figmaToDesignIr({
    name: "Prototype Navigation Integration",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-home",
              type: "FRAME",
              name: "Home",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "home-cta",
                  type: "FRAME",
                  name: "Go Settings",
                  absoluteBoundingBox: { x: 16, y: 16, width: 160, height: 48 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "screen-settings", navigation: "NAVIGATE" }]
                    }
                  ],
                  children: [
                    {
                      id: "home-cta-label",
                      type: "TEXT",
                      name: "Label",
                      characters: "Settings",
                      absoluteBoundingBox: { x: 32, y: 30, width: 100, height: 24 }
                    }
                  ]
                },
                {
                  id: "home-subtitle",
                  type: "TEXT",
                  name: "Subtitle",
                  characters: "Overview",
                  absoluteBoundingBox: { x: 16, y: 88, width: 100, height: 24 }
                }
              ]
            },
            {
              id: "screen-settings",
              type: "FRAME",
              name: "Settings",
              absoluteBoundingBox: { x: 480, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "settings-title",
                  type: "TEXT",
                  name: "Settings title",
                  characters: "Settings",
                  absoluteBoundingBox: { x: 496, y: 24, width: 120, height: 24 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const logs: string[] = [];
  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  const generatedScreenDir = path.join(projectDir, "src", "screens");
  const generatedScreenFiles = (await readdir(generatedScreenDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name);
  const generatedScreenContents = await Promise.all(
    generatedScreenFiles.map(async (fileName) => readFile(path.join(generatedScreenDir, fileName), "utf8"))
  );
  assert.ok(
    generatedScreenContents.some(
      (content) =>
        content.includes('import { Link as RouterLink } from "react-router-dom";') ||
        content.includes('import { useNavigate } from "react-router-dom";')
    )
  );
  assert.ok(
    generatedScreenContents.some(
      (content) =>
        content.includes('component={RouterLink} to={"/settings"}') ||
        content.includes('navigate("/settings")') ||
        content.includes('navigate("/settings", { replace: true })')
    )
  );

  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");
  assert.ok(appContent.includes('path="/home"'));
  assert.ok(appContent.includes('path="/settings"'));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as {
    prototypeNavigationDetected?: number;
    prototypeNavigationResolved?: number;
    prototypeNavigationUnresolved?: number;
    prototypeNavigationRendered?: number;
  };
  assert.equal(metrics.prototypeNavigationDetected, 1);
  assert.equal(metrics.prototypeNavigationResolved, 1);
  assert.equal(metrics.prototypeNavigationUnresolved, 0);
  assert.equal((metrics.prototypeNavigationRendered ?? 0) >= 1, true);
  assert.equal((result.generationMetrics.prototypeNavigationRendered ?? 0) >= 1, true);
  assert.ok(logs.some((entry) => entry.includes("Prototype navigation: detected=1, resolved=1, unresolved=0")));
});

test("generateArtifacts auto-bootstraps icon fallback map file when missing", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-bootstrap-"));
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-icon-map-root-"));
  const iconMapFilePath = path.join(outputRoot, "icon-fallback-map.json");
  const logs: string[] = [];

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-bootstrap-screen",
          name: "Icon Bootstrap Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-bootstrap-node",
              name: "icon/download",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  const mapFileContent = await readFile(iconMapFilePath, "utf8");
  const parsedMap = JSON.parse(mapFileContent) as { version?: number; entries?: unknown[] };
  assert.equal(parsedMap.version, 1);
  assert.equal(Array.isArray(parsedMap.entries), true);
  assert.ok((parsedMap.entries ?? []).length >= 200);
  assert.ok(logs.some((entry) => entry.includes("Bootstrapped icon fallback map")));

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Bootstrap Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import DownloadIcon from "@mui/icons-material/Download";'));
});

test("generateArtifacts uses custom icon fallback map file when valid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-custom-"));
  const iconMapFilePath = path.join(projectDir, "icon-map.custom.json");
  await writeFile(
    iconMapFilePath,
    `${JSON.stringify(
      {
        version: 1,
        entries: [{ iconName: "Delete", aliases: ["trash"] }],
        synonyms: {
          "remove item": "Delete"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-custom-screen",
          name: "Icon Custom Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-custom-node",
              name: "icon/trash",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Custom Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import DeleteIcon from "@mui/icons-material/Delete";'));
  assert.equal(generatedScreenContent.includes("InfoOutlinedIcon"), false);
});

test("generateArtifacts falls back to built-in icon catalog when icon map file is invalid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-invalid-"));
  const iconMapFilePath = path.join(projectDir, "icon-map.invalid.json");
  const logs: string[] = [];
  await writeFile(iconMapFilePath, `{\"version\":1,\"entries\":\"invalid\"}\n`, "utf8");

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-invalid-screen",
          name: "Icon Invalid Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-invalid-node",
              name: "icon/user",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.ok(
    logs.some((entry) => entry.toLowerCase().includes("icon fallback map") && entry.toLowerCase().includes("invalid"))
  );
  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Invalid Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import PersonIcon from "@mui/icons-material/Person";'));
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
  assert.ok(appFile.content.includes("BrowserRouter"));
  assert.ok(appFile.content.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appFile.content.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appFile.content.includes("const LazySettingsScreen = lazy"));
  assert.ok(appFile.content.includes('element={<ErrorBoundary><LazySettingsScreen /></ErrorBoundary>}'));
  assert.equal((appFile.content.match(/element={<ErrorBoundary></g) ?? []).length, 2);
});

test("createDeterministicAppFile emits BrowserRouter basename resolver by default", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]]);

  assert.ok(appFile.content.includes("resolveBrowserBasename"));
  assert.ok(appFile.content.includes('window.location.pathname.match(/^\\/workspace\\/repros\\/[^/]+/)'));
  assert.ok(appFile.content.includes("<BrowserRouter basename={browserBasename}>"));
  assert.equal(appFile.content.includes("HashRouter"), false);
});

test("createDeterministicAppFile supports hash router mode override", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]], { routerMode: "hash" });

  assert.ok(appFile.content.includes("<HashRouter>"));
  assert.ok(appFile.content.includes('import { HashRouter, Navigate, Route, Routes } from "react-router-dom";'));
  assert.equal(appFile.content.includes("BrowserRouter"), false);
  assert.equal(appFile.content.includes("resolveBrowserBasename"), false);
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

test("deterministic screen rendering derives semantic select options with locale-aware number formatting", () => {
  const screen = {
    id: "semantic-select-locale-screen",
    name: "Semantic Select Locale Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticSelectInputNode({ id: "rate-input", label: "Rate", value: "10,00 %" })]
  };

  const defaultLocaleContent = createDeterministicScreenFile(screen).content;
  assert.ok(defaultLocaleContent.includes('"9,75 %"'));
  assert.equal(defaultLocaleContent.includes('"9.75 %"'), false);

  const enUsContent = createDeterministicScreenFile(screen, { generationLocale: "en-US" }).content;
  assert.ok(enUsContent.includes('"9.75 %"'));
  assert.equal(enUsContent.includes('"9,75 %"'), false);
});

test("deterministic screen rendering derives select fallback options with locale-aware number formatting", () => {
  const screen = {
    id: "select-fallback-locale-screen",
    name: "Select Fallback Locale Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "rate-select",
        name: "Rate Select",
        nodeType: "FRAME",
        type: "select" as const,
        text: "10,00 %",
        width: 260,
        height: 56,
        children: []
      }
    ]
  };

  const defaultLocaleContent = createDeterministicScreenFile(screen).content;
  assert.ok(defaultLocaleContent.includes('"9,75 %"'));
  assert.equal(defaultLocaleContent.includes('"9.75 %"'), false);

  const enUsContent = createDeterministicScreenFile(screen, { generationLocale: "en-US" }).content;
  assert.ok(enUsContent.includes('"9.75 %"'));
  assert.equal(enUsContent.includes('"9,75 %"'), false);
});

test("generateArtifacts falls back to de-DE and logs warning for invalid generationLocale", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-locale-fallback-"));
  const logs: string[] = [];
  const ir = {
    ...createIr(),
    screens: [
      {
        id: "locale-fallback-screen",
        name: "Locale Fallback",
        layoutMode: "VERTICAL" as const,
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "fallback-rate-select",
            name: "Rate Select",
            nodeType: "FRAME",
            type: "select" as const,
            text: "10,00 %",
            width: 260,
            height: 56,
            children: []
          }
        ]
      }
    ]
  };

  await generateArtifacts({
    projectDir,
    ir,
    generationLocale: "invalid_locale",
    llmCodegenMode: "deterministic",
    llmModelName: "qwen",
    onLog: (message) => logs.push(message)
  });

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Locale Fallback"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  const generatedFormContextPath = path.join(projectDir, "src", "context", "LocaleFallbackFormContext.tsx");
  const generatedFormContextContent = await readFile(generatedFormContextPath, "utf8");
  assert.ok(generatedScreenContent.includes("useLocaleFallbackFormContext"));
  assert.ok(generatedFormContextContent.includes('"9,75 %"'));
  assert.equal(
    logs.some((entry) =>
      entry.includes("Invalid generationLocale 'invalid_locale' configured for deterministic generation")
    ),
    true
  );
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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
    assert.ok(block.includes("onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue("));
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedTextFieldBlock({ content, label: "Email" });
  assert.equal(block.includes('label={"Email *"}'), false);
  assert.ok(block.includes('label={"Email"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"email_input_required_email-helper-text"}'));
  assert.ok(block.includes('"aria-required": "true"'));
  assert.ok(block.includes("slotProps={{"));
  assert.ok(block.includes('htmlInput: { "aria-describedby": "email_input_required_email-helper-text", "aria-required": "true" }'));
  assert.ok(block.includes('formHelperText: { id: "email_input_required_email-helper-text" }'));
  assert.equal(block.includes("InputProps={{"), false);
  assert.equal(block.includes("InputLabelProps={{"), false);
  assert.equal(block.includes("FormHelperTextProps={{"), false);
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("helperText={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
});

test("deterministic screen rendering maps TextField suffix adornment via slotProps.input and avoids deprecated props", () => {
  const amountInput = createSemanticInputNode({
    id: "amount-input",
    name: "Amount Input",
    label: "Betrag"
  });
  amountInput.children.push({
    id: "amount-input-suffix",
    name: "Suffix",
    nodeType: "TEXT",
    type: "text" as const,
    text: "€",
    x: 260,
    y: 28
  });

  const screen = {
    id: "textfield-suffix-screen",
    name: "TextField Suffix Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [amountInput]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedTextFieldBlock({ content, label: "Betrag" });
  assert.ok(content.includes("InputAdornment"));
  assert.ok(block.includes("slotProps={{"));
  assert.ok(block.includes('input: { endAdornment: <InputAdornment position="end">{"€"}</InputAdornment> }'));
  assert.ok(block.includes('htmlInput: { "aria-describedby": "amount_input_amount_input-helper-text" }'));
  assert.ok(block.includes('formHelperText: { id: "amount_input_amount_input-helper-text" }'));
  assert.equal(block.includes("InputProps={{"), false);
  assert.equal(block.includes("InputLabelProps={{"), false);
  assert.equal(block.includes("FormHelperTextProps={{"), false);
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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
  assert.ok(content.includes("const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {"));
  assert.ok(content.includes('import type { FormEvent, ChangeEvent } from "react";'));
  assert.ok(content.includes('const primarySubmitButtonKey = "primary_submit_primary_submit";'));
});

test("deterministic screen rendering uses react-hook-form scaffolding by default", () => {
  const screen = {
    id: "rhf-default-screen",
    name: "RHF Default Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "rhf-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" })]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('component="form" onSubmit={handleSubmit(onSubmit)} noValidate'));
  assert.ok(content.includes('import { Controller, useForm } from "react-hook-form";'));
  assert.ok(content.includes('import { zodResolver } from "@hookform/resolvers/zod";'));
  assert.ok(content.includes('import { z } from "zod";'));
  assert.ok(content.includes("const { control, handleSubmit } = useForm({"));
  assert.ok(content.includes("<Controller"));
  assert.equal(content.includes("const [formValues, setFormValues] = useState<Record<string, string>>("), false);
  assert.equal(content.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"), false);
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
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

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedFormControlBlock({ content, label: "Status" });
  assert.equal(block.includes('label={"Status *"}'), false);
  assert.ok(block.includes('label={"Status"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"status_select_status_select-helper-text"}'));
  assert.ok(block.includes('aria-required="true"'));
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
  assert.ok(block.includes("onChange={(event: SelectChangeEvent<string>) => updateFieldValue("));
  assert.ok(block.includes('<FormHelperText id={"status_select_status_select-helper-text"}>{'));
  assert.ok(content.includes('import type { FormEvent } from "react";'));
  assert.ok(content.includes('import type { SelectChangeEvent } from "@mui/material/Select";'));
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
        id: "heading-detail",
        name: "Detail Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Detail Heading",
        fontSize: 22,
        fontWeight: 600
      },
      {
        id: "heading-minor",
        name: "Minor Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Minor Heading",
        fontSize: 20,
        fontWeight: 600
      },
      {
        id: "heading-note",
        name: "Note Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Note Heading",
        fontSize: 18,
        fontWeight: 650
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
  const h4Line = findRenderedTypographyLine({ content, text: "Detail Heading" });
  const h5Line = findRenderedTypographyLine({ content, text: "Minor Heading" });
  const h6Line = findRenderedTypographyLine({ content, text: "Note Heading" });
  const bodyLine = findRenderedTypographyLine({ content, text: "Body text" });
  assert.ok(h1Line.includes('component="h1"'));
  assert.ok(h2Line.includes('component="h2"'));
  assert.ok(h3Line.includes('component="h3"'));
  assert.ok(h4Line.includes('component="h4"'));
  assert.ok(h5Line.includes('component="h5"'));
  assert.ok(h6Line.includes('component="h6"'));
  assert.equal(bodyLine.includes('component="h'), false);
});

test("generateArtifacts renders typography variants and keeps only targeted inline typography overrides", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-typography-variants-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "typography-variant-screen",
      name: "Typography Variant Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "variant-heading",
          name: "Main Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Main Heading",
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 37,
          fontFamily: "Sparkasse Sans"
        },
        {
          id: "variant-body",
          name: "Body Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Body Copy",
          y: 48,
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          fontFamily: "Sparkasse Sans"
        },
        {
          id: "variant-caption",
          name: "Caption",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Caption Copy",
          y: 80,
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 20,
          fontFamily: "Sparkasse Sans"
        },
        {
          id: "variant-custom",
          name: "Body Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Custom Copy",
          y: 112,
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 28,
          fontFamily: "Custom Display"
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

  const content = await readFile(path.join(projectDir, toDeterministicScreenPath("Typography Variant Screen")), "utf8");
  const headingLine = findRenderedTypographyLine({ content, text: "Main Heading" });
  const bodyLine = findRenderedTypographyLine({ content, text: "Body Copy" });
  const captionLine = findRenderedTypographyLine({ content, text: "Caption Copy" });
  const customLine = findRenderedTypographyLine({ content, text: "Custom Copy" });

  assert.ok(headingLine.includes('variant="h1"'));
  assert.ok(headingLine.includes('component="h1"'));
  assert.equal(headingLine.includes("fontSize:"), false);
  assert.equal(headingLine.includes("fontWeight:"), false);
  assert.equal(headingLine.includes("lineHeight:"), false);

  assert.ok(bodyLine.includes('variant="body1"'));
  assert.equal(bodyLine.includes("fontSize:"), false);
  assert.equal(bodyLine.includes("fontWeight:"), false);
  assert.equal(bodyLine.includes("lineHeight:"), false);

  assert.ok(captionLine.includes('variant="caption"'));
  assert.equal(captionLine.includes("fontSize:"), false);

  assert.ok(customLine.includes('variant="body1"'));
  assert.ok(customLine.includes("lineHeight: \"1.75rem\""));
  assert.ok(customLine.includes('fontFamily: "Custom Display, Roboto, Arial, sans-serif"'));
});

test("deterministic screen rendering emits <img> accessibility semantics with deterministic placeholder fallback", () => {
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
  assert.ok(content.includes('<Box component="img"'));
  assert.ok(content.includes('src={"data:image/svg+xml;utf8,'));
  assert.ok(content.includes('alt={"Product Image"}'));
  assert.ok(content.includes('alt="" aria-hidden="true"'));
});

test("deterministic screen rendering maps prototype navigation on link-capable components via RouterLink", () => {
  const screen = {
    id: "nav-link-screen",
    name: "Nav Link Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "replace-button",
        name: "Open Details",
        nodeType: "FRAME",
        type: "button" as const,
        width: 180,
        height: 48,
        fillColor: "#d4001a",
        prototypeNavigation: {
          targetScreenId: "screen-details",
          mode: "replace" as const
        },
        children: [
          {
            id: "replace-button-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Details"
          }
        ]
      },
      {
        id: "overlay-chip",
        name: "Open Overlay",
        nodeType: "FRAME",
        type: "chip" as const,
        width: 120,
        height: 32,
        prototypeNavigation: {
          targetScreenId: "screen-overlay",
          mode: "overlay" as const
        },
        children: [
          {
            id: "overlay-chip-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Overlay"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, {
    routePathByScreenId: {
      "screen-details": "/details",
      "screen-overlay": "/overlay"
    }
  }).content;

  assert.ok(content.includes('import { Link as RouterLink } from "react-router-dom";'));
  assert.ok(content.includes('component={RouterLink} to={"/details"} replace'));
  assert.ok(content.includes('component={RouterLink} to={"/overlay"}'));
  assert.equal(content.includes('component={RouterLink} to={"/overlay"} replace'), false);
});

test("deterministic screen rendering maps prototype navigation on container fallback via useNavigate handler", () => {
  const screen = {
    id: "nav-container-screen",
    name: "Nav Container Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "clickable-card-shell",
        name: "Clickable Surface",
        nodeType: "FRAME",
        type: "container" as const,
        width: 280,
        height: 120,
        fillColor: "#ffffff",
        strokeColor: "#d4d4d4",
        prototypeNavigation: {
          targetScreenId: "screen-target",
          mode: "replace" as const
        },
        children: [
          {
            id: "clickable-card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Open Target"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, {
    routePathByScreenId: {
      "screen-target": "/target"
    }
  }).content;

  assert.ok(content.includes('import { useNavigate } from "react-router-dom";'));
  assert.ok(content.includes('import type { KeyboardEvent as ReactKeyboardEvent } from "react";'));
  assert.ok(content.includes("const navigate = useNavigate();"));
  assert.ok(content.includes('role="button"'));
  assert.ok(content.includes("tabIndex={0}"));
  assert.ok(content.includes('onClick={() => navigate("/target", { replace: true })}'));
  assert.ok(
    content.includes(
      'onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate("/target", { replace: true }); } }}'
    )
  );
});

test("deterministic screen rendering does not import router bindings without prototype navigation", () => {
  const content = createDeterministicScreenFile(createIr().screens[0]).content;
  assert.equal(content.includes("react-router-dom"), false);
  assert.equal(content.includes("RouterLink"), false);
  assert.equal(content.includes("useNavigate"), false);
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

test("deterministic screen rendering maps top-level container header patterns to AppBar", () => {
  const screen = {
    id: "top-level-container-appbar-screen",
    name: "Top-Level Container AppBar",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 640,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "header-container",
        name: "Primary Header",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        primaryAxisAlignItems: "SPACE_BETWEEN" as const,
        counterAxisAlignItems: "CENTER" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 72,
        fillColor: "#ee0000",
        children: [
          {
            id: "header-title",
            name: "Header Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Dashboard",
            x: 16,
            y: 24,
            fillColor: "#ffffff"
          },
          {
            id: "header-action",
            name: "Open Menu",
            nodeType: "FRAME",
            type: "button" as const,
            x: 312,
            y: 20,
            width: 32,
            height: 32,
            children: [
              {
                id: "header-action-icon",
                name: "ic_menu",
                nodeType: "INSTANCE",
                type: "container" as const,
                x: 316,
                y: 24,
                width: 24,
                height: 24,
                children: []
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('<AppBar role="banner" '));
  assert.ok(content.includes("<Toolbar>"));
  assert.ok(content.includes("<IconButton edge=\"end\""));
});

test("deterministic screen rendering maps top-level table header patterns to AppBar", () => {
  const screen = {
    id: "top-level-table-appbar-screen",
    name: "Top-Level Table AppBar",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 640,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "header-table",
        name: "Header Navigation Shell",
        nodeType: "FRAME",
        type: "table" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 88,
        fillColor: "#f5f5f5",
        children: [
          {
            id: "header-table-title",
            name: "Header Title Group",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 24,
            width: 220,
            height: 40,
            children: [
              {
                id: "header-table-title-text",
                name: "Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Kontoübersicht",
                x: 16,
                y: 32
              }
            ]
          },
          {
            id: "header-table-action",
            name: "Header Action",
            nodeType: "FRAME",
            type: "button" as const,
            x: 300,
            y: 28,
            width: 32,
            height: 32,
            children: [
              {
                id: "header-table-action-icon",
                name: "ic_settings",
                nodeType: "INSTANCE",
                type: "container" as const,
                x: 304,
                y: 32,
                width: 24,
                height: 24,
                children: []
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('<AppBar role="banner" '));
  assert.equal(content.includes("<Table size=\"small\""), false);
});

test("deterministic screen rendering maps bottom bar patterns to BottomNavigation", () => {
  const screen = {
    id: "bottom-navigation-screen",
    name: "Bottom Navigation Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 640,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "bottom-navigation-screen-title",
        name: "Screen Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Übersicht",
        x: 16,
        y: 24,
        width: 160,
        height: 24
      },
      {
        id: "bottom-nav-shell",
        name: "Primary Bottom Navigation",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        counterAxisAlignItems: "CENTER" as const,
        x: 0,
        y: 580,
        width: 360,
        height: 60,
        fillColor: "#ffffff",
        children: [
          {
            id: "bottom-nav-home",
            name: "Home Action",
            nodeType: "FRAME",
            type: "button" as const,
            x: 0,
            y: 580,
            width: 180,
            height: 60,
            children: [
              {
                id: "bottom-nav-home-icon",
                name: "ic_home",
                nodeType: "INSTANCE",
                type: "container" as const,
                x: 24,
                y: 594,
                width: 24,
                height: 24,
                children: []
              },
              {
                id: "bottom-nav-home-label",
                name: "Home Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Home",
                x: 56,
                y: 598
              }
            ]
          },
          {
            id: "bottom-nav-profile",
            name: "Profile Action",
            nodeType: "FRAME",
            type: "button" as const,
            x: 180,
            y: 580,
            width: 180,
            height: 60,
            children: [
              {
                id: "bottom-nav-profile-icon",
                name: "ic_person",
                nodeType: "INSTANCE",
                type: "container" as const,
                x: 204,
                y: 594,
                width: 24,
                height: 24,
                children: []
              },
              {
                id: "bottom-nav-profile-label",
                name: "Profile Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Profil",
                x: 236,
                y: 598
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('<BottomNavigation role="navigation" '));
  assert.equal((content.match(/<BottomNavigationAction /g) ?? []).length, 2);
});

test("deterministic screen rendering keeps top-level data tables as Table", () => {
  const screen = {
    id: "top-level-data-table-screen",
    name: "Top-Level Data Table Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 640,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "top-data-table",
        name: "Kundendaten Tabelle",
        nodeType: "FRAME",
        type: "table" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 120,
        children: [
          {
            id: "top-data-table-row-1",
            name: "Row 1",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "top-data-table-h1", name: "Name", nodeType: "TEXT", type: "text" as const, text: "Name" },
              { id: "top-data-table-h2", name: "Wert", nodeType: "TEXT", type: "text" as const, text: "Wert" }
            ]
          },
          {
            id: "top-data-table-row-2",
            name: "Row 2",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "top-data-table-c1", name: "Name 1", nodeType: "TEXT", type: "text" as const, text: "A" },
              { id: "top-data-table-c2", name: "Wert 1", nodeType: "TEXT", type: "text" as const, text: "1" }
            ]
          },
          {
            id: "top-data-table-row-3",
            name: "Row 3",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "top-data-table-c3", name: "Name 2", nodeType: "TEXT", type: "text" as const, text: "B" },
              { id: "top-data-table-c4", name: "Wert 2", nodeType: "TEXT", type: "text" as const, text: "2" }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Table size=\"small\""));
  assert.equal(content.includes('<AppBar role="banner" '), false);
});

test("deterministic screen rendering does not map single-action footer bars to BottomNavigation", () => {
  const screen = {
    id: "single-action-footer-screen",
    name: "Single Action Footer Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 640,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-footer-screen-title",
        name: "Screen Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Übersicht",
        x: 16,
        y: 24,
        width: 160,
        height: 24
      },
      {
        id: "single-footer-shell",
        name: "Footer Navigation Shell",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 580,
        width: 360,
        height: 60,
        fillColor: "#ffffff",
        children: [
          {
            id: "single-footer-action",
            name: "Footer Action",
            nodeType: "FRAME",
            type: "button" as const,
            x: 0,
            y: 580,
            width: 180,
            height: 60,
            children: [
              {
                id: "single-footer-action-label",
                name: "Action Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Home",
                x: 16,
                y: 598
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<BottomNavigation "), false);
  assert.ok(content.includes("<Button "));
});

test("deterministic screen rendering maps top-level tab interface patterns to Tabs with interactive state and tab panels", () => {
  const screen = {
    id: "tab-pattern-screen",
    name: "Tab Pattern Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "tab-host",
        name: "Main Content Tabs Host",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 160,
        width: 390,
        height: 360,
        children: [
          {
            id: "tab-strip",
            name: "Main Tabs",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 16,
            y: 160,
            width: 358,
            height: 48,
            children: [
              {
                id: "tab-overview",
                name: "Overview Tab",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Übersicht",
                x: 20,
                y: 175,
                fillColor: "#101010",
                fontWeight: 700
              },
              {
                id: "tab-activity",
                name: "Activity Tab",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Aktivität",
                x: 138,
                y: 175,
                fillColor: "#6b7280",
                fontWeight: 500
              },
              {
                id: "tab-settings",
                name: "Settings Tab",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Einstellungen",
                x: 256,
                y: 175,
                fillColor: "#6b7280",
                fontWeight: 500
              }
            ]
          },
          {
            id: "tab-panel-1",
            name: "Panel Overview",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 224,
            width: 358,
            height: 72,
            children: [{ id: "tab-panel-1-text", name: "Panel Text 1", nodeType: "TEXT", type: "text" as const, text: "Kontostand" }]
          },
          {
            id: "tab-panel-2",
            name: "Panel Activity",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 304,
            width: 358,
            height: 72,
            children: [{ id: "tab-panel-2-text", name: "Panel Text 2", nodeType: "TEXT", type: "text" as const, text: "Letzte Buchungen" }]
          },
          {
            id: "tab-panel-3",
            name: "Panel Settings",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 384,
            width: 358,
            height: 72,
            children: [{ id: "tab-panel-3-text", name: "Panel Text 3", nodeType: "TEXT", type: "text" as const, text: "Benachrichtigungen" }]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Tabs value={tabValue1} onChange={handleTabChange1}"));
  assert.ok(content.includes("const [tabValue1, setTabValue1] = useState<number>(0);"));
  assert.ok(content.includes("const handleTabChange1 = (_event: SyntheticEvent, newValue: number): void => {"));
  assert.ok(content.includes('import type { SyntheticEvent } from "react";'));
  assert.equal((content.match(/role=\"tabpanel\"/g) ?? []).length, 3);
});

test("deterministic screen rendering maps top-level table tab patterns to Tabs", () => {
  const screen = {
    id: "table-tab-pattern-screen",
    name: "Table Tab Pattern Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "table-tab-host",
        name: "Account Tabs Table",
        nodeType: "FRAME",
        type: "table" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 120,
        width: 390,
        height: 320,
        children: [
          {
            id: "table-tab-strip",
            name: "Tab Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 16,
            y: 120,
            width: 358,
            height: 48,
            children: [
              {
                id: "table-tab-a",
                name: "Tab A",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Konten",
                x: 24,
                y: 136,
                fillColor: "#1f2937",
                fontWeight: 700
              },
              {
                id: "table-tab-b",
                name: "Tab B",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Karten",
                x: 152,
                y: 136,
                fillColor: "#6b7280",
                fontWeight: 500
              }
            ]
          },
          {
            id: "table-tab-panel-a",
            name: "Panel A",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 184,
            width: 358,
            height: 72,
            children: [{ id: "table-tab-panel-a-text", name: "A", nodeType: "TEXT", type: "text" as const, text: "Kontoinhalte" }]
          },
          {
            id: "table-tab-panel-b",
            name: "Panel B",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 264,
            width: 358,
            height: 72,
            children: [{ id: "table-tab-panel-b-text", name: "B", nodeType: "TEXT", type: "text" as const, text: "Karteninhalte" }]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Tabs value={tabValue1} onChange={handleTabChange1}"));
  assert.equal(content.includes("<Table size=\"small\""), false);
});

test("deterministic screen rendering maps top-level overlay modal patterns to Dialog with state and actions", () => {
  const screen = {
    id: "dialog-pattern-screen",
    name: "Dialog Pattern Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "overlay-shell",
        name: "Modal Overlay",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        opacity: 0.72,
        fillColor: "#121212",
        children: [
          {
            id: "dialog-panel",
            name: "Dialog Panel",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "VERTICAL" as const,
            x: 45,
            y: 210,
            width: 300,
            height: 320,
            fillColor: "#ffffff",
            elevation: 12,
            children: [
              {
                id: "dialog-close",
                name: "Close Button",
                nodeType: "FRAME",
                type: "button" as const,
                x: 310,
                y: 226,
                width: 24,
                height: 24,
                children: [{ id: "dialog-close-icon", name: "ic_close", nodeType: "INSTANCE", type: "container" as const, width: 16, height: 16 }]
              },
              {
                id: "dialog-title-text",
                name: "Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Überweisung bestätigen",
                x: 69,
                y: 250,
                fillColor: "#111827",
                fontWeight: 700
              },
              {
                id: "dialog-body-text",
                name: "Body",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Möchten Sie die Zahlung jetzt ausführen?",
                x: 69,
                y: 292,
                fillColor: "#374151"
              },
              {
                id: "dialog-action-row",
                name: "Action Row",
                nodeType: "FRAME",
                type: "container" as const,
                layoutMode: "HORIZONTAL" as const,
                x: 73,
                y: 468,
                width: 244,
                height: 40,
                children: [
                  {
                    id: "dialog-action-cancel",
                    name: "Cancel Action",
                    nodeType: "FRAME",
                    type: "button" as const,
                    x: 73,
                    y: 468,
                    width: 112,
                    height: 40,
                    children: [{ id: "dialog-action-cancel-label", name: "Cancel Label", nodeType: "TEXT", type: "text" as const, text: "Abbrechen" }]
                  },
                  {
                    id: "dialog-action-confirm",
                    name: "Confirm Action",
                    nodeType: "FRAME",
                    type: "button" as const,
                    x: 205,
                    y: 468,
                    width: 112,
                    height: 40,
                    children: [{ id: "dialog-action-confirm-label", name: "Confirm Label", nodeType: "TEXT", type: "text" as const, text: "Bestätigen" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Dialog open={isDialogOpen1} onClose={handleDialogClose1}"));
  assert.ok(content.includes("const [isDialogOpen1, setIsDialogOpen1] = useState<boolean>(true);"));
  assert.ok(content.includes("const handleDialogClose1 = (): void => {"));
  assert.ok(content.includes("<DialogActions>"));
  assert.ok(content.includes("onClick={handleDialogClose1}"));
});

test("deterministic screen rendering keeps pre-dispatch dialog pattern precedence over table type strategy", () => {
  const screen = {
    id: "dialog-pattern-table-precedence-screen",
    name: "Dialog Pattern Table Precedence Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "overlay-shell-table",
        name: "Modal Overlay Table",
        nodeType: "FRAME",
        type: "table" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        opacity: 0.72,
        fillColor: "#121212",
        children: [
          {
            id: "dialog-table-panel",
            name: "Dialog Panel",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "VERTICAL" as const,
            x: 45,
            y: 210,
            width: 300,
            height: 320,
            fillColor: "#ffffff",
            elevation: 12,
            children: [
              {
                id: "dialog-table-close",
                name: "Close Button",
                nodeType: "FRAME",
                type: "button" as const,
                x: 310,
                y: 226,
                width: 24,
                height: 24,
                children: [
                  {
                    id: "dialog-table-close-icon",
                    name: "ic_close",
                    nodeType: "INSTANCE",
                    type: "container" as const,
                    width: 16,
                    height: 16
                  }
                ]
              },
              {
                id: "dialog-table-title",
                name: "Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Überweisung bestätigen",
                x: 69,
                y: 250,
                fillColor: "#111827",
                fontWeight: 700
              },
              {
                id: "dialog-table-body",
                name: "Body",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Möchten Sie die Zahlung jetzt ausführen?",
                x: 69,
                y: 292,
                fillColor: "#374151"
              },
              {
                id: "dialog-table-action-row",
                name: "Action Row",
                nodeType: "FRAME",
                type: "container" as const,
                layoutMode: "HORIZONTAL" as const,
                x: 73,
                y: 468,
                width: 244,
                height: 40,
                children: [
                  {
                    id: "dialog-table-action-cancel",
                    name: "Cancel Action",
                    nodeType: "FRAME",
                    type: "button" as const,
                    x: 73,
                    y: 468,
                    width: 112,
                    height: 40,
                    children: [
                      {
                        id: "dialog-table-action-cancel-label",
                        name: "Cancel Label",
                        nodeType: "TEXT",
                        type: "text" as const,
                        text: "Abbrechen"
                      }
                    ]
                  },
                  {
                    id: "dialog-table-action-confirm",
                    name: "Confirm Action",
                    nodeType: "FRAME",
                    type: "button" as const,
                    x: 205,
                    y: 468,
                    width: 112,
                    height: 40,
                    children: [
                      {
                        id: "dialog-table-action-confirm-label",
                        name: "Confirm Label",
                        nodeType: "TEXT",
                        type: "text" as const,
                        text: "Bestätigen"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Dialog open={isDialogOpen1} onClose={handleDialogClose1}"));
  assert.equal(content.includes("<Table size=\"small\""), false);
});

test("deterministic screen rendering keeps top-level data table patterns as Table instead of Tabs", () => {
  const screen = {
    id: "tab-regression-data-table-screen",
    name: "Tab Regression Data Table Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "tab-regression-data-table",
        name: "Umsatzliste",
        nodeType: "FRAME",
        type: "table" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 96,
        width: 390,
        height: 220,
        children: [
          {
            id: "tab-regression-row-1",
            name: "Header Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "tab-regression-h1", name: "Date Header", nodeType: "TEXT", type: "text" as const, text: "Datum", fontWeight: 700 },
              { id: "tab-regression-h2", name: "Amount Header", nodeType: "TEXT", type: "text" as const, text: "Betrag", fontWeight: 700 }
            ]
          },
          {
            id: "tab-regression-row-2",
            name: "Row 1",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "tab-regression-c1", name: "Date Cell", nodeType: "TEXT", type: "text" as const, text: "01.03.2026" },
              { id: "tab-regression-c2", name: "Amount Cell", nodeType: "TEXT", type: "text" as const, text: "100,00 €" }
            ]
          },
          {
            id: "tab-regression-row-3",
            name: "Row 2",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              { id: "tab-regression-c3", name: "Date Cell 2", nodeType: "TEXT", type: "text" as const, text: "02.03.2026" },
              { id: "tab-regression-c4", name: "Amount Cell 2", nodeType: "TEXT", type: "text" as const, text: "250,00 €" }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<Table size=\"small\""));
  assert.equal(content.includes("<Tabs "), false);
});

test("deterministic screen rendering keeps non-overlay centered panels as generic containers and not Dialog", () => {
  const screen = {
    id: "dialog-regression-non-overlay-screen",
    name: "Dialog Regression Non Overlay Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "plain-page-shell",
        name: "Content Shell",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        fillColor: "#f8fafc",
        children: [
          {
            id: "plain-centered-panel",
            name: "Centered Panel",
            nodeType: "FRAME",
            type: "container" as const,
            x: 35,
            y: 220,
            width: 320,
            height: 260,
            fillColor: "#ffffff",
            elevation: 8,
            children: [{ id: "plain-centered-panel-text", name: "Panel Text", nodeType: "TEXT", type: "text" as const, text: "Kein Dialog Overlay" }]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<Dialog "), false);
  assert.ok(content.includes("<Box "));
});

test("deterministic screen rendering does not promote nested tab or dialog-like patterns below top-level depth", () => {
  const screen = {
    id: "nested-pattern-regression-screen",
    name: "Nested Pattern Regression Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "nested-wrapper",
        name: "Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 0,
        width: 390,
        height: 844,
        children: [
          {
            id: "nested-tab-host",
            name: "Nested Tabs Host",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "VERTICAL" as const,
            x: 16,
            y: 160,
            width: 358,
            height: 260,
            children: [
              {
                id: "nested-tab-strip",
                name: "Nested Tabs",
                nodeType: "FRAME",
                type: "container" as const,
                layoutMode: "HORIZONTAL" as const,
                x: 16,
                y: 160,
                width: 358,
                height: 48,
                children: [
                  { id: "nested-tab-a", name: "Nested Tab A", nodeType: "TEXT", type: "text" as const, text: "A", x: 24, y: 176, fontWeight: 700 },
                  { id: "nested-tab-b", name: "Nested Tab B", nodeType: "TEXT", type: "text" as const, text: "B", x: 96, y: 176, fontWeight: 500 }
                ]
              },
              {
                id: "nested-tab-panel-a",
                name: "Nested Panel A",
                nodeType: "FRAME",
                type: "container" as const,
                x: 16,
                y: 224,
                width: 358,
                height: 72,
                children: [{ id: "nested-tab-panel-a-text", name: "Nested A", nodeType: "TEXT", type: "text" as const, text: "Panel A" }]
              },
              {
                id: "nested-tab-panel-b",
                name: "Nested Panel B",
                nodeType: "FRAME",
                type: "container" as const,
                x: 16,
                y: 304,
                width: 358,
                height: 72,
                children: [{ id: "nested-tab-panel-b-text", name: "Nested B", nodeType: "TEXT", type: "text" as const, text: "Panel B" }]
              }
            ]
          },
          {
            id: "nested-overlay-shell",
            name: "Nested Overlay",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "NONE" as const,
            x: 16,
            y: 460,
            width: 358,
            height: 300,
            opacity: 0.7,
            fillColor: "#111111",
            children: [
              {
                id: "nested-dialog-panel",
                name: "Nested Dialog Panel",
                nodeType: "FRAME",
                type: "container" as const,
                x: 48,
                y: 500,
                width: 280,
                height: 180,
                fillColor: "#ffffff",
                elevation: 8,
                children: [{ id: "nested-dialog-title", name: "Nested Dialog Title", nodeType: "TEXT", type: "text" as const, text: "Nicht top-level" }]
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<Tabs value={tabValue"), false);
  assert.equal(content.includes("<Dialog open={isDialogOpen"), false);
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

test("deterministic screen rendering keeps input container strategy precedence over paper-like signals", () => {
  const screen = {
    id: "input-paper-precedence-screen",
    name: "Input Paper Precedence",
    layoutMode: "NONE" as const,
    gap: 0,
    fillColor: "#ffffff",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "input-paper-conflict-container",
        name: "Account Number Input",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 72,
        fillColor: "#f8fafc",
        strokeColor: "#d1d5db",
        strokeWidth: 1,
        cornerRadius: 12,
        children: [
          {
            id: "input-paper-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Kontonummer",
            x: 16,
            y: 12,
            fillColor: "#6b7280",
            fontSize: 12
          },
          {
            id: "input-paper-value",
            name: "Value",
            nodeType: "TEXT",
            type: "text" as const,
            text: "DE89 3704 0044 0532 0130 00",
            x: 16,
            y: 38,
            fillColor: "#111827",
            fontSize: 16
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<TextField"));
  assert.equal(content.includes("<Paper "), false);
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

test("deterministic screen rendering keeps repeated-list strategy precedence over simple-flex stack signals", () => {
  const makeRow = ({ id, y, title }: { id: string; y: number; title: string }) => ({
    id,
    name: `Row ${id}`,
    nodeType: "FRAME",
    type: "container" as const,
    layoutMode: "HORIZONTAL" as const,
    x: 0,
    y,
    width: 328,
    height: 48,
    children: [
      {
        id: `${id}-icon`,
        name: "ic_search",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 8,
        y: y + 14,
        width: 20,
        height: 20,
        children: []
      },
      {
        id: `${id}-title`,
        name: `${id}-title`,
        nodeType: "TEXT",
        type: "text" as const,
        text: title,
        x: 44,
        y: y + 8
      },
      {
        id: `${id}-subtitle`,
        name: `${id}-subtitle`,
        nodeType: "TEXT",
        type: "text" as const,
        text: `${title} Details`,
        x: 44,
        y: y + 26
      },
      {
        id: `${id}-action`,
        name: `${id}-action`,
        nodeType: "FRAME",
        type: "button" as const,
        x: 300,
        y: y + 12,
        width: 24,
        height: 24,
        children: [
          {
            id: `${id}-action-icon`,
            name: "ic_more_vert",
            nodeType: "INSTANCE",
            type: "container" as const,
            x: 302,
            y: y + 14,
            width: 20,
            height: 20,
            children: []
          }
        ]
      }
    ]
  });

  const screen = {
    id: "list-stack-precedence-screen",
    name: "List Stack Precedence",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "list-stack-precedence-container",
        name: "Pattern Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 0,
        width: 336,
        height: 176,
        gap: 8,
        children: [
          makeRow({ id: "row-a", y: 0, title: "Eintrag A" }),
          makeRow({ id: "row-b", y: 56, title: "Eintrag B" }),
          makeRow({ id: "row-c", y: 112, title: "Eintrag C" })
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<List "));
  assert.equal(content.includes('<Stack direction="column"'), false);
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

  assert.equal(countOccurrences(iconLine, "width:"), 1);
  assert.equal(countOccurrences(iconLine, "height:"), 1);
  assert.equal(countOccurrences(iconLine, "display:"), 1);
  assert.equal(countOccurrences(iconLine, "alignItems:"), 1);
  assert.equal(countOccurrences(iconLine, "justifyContent:"), 1);
  assert.equal(countOccurrences(iconLine, "fontSize:"), 1);
});

test("deterministic screen rendering extracts repeated sx patterns into shared constants when occurrences reach threshold", () => {
  const makeVariantButton = (id: string) => ({
    id,
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
        id: `${id}-text`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Weiter"
      }
    ]
  });

  const screen = {
    id: "shared-sx-threshold-screen",
    name: "Shared SX Threshold Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [makeVariantButton("variant-button-1"), makeVariantButton("variant-button-2"), makeVariantButton("variant-button-3")]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("const sharedSxStyle1 = {"));
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
  assert.equal(countOccurrences(content, '"&:hover": {'), 1);
  assert.equal(countOccurrences(content, "sx={{ position: \"absolute\""), 0);

  const muiImportIndex = content.indexOf('from "@mui/material";');
  const sharedConstIndex = content.indexOf("const sharedSxStyle1 = {");
  const exportIndex = content.indexOf("export default function");
  assert.ok(muiImportIndex >= 0);
  assert.ok(sharedConstIndex > muiImportIndex);
  assert.ok(exportIndex > sharedConstIndex);
});

test("deterministic screen rendering keeps inline sx when repeated style count is below threshold", () => {
  const makeIconNode = (id: string) => ({
    id,
    name: "ic_info_hint",
    nodeType: "INSTANCE",
    type: "container" as const,
    x: 10,
    y: 20,
    width: 24,
    height: 24,
    children: []
  });
  const screen = {
    id: "shared-sx-below-threshold-screen",
    name: "Shared SX Below Threshold Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [makeIconNode("icon-one"), makeIconNode("icon-two")]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconLines = content.split("\n").filter((line) => line.includes("<InfoOutlinedIcon"));
  assert.equal(content.includes("const sharedSxStyle1 = {"), false);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle"), 0);
  assert.equal(iconLines.length, 2);
  assert.equal(iconLines.every((line) => line.includes("sx={{")), true);
});

test("deterministic screen rendering assigns shared sx constants deterministically for multiple repeated style groups", () => {
  const makeIconNode = ({ id, x, y, size }: { id: string; x: number; y: number; size: number }) => ({
    id,
    name: "ic_info_hint",
    nodeType: "INSTANCE",
    type: "container" as const,
    x,
    y,
    width: size,
    height: size,
    children: []
  });
  const screen = {
    id: "shared-sx-multi-group-screen",
    name: "Shared SX Multi Group Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      makeIconNode({ id: "icon-a-1", x: 10, y: 20, size: 24 }),
      makeIconNode({ id: "icon-a-2", x: 10, y: 20, size: 24 }),
      makeIconNode({ id: "icon-a-3", x: 10, y: 20, size: 24 }),
      makeIconNode({ id: "icon-b-1", x: 40, y: 50, size: 32 }),
      makeIconNode({ id: "icon-b-2", x: 40, y: 50, size: 32 }),
      makeIconNode({ id: "icon-b-3", x: 40, y: 50, size: 32 })
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const styleOneIndex = content.indexOf("const sharedSxStyle1 = {");
  const styleTwoIndex = content.indexOf("const sharedSxStyle2 = {");
  assert.ok(styleOneIndex >= 0);
  assert.ok(styleTwoIndex > styleOneIndex);
  assert.match(content, /const sharedSxStyle1 = \{[^}]*left: "0px"[^}]*width: "24px"[^}]*height: "24px"[^}]*\};/);
  assert.match(content, /const sharedSxStyle2 = \{[^}]*left: "30px"[^}]*width: "32px"[^}]*height: "32px"[^}]*\};/);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle2}"), 3);
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

test("deterministic screen rendering supports icon library names like icon/search", () => {
  const screen = {
    id: "icon-library-screen",
    name: "Icon Library Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "library-search-icon",
        name: "icon/search",
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
  assert.ok(content.includes('import SearchIcon from "@mui/icons-material/Search";'));
  assert.ok(content.includes("<SearchIcon"));
});

test("deterministic screen rendering applies synonym mapping for user and trash hints", () => {
  const screen = {
    id: "synonym-icon-screen",
    name: "Synonym Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "synonym-user-icon",
        name: "icon/user",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        children: []
      },
      {
        id: "synonym-trash-icon",
        name: "icon/trash",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 24,
        y: 0,
        width: 20,
        height: 20,
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const iconImportLines = extractMuiIconImportLines(content);
  assert.deepEqual(iconImportLines, [
    'import DeleteIcon from "@mui/icons-material/Delete";',
    'import PersonIcon from "@mui/icons-material/Person";'
  ]);
});

test("deterministic screen rendering applies bounded fuzzy matching for icon names", () => {
  const screen = {
    id: "fuzzy-icon-screen",
    name: "Fuzzy Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "fuzzy-search-icon",
        name: "icon/serch",
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
  assert.ok(content.includes('import SearchIcon from "@mui/icons-material/Search";'));
  assert.ok(content.includes("<SearchIcon"));
});

test("deterministic screen rendering falls back to InfoOutlinedIcon for unknown icon names", () => {
  const screen = {
    id: "unknown-icon-screen",
    name: "Unknown Icon Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "unknown-icon",
        name: "icon/not-a-real-icon-name",
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
  assert.ok(content.includes('import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";'));
  assert.ok(content.includes("<InfoOutlinedIcon"));
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

test("createDeterministicThemeFile emits custom breakpoints when responsive variants differ from MUI defaults", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "responsive-theme-screen",
      name: "Responsive Theme Screen",
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
        ]
      },
      children: []
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  assert.ok(themeContent.includes("breakpoints: {"));
  assert.ok(themeContent.includes("values: { xs: 0, sm: 579, md: 834, lg: 1118, xl: 1436 }"));
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
  assert.equal(content.includes("@media ("), false);
  assert.ok(content.includes('maxWidth: { xs: "390px", sm: "768px", md: "none", lg: "1336px", xl: "none" }'));
  assert.ok(content.includes("gap: { xs: 1, sm: 2, md: 3 }"));
  assert.ok(content.includes('maxWidth: "600px"'));
  assert.ok(content.includes('flexDirection: { xs: "column", sm: "row" }'));
  assert.ok(content.includes('width: { xs: "100%", sm: "75%", md: "44.9%" }'));
  assert.ok(content.includes('minHeight: { xs: "120px", sm: "56px" }'));
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
  assert.ok(content.includes("p: 2"));
  assert.equal(content.includes("pt: 2"), false);
  assert.equal(content.includes("pr: 2"), false);
  assert.equal(content.includes("pb: 2"), false);
  assert.equal(content.includes("pl: 2"), false);
  assert.ok(content.includes('fontSize: "0.875rem"'));
  assert.ok(content.includes('lineHeight: "1.25rem"'));
  assert.ok(content.includes('fontSize: "1rem"'));
  assert.ok(content.includes('lineHeight: "1.5rem"'));
  assert.equal(/\b(gap|p|px|py|p[trbl]|m|mx|my|m[trbl]|fontSize|lineHeight):\s*"[0-9.]+px"/.test(content), false);
});

test("deterministic screen rendering converts text letterSpacing from px to em with stable precision", () => {
  const screen = {
    id: "letter-spacing-screen",
    name: "Letter Spacing Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "text-positive-letter-spacing",
        name: "Positive Letter Spacing",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Positive",
        fontSize: 12,
        lineHeight: 18,
        letterSpacing: 1
      },
      {
        id: "text-negative-letter-spacing",
        name: "Negative Letter Spacing",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Negative",
        y: 28,
        fontSize: 20,
        lineHeight: 24,
        letterSpacing: -0.5
      }
    ]
  };

  const first = createDeterministicScreenFile(screen).content;
  const second = createDeterministicScreenFile(screen).content;

  assert.equal(first, second);
  assert.ok(first.includes('letterSpacing: "0.0833em"'));
  assert.ok(first.includes('letterSpacing: "-0.025em"'));
});

test("deterministic screen rendering applies padding shorthand for equal and paired sides", () => {
  const screen = {
    id: "padding-shorthand-screen",
    name: "Padding Shorthand Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "padding-all-equal",
        name: "Padding All Equal",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 80,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        children: []
      },
      {
        id: "padding-axis-equal",
        name: "Padding Axis Equal",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 100,
        width: 220,
        height: 80,
        padding: { top: 4, right: 12, bottom: 4, left: 12 },
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("p: 2.5"));
  assert.ok(content.includes("py: 0.5"));
  assert.ok(content.includes("px: 1.5"));
  assert.equal(content.includes("pt: 2.5"), false);
  assert.equal(content.includes("pr: 1.5"), false);
});

test("deterministic screen rendering applies margin shorthand when explicit IR margin is present", () => {
  const screen = {
    id: "margin-shorthand-screen",
    name: "Margin Shorthand Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "margin-all-equal",
        name: "Margin All Equal",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 80,
        margin: { top: 16, right: 16, bottom: 16, left: 16 },
        children: []
      },
      {
        id: "margin-axis-equal",
        name: "Margin Axis Equal",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 100,
        width: 220,
        height: 80,
        margin: { top: 8, right: 24, bottom: 8, left: 24 },
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("m: 2"));
  assert.ok(content.includes("my: 1"));
  assert.ok(content.includes("mx: 3"));
  assert.equal(content.includes("mt: 2"), false);
  assert.equal(content.includes("mr: 3"), false);
});

test("deterministic screen rendering keeps fallback side-specific spacing entries for mixed values", () => {
  const screen = {
    id: "spacing-fallback-sides-screen",
    name: "Spacing Fallback Sides Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "padding-side-specific",
        name: "Padding Side Specific",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 80,
        padding: { top: 4, right: 8, bottom: 12, left: 16 },
        children: []
      },
      {
        id: "margin-side-specific",
        name: "Margin Side Specific",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 100,
        width: 220,
        height: 80,
        margin: { top: 8, right: 12, bottom: 16, left: 20 },
        children: []
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("pt: 0.5"));
  assert.ok(content.includes("pr: 1"));
  assert.ok(content.includes("pb: 1.5"));
  assert.ok(content.includes("pl: 2"));
  assert.ok(content.includes("mt: 1"));
  assert.ok(content.includes("mr: 1.5"));
  assert.ok(content.includes("mb: 2"));
  assert.ok(content.includes("ml: 2.5"));
});

test("generateArtifacts maps borderRadius to theme shape scale in sx", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-token-radius-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "token-radius-screen",
      name: "Token Radius Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "token-radius-surface",
          name: "Token Radius Surface",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 280,
          height: 120,
          cornerRadius: 12,
          children: []
        },
        {
          id: "token-radius-input",
          name: "Styled(div)",
          nodeType: "FRAME",
          type: "input" as const,
          x: 0,
          y: 140,
          width: 320,
          height: 72,
          cornerRadius: 6,
          children: [
            {
              id: "token-radius-input-label",
              name: "MuiTypographyRoot",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Monatliche Sparrate"
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

  const content = await readFile(path.join(projectDir, toDeterministicScreenPath("Token Radius Screen")), "utf8");
  assert.ok(content.includes("borderRadius: 1"));
  assert.ok(content.includes("borderRadius: 0.5"));
  assert.equal(content.includes('borderRadius: "12px"'), false);
  assert.equal(content.includes('borderRadius: "6px"'), false);
});

test("deterministic screen rendering keeps px borderRadius fallback when tokens are unavailable", () => {
  const screen = {
    id: "tokenless-radius-screen",
    name: "Tokenless Radius Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "tokenless-radius-surface",
        name: "Tokenless Radius Surface",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 280,
        height: 120,
        cornerRadius: 12,
        children: []
      },
      {
        id: "tokenless-radius-input",
        name: "Styled(div)",
        nodeType: "FRAME",
        type: "input" as const,
        x: 0,
        y: 140,
        width: 320,
        height: 72,
        cornerRadius: 6,
        children: [
          {
            id: "tokenless-radius-input-label",
            name: "MuiTypographyRoot",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Monatliche Sparrate"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('borderRadius: "12px"'));
  assert.ok(content.includes('borderRadius: "6px"'));
});

test("deterministic screen rendering removes only theme-default-equal component sx values", () => {
  const screen = {
    id: "theme-dedupe-screen",
    name: "Theme Dedupe Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "dedupe-card-default",
        name: "Default Card",
        nodeType: "FRAME",
        type: "card" as const,
        x: 0,
        y: 0,
        width: 280,
        height: 140,
        cornerRadius: 12,
        elevation: 4,
        children: [{ id: "dedupe-card-default-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Default Card" }]
      },
      {
        id: "dedupe-card-custom",
        name: "Custom Card",
        nodeType: "FRAME",
        type: "card" as const,
        x: 0,
        y: 160,
        width: 280,
        height: 140,
        cornerRadius: 18,
        elevation: 6,
        children: [{ id: "dedupe-card-custom-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Custom Card" }]
      },
      {
        id: "dedupe-paper-default",
        name: "Default Paper",
        nodeType: "FRAME",
        type: "paper" as const,
        x: 0,
        y: 320,
        width: 280,
        height: 96,
        elevation: 2,
        children: [{ id: "dedupe-paper-default-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Default Paper" }]
      },
      {
        id: "dedupe-paper-custom",
        name: "Custom Paper",
        nodeType: "FRAME",
        type: "paper" as const,
        x: 0,
        y: 436,
        width: 280,
        height: 96,
        elevation: 5,
        children: [{ id: "dedupe-paper-custom-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Custom Paper" }]
      },
      {
        id: "dedupe-input-default",
        name: "Styled(div)",
        nodeType: "FRAME",
        type: "input" as const,
        x: 0,
        y: 552,
        width: 280,
        height: 56,
        cornerRadius: 8,
        children: [{ id: "dedupe-input-default-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Default Field" }]
      },
      {
        id: "dedupe-input-custom",
        name: "Styled(div)",
        nodeType: "FRAME",
        type: "input" as const,
        x: 0,
        y: 628,
        width: 280,
        height: 56,
        cornerRadius: 12,
        children: [{ id: "dedupe-input-custom-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Custom Field" }]
      },
      {
        id: "dedupe-chip-default",
        name: "Default Chip",
        nodeType: "FRAME",
        type: "chip" as const,
        x: 0,
        y: 704,
        width: 120,
        height: 24,
        cornerRadius: 8,
        children: [{ id: "dedupe-chip-default-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Default Chip" }]
      },
      {
        id: "dedupe-chip-custom",
        name: "Custom Chip",
        nodeType: "FRAME",
        type: "chip" as const,
        x: 0,
        y: 744,
        width: 140,
        height: 32,
        cornerRadius: 12,
        children: [{ id: "dedupe-chip-custom-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Custom Chip" }]
      },
      {
        id: "dedupe-appbar-default",
        name: "Default AppBar",
        nodeType: "FRAME",
        type: "appbar" as const,
        x: 0,
        y: 792,
        width: 320,
        height: 64,
        fillColor: "#123456",
        children: [{ id: "dedupe-appbar-default-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Default Bar" }]
      },
      {
        id: "dedupe-appbar-custom",
        name: "Custom AppBar",
        nodeType: "FRAME",
        type: "appbar" as const,
        x: 0,
        y: 872,
        width: 320,
        height: 64,
        fillColor: "#654321",
        children: [{ id: "dedupe-appbar-custom-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Custom Bar" }]
      },
      {
        id: "dedupe-divider-default",
        name: "Default Divider",
        nodeType: "RECTANGLE",
        type: "divider" as const,
        x: 0,
        y: 956,
        width: 280,
        height: 1,
        fillColor: "#d4d4d4"
      },
      {
        id: "dedupe-divider-custom",
        name: "Custom Divider",
        nodeType: "RECTANGLE",
        type: "divider" as const,
        x: 0,
        y: 976,
        width: 280,
        height: 1,
        fillColor: "#999999"
      },
      {
        id: "dedupe-avatar-default",
        name: "Avatar",
        nodeType: "FRAME",
        type: "avatar" as const,
        x: 0,
        y: 996,
        width: 40,
        height: 40,
        cornerRadius: 20,
        children: [{ id: "dedupe-avatar-default-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "AB" }]
      },
      {
        id: "dedupe-avatar-custom",
        name: "Avatar",
        nodeType: "FRAME",
        type: "avatar" as const,
        x: 0,
        y: 1052,
        width: 48,
        height: 48,
        cornerRadius: 24,
        children: [{ id: "dedupe-avatar-custom-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "CD" }]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, {
    themeComponentDefaults: {
      MuiCard: { borderRadiusPx: 12, elevation: 4 },
      MuiTextField: { outlinedInputBorderRadiusPx: 8 },
      MuiChip: { borderRadiusPx: 8, size: "small" },
      MuiPaper: { elevation: 2 },
      MuiAppBar: { backgroundColor: "#123456" },
      MuiDivider: { borderColor: "#d4d4d4" },
      MuiAvatar: { widthPx: 40, heightPx: 40, borderRadiusPx: 20 }
    }
  }).content;

  assert.equal(content.includes("<Card elevation={4}"), false);
  assert.ok(content.includes("<Card elevation={6}"));
  assert.equal(content.includes("boxShadow: 4"), false);
  assert.ok(content.includes('borderRadius: "18px"'));

  assert.equal(content.includes("<Paper elevation={2}"), false);
  assert.ok(content.includes("<Paper elevation={5}"));
  assert.equal(content.includes("boxShadow: 2"), false);

  const defaultInputBlock = findRenderedTextFieldBlock({ content, label: "Default Field" });
  const customInputBlock = findRenderedTextFieldBlock({ content, label: "Custom Field" });
  assert.equal(defaultInputBlock.includes("& .MuiOutlinedInput-root"), false);
  assert.ok(customInputBlock.includes("& .MuiOutlinedInput-root"));
  assert.ok(customInputBlock.includes('borderRadius: "12px"'));

  const defaultChipLine = content
    .split("\n")
    .find((entry) => entry.includes("<Chip ") && entry.includes('label={"Default Chip"}'));
  const customChipLine = content
    .split("\n")
    .find((entry) => entry.includes("<Chip ") && entry.includes('label={"Custom Chip"}'));
  assert.ok(defaultChipLine);
  assert.ok(customChipLine);
  assert.equal(defaultChipLine?.includes('size="small"'), false);
  assert.equal(defaultChipLine?.includes('borderRadius: "8px"'), false);
  assert.ok(customChipLine?.includes('borderRadius: "12px"'));

  assert.equal(content.includes('bgcolor: "#123456"'), false);
  assert.ok(content.includes('bgcolor: "#654321"'));
  assert.equal(content.includes('borderColor: "#d4d4d4"'), false);
  assert.ok(content.includes('borderColor: "#999999"'));

  const defaultAvatarLine = content
    .split("\n")
    .find((entry) => entry.includes("<Avatar ") && entry.includes('{"AB"}'));
  const customAvatarLine = content
    .split("\n")
    .find((entry) => entry.includes("<Avatar ") && entry.includes('{"CD"}'));
  assert.ok(defaultAvatarLine);
  assert.ok(customAvatarLine);
  assert.equal(defaultAvatarLine?.includes('width: "40px"'), false);
  assert.equal(defaultAvatarLine?.includes('minHeight: "40px"'), false);
  assert.equal(defaultAvatarLine?.includes('borderRadius: "20px"'), false);
  assert.ok(customAvatarLine?.includes('width: "48px"'));
  assert.ok(customAvatarLine?.includes('minHeight: "48px"'));
  assert.ok(customAvatarLine?.includes('borderRadius: "24px"'));
});

test("deterministic screen rendering removes only exact C1-equal visual sx keys", () => {
  const screen = {
    id: "theme-c1-dedupe-screen",
    name: "Theme C1 Dedupe Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "c1-dedupe-button-default-a",
        name: "Default Action A",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 220,
        height: 48,
        fillColor: "#1357AA",
        children: [{ id: "c1-dedupe-button-default-a-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Default A" }]
      },
      {
        id: "c1-dedupe-button-default-b",
        name: "Default Action B",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 64,
        width: 220,
        height: 48,
        fillColor: "#1357aa",
        children: [{ id: "c1-dedupe-button-default-b-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Default B" }]
      },
      {
        id: "c1-dedupe-button-custom",
        name: "Custom Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 128,
        width: 220,
        height: 48,
        fillColor: "#226699",
        children: [{ id: "c1-dedupe-button-custom-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Custom" }]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, {
    themeComponentDefaults: {
      c1StyleOverrides: {
        MuiButton: {
          backgroundColor: "#1357aa"
        }
      }
    }
  }).content;

  const defaultALine = findRenderedButtonLine({ content, label: "Default A" });
  const defaultBLine = findRenderedButtonLine({ content, label: "Default B" });
  const customLine = findRenderedButtonLine({ content, label: "Custom" });
  assert.equal(defaultALine.includes('bgcolor: "#1357AA"'), false);
  assert.equal(defaultALine.includes('bgcolor: "#1357aa"'), false);
  assert.equal(defaultBLine.includes('bgcolor: "#1357aa"'), false);
  assert.ok(customLine.includes('bgcolor: "#226699"'));
  assert.ok(defaultALine.includes('width: "220px"'));
  assert.ok(defaultBLine.includes('width: "220px"'));
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
        },
        {
          id: "token-success",
          name: "Success Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Success",
          x: 0,
          y: 210,
          fillColor: "#16a34a"
        },
        {
          id: "token-warning",
          name: "Warning Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Warning",
          x: 0,
          y: 240,
          fillColor: "#d97706"
        },
        {
          id: "token-error",
          name: "Error Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Error",
          x: 0,
          y: 270,
          fillColor: "#dc2626"
        },
        {
          id: "token-info",
          name: "Info Copy",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Info",
          x: 0,
          y: 300,
          fillColor: "#0288d1"
        },
        {
          id: "token-divider",
          name: "Divider Token",
          nodeType: "RECTANGLE",
          type: "divider" as const,
          x: 0,
          y: 330,
          width: 240,
          height: 1,
          fillColor: "#2222221f"
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
  assert.ok(content.includes('color: "success.main"'));
  assert.ok(content.includes('color: "warning.main"'));
  assert.ok(content.includes('color: "error.main"'));
  assert.ok(content.includes('color: "info.main"'));
  assert.equal(content.includes('borderColor: "divider"'), false);
  const tokenButtonLine = findRenderedButtonLine({ content, label: "Continue" });
  assert.ok(tokenButtonLine.includes('variant="contained" size="large"'));
  assert.equal(tokenButtonLine.includes('bgcolor: "primary.main"'), false);
});

test("generateArtifacts writes semantic palette fields to theme and tokens files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-semantic-theme-"));
  const ir = createIr();

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const themeContent = await readFile(path.join(projectDir, "src/theme/theme.ts"), "utf8");
  const appContent = await readFile(path.join(projectDir, "src/App.tsx"), "utf8");
  const tokensContent = JSON.parse(await readFile(path.join(projectDir, "src/theme/tokens.json"), "utf8")) as {
    palette: {
      success: string;
      warning: string;
      error: string;
      info: string;
      divider: string;
      action: {
        focus: string;
      };
    };
    typography: {
      h1: {
        fontSizePx: number;
      };
      body1: {
        fontSizePx: number;
      };
      overline: {
        letterSpacingEm?: number;
      };
      button: {
        textTransform?: string;
      };
    };
  };

  assert.ok(themeContent.includes("colorSchemes: {"));
  assert.ok(themeContent.includes("light: {"));
  assert.ok(themeContent.includes("dark: {"));
  assert.ok(themeContent.includes('success: { main: "#16a34a" }'));
  assert.ok(themeContent.includes('warning: { main: "#d97706" }'));
  assert.ok(themeContent.includes('error: { main: "#dc2626" }'));
  assert.ok(themeContent.includes('info: { main: "#0288d1" }'));
  assert.ok(themeContent.includes('divider: "#2222221f"'));
  assert.ok(themeContent.includes('disabledBackground: "#2222221f"'));
  assert.ok(themeContent.includes('background: { default: "#121212", paper: "#1e1e1e" }'));
  assert.ok(themeContent.includes('text: { primary: "#f5f7fb" }'));
  assert.ok(themeContent.includes('divider: "#f5f7fb1f"'));
  assert.ok(themeContent.includes("subtitle1: {"));
  assert.ok(themeContent.includes("button: {"));
  assert.ok(themeContent.includes("caption: {"));
  assert.ok(themeContent.includes('letterSpacing: "0.08em"'));
  assert.ok(appContent.includes('data-testid="theme-mode-toggle"'));
  assert.ok(appContent.includes('useColorScheme'));
  assert.ok(appContent.includes('Switch to dark mode'));
  assert.equal(tokensContent.palette.success, "#16a34a");
  assert.equal(tokensContent.palette.warning, "#d97706");
  assert.equal(tokensContent.palette.error, "#dc2626");
  assert.equal(tokensContent.palette.info, "#0288d1");
  assert.equal(tokensContent.palette.divider, "#2222221f");
  assert.equal(tokensContent.palette.action.focus, "#ee00001f");
  assert.equal(tokensContent.typography.h1.fontSizePx, 28);
  assert.equal(tokensContent.typography.body1.fontSizePx, 16);
  assert.equal(tokensContent.typography.button.textTransform, "none");
  assert.equal(tokensContent.typography.overline.letterSpacingEm, 0.08);
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

test("deterministic screen rendering promotes repeating row patterns to semantic list with secondaryAction and divider", () => {
  const makeRow = ({ id, y, title, subtitle, iconName }: { id: string; y: number; title: string; subtitle: string; iconName: string }) => ({
    id,
    name: `Row ${id}`,
    nodeType: "FRAME",
    type: "container" as const,
    layoutMode: "HORIZONTAL" as const,
    x: 0,
    y,
    width: 328,
    height: 48,
    children: [
      {
        id: `${id}-icon`,
        name: iconName,
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 8,
        y: y + 14,
        width: 20,
        height: 20,
        children: []
      },
      {
        id: `${id}-title`,
        name: `${id}-title`,
        nodeType: "TEXT",
        type: "text" as const,
        text: title,
        x: 44,
        y: y + 8
      },
      {
        id: `${id}-subtitle`,
        name: `${id}-subtitle`,
        nodeType: "TEXT",
        type: "text" as const,
        text: subtitle,
        x: 44,
        y: y + 26
      },
      {
        id: `${id}-action`,
        name: `${id}-action`,
        nodeType: "FRAME",
        type: "button" as const,
        x: 300,
        y: y + 12,
        width: 24,
        height: 24,
        children: [
          {
            id: `${id}-action-icon`,
            name: "ic_more_vert",
            nodeType: "INSTANCE",
            type: "container" as const,
            x: 302,
            y: y + 14,
            width: 20,
            height: 20,
            children: []
          }
        ]
      }
    ]
  });

  const screen = {
    id: "list-pattern-screen",
    name: "List Pattern Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "list-pattern-container",
        name: "Pattern Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 336,
        height: 176,
        children: [
          makeRow({ id: "row-a", y: 0, title: "Eintrag A", subtitle: "Beschreibung A", iconName: "ic_search" }),
          {
            id: "row-divider-a",
            name: "Divider",
            nodeType: "RECTANGLE",
            type: "divider" as const,
            x: 0,
            y: 52,
            width: 336,
            height: 1,
            fillColor: "#d4d4d4",
            children: []
          },
          makeRow({ id: "row-b", y: 56, title: "Eintrag B", subtitle: "Beschreibung B", iconName: "ic_add" }),
          {
            id: "row-divider-b",
            name: "Divider",
            nodeType: "RECTANGLE",
            type: "divider" as const,
            x: 0,
            y: 108,
            width: 336,
            height: 1,
            fillColor: "#d4d4d4",
            children: []
          },
          makeRow({ id: "row-c", y: 112, title: "Eintrag C", subtitle: "Beschreibung C", iconName: "ic_home" })
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<List "));
  assert.ok(content.includes("<ListItemIcon>"));
  assert.ok(content.includes('secondaryAction={<IconButton edge="end"'));
  assert.ok(content.includes('secondary={"Beschreibung A"}'));
  assert.ok(content.includes('<Divider component="li" />'));
  assert.equal((content.match(/<ListItem key=\{/g) ?? []).length, 3);
});

test("deterministic screen rendering keeps mixed dispatch output byte-stable across repeated generation runs", () => {
  const screen = {
    id: "mixed-dispatch-stability-screen",
    name: "Mixed Dispatch Stability",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 390,
    height: 844,
    fillColor: "#ffffff",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "mixed-dispatch-header",
        name: "Top Header",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 0,
        width: 390,
        height: 64,
        fillColor: "#ee0000",
        children: [
          {
            id: "mixed-dispatch-header-title",
            name: "Header Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Dashboard",
            x: 16,
            y: 20,
            fillColor: "#ffffff"
          },
          {
            id: "mixed-dispatch-header-action",
            name: "Open Menu",
            nodeType: "FRAME",
            type: "button" as const,
            x: 334,
            y: 16,
            width: 40,
            height: 32,
            children: []
          }
        ]
      },
      {
        id: "mixed-dispatch-tabs-host",
        name: "Main Content Tabs Host",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 120,
        width: 390,
        height: 280,
        children: [
          {
            id: "mixed-dispatch-tab-strip",
            name: "Main Tabs",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 16,
            y: 120,
            width: 358,
            height: 48,
            children: [
              {
                id: "mixed-dispatch-tab-overview",
                name: "Overview Tab",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Übersicht",
                x: 20,
                y: 136,
                fillColor: "#101010",
                fontWeight: 700
              },
              {
                id: "mixed-dispatch-tab-activity",
                name: "Activity Tab",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Aktivität",
                x: 138,
                y: 136,
                fillColor: "#6b7280",
                fontWeight: 500
              }
            ]
          },
          {
            id: "mixed-dispatch-tab-panel-a",
            name: "Panel A",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 184,
            width: 358,
            height: 72,
            children: [
              {
                id: "mixed-dispatch-tab-panel-a-text",
                name: "Panel A Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Kontostand"
              }
            ]
          },
          {
            id: "mixed-dispatch-tab-panel-b",
            name: "Panel B",
            nodeType: "FRAME",
            type: "container" as const,
            x: 16,
            y: 264,
            width: 358,
            height: 72,
            children: [
              {
                id: "mixed-dispatch-tab-panel-b-text",
                name: "Panel B Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Letzte Buchungen"
              }
            ]
          }
        ]
      },
      {
        id: "mixed-dispatch-input",
        name: "Konto Input",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 16,
        y: 460,
        width: 358,
        height: 72,
        fillColor: "#f8fafc",
        strokeColor: "#d1d5db",
        strokeWidth: 1,
        cornerRadius: 12,
        children: [
          {
            id: "mixed-dispatch-input-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Kontonummer",
            x: 28,
            y: 472,
            fillColor: "#6b7280",
            fontSize: 12
          },
          {
            id: "mixed-dispatch-input-value",
            name: "Value",
            nodeType: "TEXT",
            type: "text" as const,
            text: "DE89 3704 0044 0532 0130 00",
            x: 28,
            y: 498,
            fillColor: "#111827",
            fontSize: 16
          }
        ]
      }
    ]
  };

  const first = createDeterministicScreenFile(screen).content;
  const second = createDeterministicScreenFile(screen).content;
  assert.equal(first, second);
  assert.ok(first.includes("<Tabs "));
  assert.ok(first.includes("<TextField"));
});

test("createDeterministicScreenFile keeps repeated card patterns inline without extraction artifacts", () => {
  const mixedScreen = createMixedFallbackStageIr().screens[0]!;
  const content = createDeterministicScreenFile(mixedScreen).content;

  assert.ok(content.includes("<Card"));
  assert.equal(content.includes('from "../components/'), false);
  assert.equal(content.includes("PatternContextProvider"), false);
  assert.equal(content.includes("patternContextInitialState"), false);
});

test("deterministic screen rendering renders ListItemAvatar when repeating rows have avatars", () => {
  const makeAvatarRow = ({ id, y, initials, label }: { id: string; y: number; initials: string; label: string }) => ({
    id,
    name: `Avatar ${id}`,
    nodeType: "FRAME",
    type: "container" as const,
    layoutMode: "HORIZONTAL" as const,
    x: 0,
    y,
    width: 320,
    height: 44,
    children: [
      {
        id: `${id}-avatar`,
        name: "Avatar",
        nodeType: "FRAME",
        type: "avatar" as const,
        x: 8,
        y: y + 8,
        width: 28,
        height: 28,
        children: [
          {
            id: `${id}-avatar-text`,
            name: "Avatar Text",
            nodeType: "TEXT",
            type: "text" as const,
            text: initials,
            x: 14,
            y: y + 14
          }
        ]
      },
      {
        id: `${id}-label`,
        name: `${id}-label`,
        nodeType: "TEXT",
        type: "text" as const,
        text: label,
        x: 50,
        y: y + 14
      }
    ]
  });

  const screen = {
    id: "list-avatar-pattern-screen",
    name: "List Avatar Pattern",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "list-avatar-container",
        name: "List Avatar Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 152,
        children: [
          makeAvatarRow({ id: "avatar-row-a", y: 0, initials: "AB", label: "Anna Becker" }),
          makeAvatarRow({ id: "avatar-row-b", y: 52, initials: "CD", label: "Clara Damm" }),
          makeAvatarRow({ id: "avatar-row-c", y: 104, initials: "EF", label: "Emil Funk" })
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("<List "));
  assert.ok(content.includes("<ListItemAvatar><Avatar>"));
  assert.ok(content.includes('primary={"Anna Becker"}'));
  assert.ok(content.includes('{\"AB\"}'));
});

test("deterministic screen rendering keeps stack fallback when list pattern has only two rows", () => {
  const makeRow = ({ id, y, label }: { id: string; y: number; label: string }) => ({
    id,
    name: `Compact ${id}`,
    nodeType: "FRAME",
    type: "container" as const,
    layoutMode: "HORIZONTAL" as const,
    x: 0,
    y,
    width: 300,
    height: 42,
    children: [
      {
        id: `${id}-icon`,
        name: "ic_search",
        nodeType: "INSTANCE",
        type: "container" as const,
        x: 8,
        y: y + 10,
        width: 20,
        height: 20,
        children: []
      },
      {
        id: `${id}-label`,
        name: `${id}-label`,
        nodeType: "TEXT",
        type: "text" as const,
        text: label,
        x: 44,
        y: y + 12
      },
      {
        id: `${id}-action`,
        name: "icon-action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 272,
        y: y + 8,
        width: 20,
        height: 20,
        children: []
      }
    ]
  });

  const screen = {
    id: "list-regression-two-rows-screen",
    name: "List Regression Two Rows",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "list-regression-two-rows-container",
        name: "Rows Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 300,
        height: 100,
        children: [makeRow({ id: "row-1", y: 0, label: "Erster Punkt" }), makeRow({ id: "row-2", y: 52, label: "Zweiter Punkt" })]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<List "), false);
  assert.ok(content.includes("<Stack "));
});

test("deterministic screen rendering keeps stack fallback when repeating rows have inconsistent structure", () => {
  const screen = {
    id: "list-regression-structure-screen",
    name: "List Regression Structure",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "list-regression-structure-container",
        name: "Rows Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 168,
        children: [
          {
            id: "reg-row-a",
            name: "Row A",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 0,
            y: 0,
            width: 320,
            height: 48,
            children: [
              { id: "reg-row-a-icon", name: "ic_search", nodeType: "INSTANCE", type: "container" as const, x: 8, y: 14, width: 20, height: 20, children: [] },
              { id: "reg-row-a-text", name: "A", nodeType: "TEXT", type: "text" as const, text: "Eintrag A", x: 44, y: 16 },
              { id: "reg-row-a-action", name: "icon-action", nodeType: "FRAME", type: "button" as const, x: 292, y: 12, width: 20, height: 20, children: [] }
            ]
          },
          {
            id: "reg-row-b",
            name: "Row B",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 0,
            y: 56,
            width: 320,
            height: 48,
            children: [
              { id: "reg-row-b-icon", name: "ic_add", nodeType: "INSTANCE", type: "container" as const, x: 8, y: 70, width: 20, height: 20, children: [] },
              { id: "reg-row-b-text", name: "B", nodeType: "TEXT", type: "text" as const, text: "Eintrag B", x: 44, y: 72 },
              { id: "reg-row-b-action", name: "icon-action", nodeType: "FRAME", type: "button" as const, x: 292, y: 68, width: 20, height: 20, children: [] }
            ]
          },
          {
            id: "reg-row-c",
            name: "Row C",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            x: 0,
            y: 112,
            width: 320,
            height: 48,
            children: [
              { id: "reg-row-c-icon", name: "ic_home", nodeType: "INSTANCE", type: "container" as const, x: 8, y: 126, width: 20, height: 20, children: [] },
              { id: "reg-row-c-text", name: "C", nodeType: "TEXT", type: "text" as const, text: "Eintrag C", x: 44, y: 128 }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("<List "), false);
  assert.ok(content.includes("<Stack "));
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
