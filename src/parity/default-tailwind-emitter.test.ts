import assert from "node:assert/strict";
import test from "node:test";
import type { DesignTokens, ScreenIR } from "./types.js";
import {
  createDefaultLayoutReportFile,
  createDefaultSemanticComponentReportFile,
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

const createProductCard = ({
  id,
  title,
  description,
  action,
  x,
}: {
  id: string;
  title: string;
  description: string;
  action: string;
  x: number;
}): ScreenIR["children"][number] => ({
  id,
  name: "Plan Card",
  nodeType: "FRAME",
  type: "card",
  semanticType: "Card",
  semanticSource: "heuristic",
  layoutMode: "VERTICAL",
  gap: 12,
  x,
  y: 96,
  width: 280,
  height: 220,
  fillColor: "#ffffff",
  strokeColor: "#d0d5dd",
  cornerRadius: 12,
  padding: { top: 20, right: 20, bottom: 20, left: 20 },
  children: [
    {
      id: `${id}-title`,
      name: "Title",
      nodeType: "TEXT",
      type: "text",
      text: title,
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 32,
      fillColor: tokens.palette.text,
    },
    {
      id: `${id}-description`,
      name: "Description",
      nodeType: "TEXT",
      type: "text",
      text: description,
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 22,
      fillColor: "#475467",
    },
    {
      id: `${id}-action`,
      name: "Choose Plan Button",
      nodeType: "FRAME",
      type: "button",
      layoutMode: "HORIZONTAL",
      width: 160,
      height: 44,
      fillColor: tokens.palette.primary,
      cornerRadius: 8,
      children: [
        {
          id: `${id}-action-label`,
          name: "Action Label",
          nodeType: "TEXT",
          type: "text",
          text: action,
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 20,
          fillColor: "#ffffff",
        },
      ],
    },
  ],
});

test("default semantic synthesis extracts reusable typed React components with deterministic props", () => {
  const screen: ScreenIR = {
    id: "pricing-screen",
    name: "Pricing",
    layoutMode: "VERTICAL",
    gap: 24,
    width: 960,
    height: 720,
    padding: { top: 40, right: 48, bottom: 40, left: 48 },
    children: [
      {
        id: "pricing-nav",
        name: "Primary Navigation",
        nodeType: "FRAME",
        type: "navigation",
        semanticType: "navigation",
        layoutMode: "HORIZONTAL",
        gap: 16,
        width: 864,
        height: 48,
        children: [
          {
            id: "pricing-nav-label",
            name: "Navigation Label",
            nodeType: "TEXT",
            type: "text",
            text: "Pricing",
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 24,
          },
        ],
      },
      {
        id: "plans",
        name: "Plan List",
        nodeType: "FRAME",
        type: "list",
        layoutMode: "HORIZONTAL",
        gap: 24,
        width: 864,
        height: 260,
        children: [
          createProductCard({
            id: "basic-plan",
            title: "Basic",
            description: "For small teams",
            action: "Start basic",
            x: 0,
          }),
          createProductCard({
            id: "pro-plan",
            title: "Pro",
            description: "For growing teams",
            action: "Start pro",
            x: 304,
          }),
        ],
      },
    ],
  };

  const result = createDefaultTailwindScreenFile(screen);
  const component = result.componentFiles.find((file) => file.path === "src/components/PlanCard.tsx");

  assert.ok(component, "expected reusable PlanCard component file");
  assert.deepEqual(result.semanticComponents, [
    {
      componentName: "PlanCard",
      filePath: "src/components/PlanCard.tsx",
      kind: "card",
      instanceNodeIds: ["basic-plan", "pro-plan"],
      propNames: ["title", "description", "actionLabel"],
    },
  ]);
  assert.match(result.file.content, /import PlanCard from "\.\.\/components\/PlanCard";/);
  assert.match(result.file.content, /<nav data-ir-id="pricing-nav"[^>]*aria-label="Pricing"/);
  assert.match(
    result.file.content,
    /<PlanCard title=\{"Basic"\} description=\{"For small teams"\} actionLabel=\{"Start basic"\} irId=\{"basic-plan"\} irName=\{"Plan Card"\}[^>]*actionLabelIrId=\{"basic-plan-action-label"\}[^>]*\/>/,
  );
  assert.match(
    result.file.content,
    /<PlanCard title=\{"Pro"\} description=\{"For growing teams"\} actionLabel=\{"Start pro"\} irId=\{"pro-plan"\} irName=\{"Plan Card"\}[^>]*actionLabelIrId=\{"pro-plan-action-label"\}[^>]*\/>/,
  );
  assert.match(component.content, /interface PlanCardProps \{\n  irId: string;\n  irName: string;\n  titleIrId: string;\n  titleIrName: string;\n  descriptionIrId: string;\n  descriptionIrName: string;\n  choosePlanButtonIrId: string;\n  choosePlanButtonIrName: string;\n  actionLabelIrId: string;\n  actionLabelIrName: string;\n  title: string;\n  description: string;\n  actionLabel: string;\n\}/);
  assert.match(component.content, /<article data-ir-id=\{props\.irId\} data-ir-name=\{props\.irName\}/);
  assert.match(component.content, /<button data-ir-id=\{props\.choosePlanButtonIrId\} data-ir-name=\{props\.choosePlanButtonIrName\}[^>]*type="button"/);
  assert.doesNotMatch(component.content, /<button[\s\S]*<p data-ir-id=\{props\.actionLabelIrId\}/);
  assert.match(component.content, /<span data-ir-id=\{props\.actionLabelIrId\} data-ir-name=\{props\.actionLabelIrName\}[^>]*>\{props\.actionLabel\}<\/span>/);
  assert.match(component.content, /<h1 data-ir-id=\{props\.titleIrId\} data-ir-name=\{props\.titleIrName\}[^>]*>\{props\.title\}<\/h1>/);
  assert.match(component.content, /<p data-ir-id=\{props\.descriptionIrId\} data-ir-name=\{props\.descriptionIrName\}[^>]*>\{props\.description\}<\/p>/);
  assert.doesNotMatch(component.content, /data-ir-id="basic-plan-/);
  assert.doesNotMatch(component.content, /@mui|sx=\{\{|<Box|<Typography/);
});

test("default semantic synthesis skips extraction when repeated structures differ beyond typed text props", () => {
  const screen: ScreenIR = {
    id: "pricing-screen",
    name: "Pricing",
    layoutMode: "VERTICAL",
    gap: 24,
    width: 960,
    height: 720,
    children: [
      {
        id: "plans",
        name: "Plan List",
        nodeType: "FRAME",
        type: "list",
        layoutMode: "HORIZONTAL",
        gap: 24,
        width: 864,
        height: 260,
        children: [
          createProductCard({
            id: "basic-plan",
            title: "Basic",
            description: "For small teams",
            action: "Start basic",
            x: 0,
          }),
          {
            ...createProductCard({
              id: "pro-plan",
              title: "Pro",
              description: "For growing teams",
              action: "Start pro",
              x: 304,
            }),
            fillColor: "#000000",
          },
        ],
      },
    ],
  };

  const result = createDefaultTailwindScreenFile(screen);

  assert.equal(result.semanticComponents.some((component) => component.componentName === "PlanCard"), false);
  assert.match(result.file.content, /data-ir-id="basic-plan"[^>]*bg-\[#ffffff\]/);
  assert.match(result.file.content, /data-ir-id="pro-plan"[^>]*bg-\[#000000\]/);
  assert.deepEqual(
    result.semanticDiagnostics
      .filter((diagnostic) => diagnostic.code === "W_SEMANTIC_COMPONENT_NOT_REUSABLE")
      .map((diagnostic) => diagnostic.nodeId)
      .sort(),
    ["basic-plan", "plans", "pro-plan"],
  );
});

test("default semantic synthesis honors semanticType hints on generic containers", () => {
  const screen: ScreenIR = {
    id: "semantic-hints",
    name: "Semantic Hints",
    layoutMode: "VERTICAL",
    gap: 20,
    width: 720,
    height: 480,
    children: [
      {
        ...createProductCard({
          id: "basic-plan",
          title: "Basic",
          description: "For small teams",
          action: "Start basic",
          x: 0,
        }),
        type: "container",
        semanticType: "Card",
      },
      {
        ...createProductCard({
          id: "pro-plan",
          title: "Pro",
          description: "For growing teams",
          action: "Start pro",
          x: 304,
        }),
        type: "container",
        semanticType: "Card",
      },
    ],
  };

  const result = createDefaultTailwindScreenFile(screen);

  assert.deepEqual(result.semanticComponents.map((component) => component.componentName), ["PlanCard"]);
  assert.match(result.file.content, /<PlanCard title=\{"Basic"\}/);
  assert.match(result.componentFiles[0]?.content ?? "", /<article data-ir-id=\{props\.irId\}/);
});

test("default semantic synthesis deduplicates descendant traceability prop names", () => {
  const createStatCard = ({
    id,
    label,
    value,
  }: {
    id: string;
    label: string;
    value: string;
  }): ScreenIR["children"][number] => ({
    id,
    name: "Stat Card",
    nodeType: "FRAME",
    type: "card",
    semanticType: "Card",
    layoutMode: "VERTICAL",
    gap: 8,
    width: 220,
    height: 120,
    fillColor: "#ffffff",
    children: [
      {
        id: `${id}-label-1`,
        name: "Label",
        nodeType: "TEXT",
        type: "text",
        text: label,
        fontSize: 14,
      },
      {
        id: `${id}-label-2`,
        name: "Label",
        nodeType: "TEXT",
        type: "text",
        text: value,
        fontSize: 24,
        fontWeight: 700,
      },
    ],
  });
  const screen: ScreenIR = {
    id: "stats-screen",
    name: "Stats",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 720,
    height: 480,
    children: [
      createStatCard({
        id: "revenue-card",
        label: "Revenue",
        value: "$10k",
      }),
      createStatCard({
        id: "margin-card",
        label: "Margin",
        value: "42%",
      }),
    ],
  };

  const result = createDefaultTailwindScreenFile(screen);
  const component = result.componentFiles.find((file) => file.path === "src/components/StatCard.tsx");

  assert.ok(component, "expected reusable StatCard component file");
  assert.match(component.content, /labelIrId: string;\n  labelIrName: string;\n  label2IrId: string;\n  label2IrName: string;/);
  assert.match(component.content, /data-ir-id=\{props\.labelIrId\}/);
  assert.match(component.content, /data-ir-id=\{props\.label2IrId\}/);
  assert.match(result.file.content, /labelIrId=\{"revenue-card-label-1"\} labelIrName=\{"Label"\} label2IrId=\{"revenue-card-label-2"\} label2IrName=\{"Label"\}/);
  assert.match(result.file.content, /labelIrId=\{"margin-card-label-1"\} labelIrName=\{"Label"\} label2IrId=\{"margin-card-label-2"\} label2IrName=\{"Label"\}/);
  assert.doesNotMatch(component.content, /labelIrId: string;[\s\S]*labelIrId: string;/);
});

test("default semantic synthesis prevents text and traceability prop collisions", () => {
  const createTraceCard = ({
    id,
    title,
    trace,
  }: {
    id: string;
    title: string;
    trace: string;
  }): ScreenIR["children"][number] => ({
    id,
    name: "Trace Card",
    nodeType: "FRAME",
    type: "card",
    semanticType: "Card",
    layoutMode: "VERTICAL",
    gap: 8,
    width: 220,
    height: 120,
    fillColor: "#ffffff",
    children: [
      {
        id: `${id}-title`,
        name: "Title",
        nodeType: "TEXT",
        type: "text",
        text: title,
        fontSize: 18,
        fontWeight: 700,
      },
      {
        id: `${id}-trace`,
        name: "Title Ir Id",
        nodeType: "TEXT",
        type: "text",
        text: trace,
        fontSize: 12,
      },
    ],
  });
  const screen: ScreenIR = {
    id: "trace-screen",
    name: "Trace",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 720,
    height: 480,
    children: [
      createTraceCard({
        id: "alpha-card",
        title: "Alpha",
        trace: "alpha-trace",
      }),
      createTraceCard({
        id: "beta-card",
        title: "Beta",
        trace: "beta-trace",
      }),
    ],
  };

  const result = createDefaultTailwindScreenFile(screen);
  const component = result.componentFiles.find((file) => file.path === "src/components/TraceCard.tsx");

  assert.ok(component, "expected reusable TraceCard component file");
  assert.match(component.content, /titleIrId: string;\n  titleIrName: string;\n  titleIrIdIrId: string;\n  titleIrIdIrName: string;\n  title: string;\n  titleIrId2: string;/);
  assert.equal((component.content.match(/titleIrId: string;/g) ?? []).length, 1);
  assert.equal((component.content.match(/titleIrId2: string;/g) ?? []).length, 1);
  assert.match(component.content, /data-ir-id=\{props\.titleIrId\}[^>]*>\{props\.title\}/);
  assert.match(component.content, /data-ir-id=\{props\.titleIrIdIrId\}[^>]*>\{props\.titleIrId2\}/);
  assert.match(
    result.file.content,
    /<TraceCard title=\{"Alpha"\} titleIrId2=\{"alpha-trace"\} irId=\{"alpha-card"\} irName=\{"Trace Card"\} titleIrId=\{"alpha-card-title"\} titleIrName=\{"Title"\} titleIrIdIrId=\{"alpha-card-trace"\}/,
  );
  assert.match(
    result.file.content,
    /<TraceCard title=\{"Beta"\} titleIrId2=\{"beta-trace"\} irId=\{"beta-card"\} irName=\{"Trace Card"\} titleIrId=\{"beta-card-title"\} titleIrName=\{"Title"\} titleIrIdIrId=\{"beta-card-trace"\}/,
  );
});

test("default semantic component report captures components and transparent fallback diagnostics", () => {
  const screen: ScreenIR = {
    id: "dialog-screen",
    name: "Dialogs",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 720,
    height: 480,
    children: [
      {
        id: "confirm-dialog",
        name: "Confirm Dialog",
        nodeType: "FRAME",
        type: "dialog",
        semanticType: "dialog",
        layoutMode: "VERTICAL",
        width: 360,
        height: 180,
        children: [
          {
            id: "confirm-dialog-title",
            name: "Dialog Title",
            nodeType: "TEXT",
            type: "text",
            text: "Delete item",
            fontSize: 24,
            fontWeight: 700,
          },
        ],
      },
      {
        id: "settings-accordion",
        name: "Settings Accordion",
        nodeType: "FRAME",
        type: "accordion",
        semanticType: "Accordion",
        width: 360,
        height: 80,
        children: [],
      },
    ],
  };

  const rendered = createDefaultTailwindScreenFile(screen);
  const report = JSON.parse(createDefaultSemanticComponentReportFile([screen]).content) as {
    schemaVersion?: string;
    pipelineId?: string;
    components?: Array<{ componentName: string }>;
    diagnostics?: Array<{ code: string; nodeId: string }>;
  };
  const layoutReport = JSON.parse(createDefaultLayoutReportFile([screen]).content) as {
    semanticDiagnostics?: Array<{ code: string; nodeId: string }>;
  };

  assert.match(rendered.file.content, /role="dialog"/);
  assert.match(rendered.file.content, /aria-modal="true"/);
  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.pipelineId, "default");
  assert.deepEqual(report.components, []);
  assert.deepEqual(
    report.diagnostics?.map((diagnostic) => ({
      code: diagnostic.code,
      nodeId: diagnostic.nodeId,
    })),
    [
      {
        code: "W_SEMANTIC_COMPONENT_STRUCTURAL_FALLBACK",
        nodeId: "settings-accordion",
      },
      {
        code: "W_SEMANTIC_COMPONENT_NOT_REUSABLE",
        nodeId: "confirm-dialog",
      },
    ],
  );
  assert.deepEqual(layoutReport.semanticDiagnostics, report.diagnostics);
});
