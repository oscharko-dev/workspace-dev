import assert from "node:assert/strict";
import test from "node:test";
import type { DesignTokens, ScreenIR } from "./types.js";
import {
  createDefaultLayoutReportFile,
  createDefaultTailwindScreenFile,
  solveDefaultScreenLayout,
} from "./types.js";

const tokens = {
  palette: {
    primary: "#0055cc",
    secondary: "#00aa55",
    background: "#ffffff",
    text: "#101828",
    success: "#16a34a",
    warning: "#d97706",
    error: "#dc2626",
    info: "#0288d1",
    divider: "#1018281f",
    action: {
      active: "#1018288a",
      hover: "#0055cc0a",
      selected: "#0055cc14",
      disabled: "#10182842",
      disabledBackground: "#1018281f",
      focus: "#0055cc1f",
    },
  },
  borderRadius: 12,
  spacingBase: 8,
  fontFamily: "Inter",
  headingSize: 32,
  bodySize: 16,
  typography: {
    h1: { fontSizePx: 32, fontWeight: 700, lineHeightPx: 40 },
    h2: { fontSizePx: 28, fontWeight: 700, lineHeightPx: 36 },
    h3: { fontSizePx: 24, fontWeight: 600, lineHeightPx: 32 },
    h4: { fontSizePx: 20, fontWeight: 600, lineHeightPx: 28 },
    h5: { fontSizePx: 18, fontWeight: 600, lineHeightPx: 26 },
    h6: { fontSizePx: 16, fontWeight: 600, lineHeightPx: 24 },
    subtitle1: { fontSizePx: 16, fontWeight: 500, lineHeightPx: 24 },
    subtitle2: { fontSizePx: 14, fontWeight: 500, lineHeightPx: 22 },
    body1: { fontSizePx: 16, fontWeight: 400, lineHeightPx: 24 },
    body2: { fontSizePx: 14, fontWeight: 400, lineHeightPx: 22 },
    button: { fontSizePx: 14, fontWeight: 600, lineHeightPx: 20 },
    caption: { fontSizePx: 12, fontWeight: 400, lineHeightPx: 16 },
    overline: { fontSizePx: 12, fontWeight: 600, lineHeightPx: 16, textTransform: "uppercase" },
  },
} satisfies DesignTokens;

const createAutoLayoutScreen = (): ScreenIR => ({
  id: "screen-dashboard",
  name: "Dashboard",
  layoutMode: "VERTICAL",
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "CENTER",
  gap: 24,
  width: 1200,
  height: 800,
  fillColor: tokens.palette.background,
  padding: { top: 32, right: 48, bottom: 32, left: 48 },
  children: [
    {
      id: "hero",
      name: "Hero",
      nodeType: "FRAME",
      type: "container",
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      gap: 16,
      width: 1104,
      height: 128,
      fillColor: "#f8fafc",
      cornerRadius: 16,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      children: [
        {
          id: "title",
          name: "Heading",
          nodeType: "TEXT",
          type: "text",
          text: "Operations",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 40,
          fillColor: tokens.palette.text,
        },
      ],
    },
  ],
});

test("default layout solver maps Auto Layout to stable Tailwind flex utilities", () => {
  const layout = solveDefaultScreenLayout(createAutoLayoutScreen());
  const hero = layout.children[0];

  assert.ok(layout.className.includes("flex flex-col"));
  assert.ok(layout.className.includes("items-center"));
  assert.ok(layout.className.includes("gap-[24px]"));
  assert.equal(hero?.kind, "flex");
  assert.ok(hero?.className.includes("flex-row"));
  assert.ok(hero?.className.includes("justify-between"));
  assert.ok(hero?.className.includes("w-full"));
  assert.ok(hero?.className.includes("max-w-[1104px]"));
  assert.deepEqual(layout.warnings, []);
});

test("default Tailwind emitter renders typed TSX without MUI or sx props", () => {
  const result = createDefaultTailwindScreenFile(createAutoLayoutScreen());

  assert.equal(result.file.path, "src/pages/dashboard.tsx");
  assert.match(result.file.content, /export default function Dashboard\(\)/);
  assert.match(result.file.content, /<main className="[^"]*min-h-screen/);
  assert.match(result.file.content, /<header data-ir-id="hero"/);
  assert.match(result.file.content, /className="[^"]*flex-row/);
  assert.match(result.file.content, /<h1 data-ir-id="title"/);
  assert.doesNotMatch(result.file.content, /@mui|sx=\{\{|<Box|<Typography/);
});

test("default layout solver maps Figma stretch constraints to responsive container classes", () => {
  const screen: ScreenIR = {
    id: "screen-responsive",
    name: "Responsive",
    layoutMode: "VERTICAL",
    gap: 12,
    width: 1200,
    height: 720,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    children: [
      {
        id: "constrained-panel",
        name: "Constrained Panel",
        nodeType: "FRAME",
        type: "container",
        layoutMode: "VERTICAL",
        constraints: {
          horizontal: "LEFT_RIGHT",
          vertical: "TOP",
        },
        layoutAlign: "STRETCH",
        layoutGrow: 1,
        width: 720,
        height: 180,
        children: [],
      },
    ],
  };

  const panel = solveDefaultScreenLayout(screen).children[0];

  assert.equal(panel?.kind, "flex");
  assert.ok(panel?.className.includes("w-full"));
  assert.ok(panel?.className.includes("max-w-[720px]"));
  assert.ok(panel?.className.includes("self-stretch"));
  assert.ok(panel?.className.includes("flex-1"));
});

test("default layout solver maps repeated absolute grids to CSS grid utilities", () => {
  const screen: ScreenIR = {
    id: "screen-grid",
    name: "Metrics",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 960,
    height: 720,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    children: [
      {
        id: "metric-grid",
        name: "Metric Grid",
        nodeType: "FRAME",
        type: "grid",
        layoutMode: "NONE",
        width: 912,
        height: 300,
        children: [
          { id: "a", name: "A", nodeType: "FRAME", type: "card", x: 0, y: 0, width: 200, height: 120 },
          { id: "b", name: "B", nodeType: "FRAME", type: "card", x: 216, y: 0, width: 200, height: 120 },
          { id: "c", name: "C", nodeType: "FRAME", type: "card", x: 0, y: 136, width: 200, height: 120 },
          { id: "d", name: "D", nodeType: "FRAME", type: "card", x: 216, y: 136, width: 200, height: 120 },
        ],
      },
    ],
  };

  const grid = solveDefaultScreenLayout(screen).children[0];
  const result = createDefaultTailwindScreenFile(screen);

  assert.equal(grid?.kind, "grid");
  assert.ok(grid?.className.includes("grid-cols-2"));
  assert.ok(grid?.className.includes("gap-[16px]"));
  assert.equal(grid?.children.every((child) => child.kind !== "absolute"), true);
  assert.doesNotMatch(result.file.content, /data-ir-id="metric-grid"[\s\S]*className="absolute/);
});

test("default layout report captures absolute fallback warnings for ambiguous structures", () => {
  const screen: ScreenIR = {
    id: "screen-absolute",
    name: "Ambiguous",
    layoutMode: "NONE",
    gap: 0,
    width: 640,
    height: 480,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "floating-card",
        name: "Floating Card",
        nodeType: "FRAME",
        type: "container",
        x: 37,
        y: 91,
        width: 220,
        height: 80,
      },
    ],
  };

  const layout = solveDefaultScreenLayout(screen);
  const report = JSON.parse(createDefaultLayoutReportFile([screen]).content) as {
    pipelineId?: string;
    warnings?: Array<{ code: string; nodeId: string }>;
  };

  assert.equal(layout.children[0]?.kind, "absolute");
  assert.equal(layout.warnings[0]?.code, "W_ABSOLUTE_LAYOUT_FALLBACK");
  assert.equal(report.pipelineId, "default");
  assert.deepEqual(report.warnings, [
    {
      code: "W_ABSOLUTE_LAYOUT_FALLBACK",
      nodeId: "floating-card",
      nodeName: "Floating Card",
      message: "Absolute layout fallback used for 'Floating Card' because no deterministic flex or grid structure could be inferred.",
    },
  ]);
});
