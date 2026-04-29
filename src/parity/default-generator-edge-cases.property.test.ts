import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { pruneDesignIrToSelectedNodeIds } from "../job-engine/scoped-design-ir.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import {
  createDefaultLayoutReportFile,
  createDefaultSemanticComponentReportFile,
  createDefaultTailwindScreenFile,
  createDefaultTailwindScreenFiles,
  validateDesignIR,
} from "./types.js";
import type {
  DesignIR,
  DesignTokens,
  ScreenElementIR,
  ScreenIR,
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
    overline: {
      fontSizePx: 12,
      fontWeight: 600,
      lineHeightPx: 16,
      textTransform: "uppercase",
    },
  },
} satisfies DesignTokens;

const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 32 }),
  fc.constantFrom(
    "Pricing",
    "Pricing!",
    "123 KPI / Overview",
    "class default function return",
    "../../../escape",
    "   ",
  ),
);

const textArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 96 }),
  fc.constantFrom(
    "<script>alert(1)</script>",
    '"quoted" {braces} ${template}',
    "line one\nline two\nline three",
    "x".repeat(512),
  ),
);

const finiteOrHostileNumberArb = fc.oneof(
  fc.double({ min: -100_000, max: 100_000, noNaN: true }),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

const optionalColorArb = fc.option(
  fc.constantFrom("#0055cc", "#ffffff", "#101828", "not-a-color", ""),
  { nil: undefined },
);

const textElement = ({
  id,
  name,
  text,
  fontSize,
  fillColor,
}: {
  id: string;
  name: string;
  text: string;
  fontSize?: number;
  fillColor?: string | undefined;
}): ScreenElementIR => ({
  id,
  name,
  nodeType: "TEXT",
  type: "text",
  text,
  ...(fontSize !== undefined ? { fontSize } : {}),
  ...(fillColor !== undefined ? { fillColor } : {}),
});

const containerElement = ({
  id,
  name,
  children = [],
  width,
  height,
  fillColor,
}: {
  id: string;
  name: string;
  children?: ScreenElementIR[];
  width?: number;
  height?: number;
  fillColor?: string | undefined;
}): ScreenElementIR => ({
  id,
  name,
  nodeType: "FRAME",
  type: "container",
  layoutMode: "VERTICAL",
  gap: 8,
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  children,
  ...(width !== undefined ? { width } : {}),
  ...(height !== undefined ? { height } : {}),
  ...(fillColor !== undefined ? { fillColor } : {}),
});

const cardElement = ({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}): ScreenElementIR => ({
  id,
  name: "Plan Card",
  nodeType: "FRAME",
  type: "card",
  semanticType: "Card",
  layoutMode: "VERTICAL",
  gap: 8,
  width: 240,
  height: 136,
  fillColor: "#ffffff",
  strokeColor: "#101828",
  cornerRadius: 8,
  children: [
    textElement({
      id: `${id}-title`,
      name: "Title",
      text: title,
      fontSize: 20,
      fillColor: "#101828",
    }),
    textElement({
      id: `${id}-description`,
      name: "Description",
      text: description,
      fontSize: 14,
      fillColor: "#475467",
    }),
  ],
});

const screen = ({
  id,
  name,
  children,
  width = 960,
  height = 720,
}: {
  id: string;
  name: string;
  children: ScreenElementIR[];
  width?: number;
  height?: number;
}): ScreenIR => ({
  id,
  name,
  layoutMode: "VERTICAL",
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "CENTER",
  gap: 16,
  width,
  height,
  fillColor: "#ffffff",
  padding: { top: 24, right: 24, bottom: 24, left: 24 },
  children,
});

const designIr = (screens: ScreenIR[]): DesignIR => ({
  sourceName: "Default generator edge cases",
  screens,
  tokens,
  metrics: {
    fetchedNodes: screens.length,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    screenElementCounts: [],
    truncatedScreens: [],
    degradedGeometryNodes: [],
  },
});

const assertGeneratedSourceIsSane = (content: string): void => {
  assert.doesNotMatch(content, /@mui|sx=\{\{|<Box|<Typography/);
  assert.doesNotMatch(content, /(?:NaN|Infinity|-Infinity)px/);
  assert.doesNotMatch(content, /undefined/);
};

test("property: default Tailwind emitter handles random names, long text, missing styles, and hostile numeric values", () => {
  fc.assert(
    fc.property(
      nameArb,
      nameArb,
      textArb,
      finiteOrHostileNumberArb,
      finiteOrHostileNumberArb,
      optionalColorArb,
      (screenName, elementName, text, width, fontSize, fillColor) => {
        const generated = createDefaultTailwindScreenFile(
          screen({
            id: "screen-random",
            name: screenName,
            children: [
              containerElement({
                id: "random-panel",
                name: elementName,
                width,
                height: 120,
                fillColor,
                children: [
                  textElement({
                    id: "random-copy",
                    name: elementName,
                    text,
                    fontSize,
                    fillColor,
                  }),
                ],
              }),
            ],
          }),
        );

        assert.match(generated.file.path, /^src\/pages\/.+\.tsx$/);
        assertGeneratedSourceIsSane(generated.file.content);
        for (const component of generated.componentFiles) {
          assertGeneratedSourceIsSane(component.content);
        }
      },
    ),
    { numRuns: 64 },
  );
});

test("property: duplicate and colliding screen/component names produce unique deterministic artifacts", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(nameArb, { minLength: 2, maxLength: 5, selector: String }),
      fc.array(textArb, { minLength: 2, maxLength: 5 }),
      (randomNames, labels) => {
        const screenNames = ["Pricing", "Pricing!", "Pricing?", ...randomNames];
        const screens = screenNames.slice(0, 5).map((name, index) =>
          screen({
            id: `screen-${index}`,
            name,
            children: [
              {
                id: `cards-${index}`,
                name: "Plan List",
                nodeType: "FRAME",
                type: "list",
                layoutMode: "HORIZONTAL",
                gap: 16,
                width: 720,
                height: 180,
                children: [
                  cardElement({
                    id: `basic-${index}`,
                    title: labels[0] ?? "Basic",
                    description: "For small teams",
                  }),
                  cardElement({
                    id: `pro-${index}`,
                    title: labels[1] ?? "Pro",
                    description: "For growing teams",
                  }),
                ],
              },
            ],
          }),
        );

        const results = createDefaultTailwindScreenFiles(screens);
        const generatedPaths = results.flatMap((result) => [
          result.file.path,
          ...result.componentFiles.map((file) => file.path),
        ]);
        const identities = buildScreenArtifactIdentities(screens);
        const identityComponentNames = [...identities.values()].map(
          (identity) => identity.componentName.toLowerCase(),
        );
        const identityFilePaths = [...identities.values()].map((identity) =>
          identity.filePath.toLowerCase(),
        );
        const identityRoutePaths = [...identities.values()].map((identity) =>
          identity.routePath.toLowerCase(),
        );

        assert.equal(new Set(generatedPaths).size, generatedPaths.length);
        assert.equal(
          new Set(identityComponentNames).size,
          identityComponentNames.length,
        );
        assert.equal(new Set(identityFilePaths).size, identityFilePaths.length);
        assert.equal(
          new Set(identityRoutePaths).size,
          identityRoutePaths.length,
        );
        for (const result of results) {
          assertGeneratedSourceIsSane(result.file.content);
          for (const component of result.componentFiles) {
            assertGeneratedSourceIsSane(component.content);
            assert.equal(
              new Set(component.content.match(/^\s{2}\w+:\sstring;$/gm) ?? [])
                .size,
              (component.content.match(/^\s{2}\w+:\sstring;$/gm) ?? []).length,
            );
          }
        }
      },
    ),
    { numRuns: 32 },
  );
});

test("property: deep trees render without dropping selected descendants", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 28 }),
      nameArb,
      textArb,
      (depth, rawName, text) => {
        let child: ScreenElementIR = textElement({
          id: "leaf-text",
          name: rawName,
          text,
          fontSize: 16,
        });
        for (let index = depth; index >= 1; index -= 1) {
          child = containerElement({
            id: `level-${index}`,
            name: `Level ${index}`,
            children: [child],
          });
        }

        const generated = createDefaultTailwindScreenFile(
          screen({
            id: "deep-screen",
            name: "Deep Tree",
            children: [child],
          }),
        );

        assert.match(generated.file.content, /data-ir-id="level-1"/);
        assert.match(generated.file.content, /data-ir-id="leaf-text"/);
        assertGeneratedSourceIsSane(generated.file.content);
      },
    ),
    { numRuns: 40 },
  );
});

test("default reports tolerate responsive metadata at breakpoint and override edges", () => {
  const responsiveScreen = screen({
    id: "responsive-screen",
    name: "Responsive Edge",
    width: 1536,
    height: 900,
    children: [
      containerElement({
        id: "hero",
        name: "Hero",
        width: 1200,
        height: 320,
        children: [
          textElement({
            id: "hero-title",
            name: "Title",
            text: "Responsive edge",
            fontSize: 32,
          }),
        ],
      }),
    ],
  });
  responsiveScreen.responsive = {
    groupKey: "responsive-edge",
    baseBreakpoint: "lg",
    variants: [
      {
        breakpoint: "xs",
        nodeId: "xs-frame",
        name: "XS",
        width: 0,
        height: 0,
        layoutMode: "VERTICAL",
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        isBase: false,
      },
      {
        breakpoint: "xl",
        nodeId: "xl-frame",
        name: "XL",
        width: 1536,
        height: 900,
        layoutMode: "HORIZONTAL",
        primaryAxisAlignItems: "SPACE_BETWEEN",
        counterAxisAlignItems: "CENTER",
        gap: 48,
        padding: { top: 64, right: 80, bottom: 64, left: 80 },
        isBase: true,
      },
    ],
    rootLayoutOverrides: {
      xs: { layoutMode: "VERTICAL", gap: 0, minHeight: 0 },
      xl: { layoutMode: "HORIZONTAL", gap: 48, minHeight: 900 },
    },
    topLevelLayoutOverrides: {
      hero: {
        xs: { widthRatio: 1, minHeight: 240 },
        xl: { widthRatio: 0.78125, minHeight: 320 },
      },
    },
  };

  const layoutReport = JSON.parse(
    createDefaultLayoutReportFile([responsiveScreen]).content,
  ) as {
    pipelineId?: string;
    screens?: Array<{ screenId?: string; warnings?: unknown[] }>;
  };
  const semanticReport = JSON.parse(
    createDefaultSemanticComponentReportFile([responsiveScreen]).content,
  ) as {
    pipelineId?: string;
    screens?: Array<{ screenId?: string; diagnostics?: unknown[] }>;
  };

  assert.equal(layoutReport.pipelineId, "default");
  assert.equal(semanticReport.pipelineId, "default");
  assert.equal(layoutReport.screens?.[0]?.screenId, "responsive-screen");
  assert.equal(semanticReport.screens?.[0]?.screenId, "responsive-screen");
  assert.deepEqual(layoutReport.screens?.[0]?.warnings, []);
});

test("adversarial selection pruning is deterministic for blank, duplicate, missing, and nested selections", () => {
  const primary = screen({
    id: "screen-a",
    name: "Selection A",
    children: [
      containerElement({
        id: "section-a",
        name: "Section",
        children: [
          cardElement({
            id: "card-a",
            title: "A",
            description: "Selected",
          }),
          cardElement({
            id: "card-b",
            title: "B",
            description: "Sibling",
          }),
        ],
      }),
    ],
  });
  const secondary = screen({
    id: "screen-b",
    name: "Selection B",
    children: [
      cardElement({
        id: "card-c",
        title: "C",
        description: "Other screen",
      }),
    ],
  });
  const ir = designIr([primary, secondary]);

  const blankPruned = pruneDesignIrToSelectedNodeIds({
    ir,
    selectedNodeIds: ["", "   ", "\n"],
  });
  assert.equal(blankPruned, ir);

  const first = pruneDesignIrToSelectedNodeIds({
    ir,
    selectedNodeIds: [
      "missing",
      "card-a-title",
      "card-a-title",
      " card-a-title ",
    ],
  });
  const second = pruneDesignIrToSelectedNodeIds({
    ir,
    selectedNodeIds: [" card-a-title ", "missing", "card-a-title"],
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.screens.map((entry) => entry.id),
    ["screen-a"],
  );
  assert.deepEqual(
    first.screens[0]?.children[0]?.children.map((entry) => entry.id),
    ["card-a"],
  );
  assert.deepEqual(
    first.screens[0]?.children[0]?.children[0]?.children?.map(
      (entry) => entry.id,
    ),
    ["card-a-title"],
  );
  assert.equal(validateDesignIR(first).valid, true);
});

test("adversarial invalid DesignIR inputs fail closed without generator fallbacks", () => {
  const invalidInputs: DesignIR[] = [
    { ...designIr([]), screens: [] },
    { ...designIr([screen({ id: "", name: "", children: [] })]) },
    {
      ...designIr([
        {
          ...screen({ id: "screen", name: "Screen", children: [] }),
          children: undefined as unknown as ScreenElementIR[],
        },
      ]),
    },
  ];

  for (const input of invalidInputs) {
    const result = validateDesignIR(input);
    assert.equal(result.valid, false);
  }
});
