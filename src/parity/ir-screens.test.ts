import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaNode, MetricsAccumulator } from "./ir-helpers.js";
import {
  buildTopLevelLayoutMatchMap,
  collectSectionScreens,
  analyzeElementsForBudgeting,
  hasMeaningfulTextContent,
  hasVisualSubstance,
  indexScreenNodeIds,
  isGenericFrameName,
  isScreenLikeNode,
  normalizeComparableMinHeight,
  normalizeComparableWidthRatio,
  resolveAdaptiveBudget,
  resolveLayoutOverride,
  resolveElementBasePriority,
  resolveResponsiveBreakpointFromWidth,
  resolveScreenGroupKey,
  resolveTruncationPriority,
  toComparableElementLayout,
  toComparableRootLayout,
  toResponsiveMatchElementName,
  truncateElementsToBudget,
  unwrapScreenRoot
} from "./ir-screens.js";
import type { ScreenElementIR } from "./types.js";

const makeMetrics = (): MetricsAccumulator => ({
  fetchedNodes: 0,
  skippedHidden: 0,
  skippedPlaceholders: 0,
  prototypeNavigationDetected: 0,
  prototypeNavigationResolved: 0,
  prototypeNavigationUnresolved: 0,
  screenElementCounts: [],
  truncatedScreens: [],
  depthTruncatedScreens: [],
  classificationFallbacks: [],
  degradedGeometryNodes: [],
  nodeDiagnostics: []
});

const makeFigmaNode = ({
  id,
  type,
  name = id,
  children,
  ...overrides
}: {
  id: string;
  type: string;
  name?: string;
  children?: FigmaNode[];
} & Omit<Partial<FigmaNode>, "children" | "id" | "name" | "type">): FigmaNode => ({
  id,
  type,
  name,
  ...(children ? { children } : {}),
  ...overrides
});

const makeElement = ({
  id,
  type,
  name = id,
  children,
  nodeType = "FRAME",
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  children?: ScreenElementIR[];
  nodeType?: string;
} & Omit<Partial<ScreenElementIR>, "children" | "id" | "name" | "nodeType" | "type">): ScreenElementIR =>
  ({
    id,
    type,
    name,
    nodeType,
    ...(children ? { children } : {}),
    ...overrides
  }) as ScreenElementIR;

test("screen root helpers classify visible nodes and generic names deterministically", () => {
  assert.equal(isScreenLikeNode(undefined), false);
  assert.equal(isScreenLikeNode(makeFigmaNode({ id: "hidden-frame", type: "FRAME", visible: false })), false);
  assert.equal(isScreenLikeNode(makeFigmaNode({ id: "section", type: "SECTION" })), false);
  assert.equal(isScreenLikeNode(makeFigmaNode({ id: "frame", type: "FRAME" })), true);
  assert.equal(isScreenLikeNode(makeFigmaNode({ id: "component", type: "COMPONENT" })), true);

  assert.equal(isGenericFrameName(undefined), true);
  assert.equal(isGenericFrameName("   "), true);
  assert.equal(isGenericFrameName("Frame 12"), true);
  assert.equal(isGenericFrameName("group 3"), true);
  assert.equal(isGenericFrameName("Checkout Summary"), false);
});

test("unwrapScreenRoot skips wrapper shells but keeps custom roots intact", () => {
  const wrapped = makeFigmaNode({
    id: "parent",
    type: "FRAME",
    name: "Checkout",
    paddingLeft: 24,
    absoluteBoundingBox: {
      x: 0,
      y: 0,
      width: 400,
      height: 300
    },
    children: [
      makeFigmaNode({
        id: "child",
        type: "FRAME",
        name: "Frame 1",
        absoluteBoundingBox: {
          x: 24,
          y: 24,
          width: 376,
          height: 276
        }
      })
    ]
  });

  assert.deepEqual(unwrapScreenRoot(wrapped), {
    node: wrapped.children?.[0],
    name: "Checkout"
  });

  const direct = makeFigmaNode({
    id: "screen",
    type: "FRAME",
    name: "Order Details",
    absoluteBoundingBox: {
      x: 0,
      y: 0,
      width: 360,
      height: 640
    },
    children: [
      makeFigmaNode({
        id: "content",
        type: "FRAME",
        name: "Order Details",
        absoluteBoundingBox: {
          x: 0,
          y: 0,
          width: 360,
          height: 640
        }
      })
    ]
  });

  assert.deepEqual(unwrapScreenRoot(direct), {
    node: direct,
    name: "Order Details"
  });
});

test("collectSectionScreens recurses nested sections and indexScreenNodeIds preserves first ownership", () => {
  const metrics = makeMetrics();
  const nestedScreen = makeFigmaNode({ id: "nested-screen", type: "FRAME", name: "Nested" });
  const topScreen = makeFigmaNode({ id: "top-screen", type: "COMPONENT", name: "Top" });
  const hiddenScreen = makeFigmaNode({
    id: "hidden-screen",
    type: "FRAME",
    visible: false,
    children: [makeFigmaNode({ id: "hidden-child", type: "RECTANGLE" })]
  });
  const section = makeFigmaNode({
    id: "section",
    type: "SECTION",
    children: [
      hiddenScreen,
      topScreen,
      makeFigmaNode({
        id: "nested-section",
        type: "SECTION",
        children: [nestedScreen]
      }),
      makeFigmaNode({ id: "shape", type: "RECTANGLE" })
    ]
  });

  const screens = collectSectionScreens({
    section,
    metrics
  });
  assert.deepEqual(
    screens.map((screen) => screen.id),
    ["top-screen", "nested-screen"]
  );
  assert.equal(metrics.skippedHidden, 2);

  const index = new Map<string, string>([["nested-screen", "existing-screen"]]);
  indexScreenNodeIds({
    root: makeFigmaNode({
      id: "screen-root",
      type: "FRAME",
      children: [
        makeFigmaNode({
          id: "nested-screen",
          type: "FRAME",
          children: [makeFigmaNode({ id: "deep-child", type: "RECTANGLE" })]
        })
      ]
    }),
    screenId: "screen-root",
    index
  });

  assert.equal(index.get("screen-root"), "screen-root");
  assert.equal(index.get("nested-screen"), "existing-screen");
  assert.equal(index.get("deep-child"), "screen-root");
});

test("text and visual substance helpers reject placeholders and detect styling signals", () => {
  assert.equal(hasMeaningfulTextContent(undefined), false);
  assert.equal(hasMeaningfulTextContent("   "), false);
  assert.equal(hasMeaningfulTextContent("Swap Component"), false);
  assert.equal(hasMeaningfulTextContent("Account Balance"), true);

  assert.equal(
    hasVisualSubstance(
      makeElement({
        id: "plain",
        type: "container"
      })
    ),
    false
  );
  assert.equal(
    hasVisualSubstance(
      makeElement({
        id: "styled",
        type: "container",
        strokeWidth: 1,
        gap: 8,
        padding: {
          top: 8,
          right: 8,
          bottom: 8,
          left: 8
        },
        vectorPaths: ["M0 0L1 1"]
      })
    ),
    true
  );
});

test("adaptive budgets only scale when the base budget is large enough and interactivity is dense", () => {
  const elements = [
    makeElement({ id: "button", type: "button" }),
    makeElement({ id: "input", type: "input" })
  ];

  assert.equal(
    resolveAdaptiveBudget({
      elements,
      originalCount: 20,
      baseBudget: 10,
      interactiveCount: 20
    }),
    10
  );
  assert.equal(
    resolveAdaptiveBudget({
      elements,
      originalCount: 1_000,
      baseBudget: 1_200,
      interactiveCount: 50
    }),
    1_200
  );
  assert.equal(
    resolveAdaptiveBudget({
      elements,
      originalCount: 1_600,
      baseBudget: 1_200,
      interactiveCount: 320
    }),
    1_440
  );
  assert.equal(
    resolveAdaptiveBudget({
      elements,
      originalCount: 400,
      baseBudget: 1_200,
      interactiveCount: 100
    }),
    1_200
  );
});

test("accordion receives interactive priority and is counted as interactive", () => {
  const accordion = makeElement({
    id: "accordion",
    type: "accordion",
    children: [
      makeElement({
        id: "accordion-summary",
        type: "text",
        text: "Details"
      } as ScreenElementIR)
    ]
  });

  assert.equal(resolveElementBasePriority("accordion"), 100);

  const priority = resolveTruncationPriority(accordion);
  assert.deepEqual(priority, {
    score: 102,
    mustKeep: true
  });

  const analysis = analyzeElementsForBudgeting([accordion]);
  assert.equal(analysis.totalCount, 2);
  assert.equal(analysis.interactiveCount, 1);
  assert.equal(analysis.truncationCandidates[0]?.score, 102);
  assert.equal(analysis.truncationCandidates[0]?.mustKeep, true);
});

test("truncateElementsToBudget handles empty, passthrough, and selected subtree scenarios", () => {
  const root = makeElement({
    id: "root",
    type: "container",
    children: [
      makeElement({
        id: "keep-text",
        type: "text",
        text: "Keep"
      } as ScreenElementIR),
      makeElement({
        id: "drop-button",
        type: "button"
      })
    ]
  });

  assert.deepEqual(
    truncateElementsToBudget({
      elements: [root],
      budget: 0
    }),
    {
      elements: [],
      retainedCount: 0,
      droppedTypeCounts: {}
    }
  );

  const passthrough = truncateElementsToBudget({
    elements: [root],
    budget: 3,
    candidates: [
      {
        id: "root",
        elementType: "container",
        ancestorIds: [],
        depth: 0,
        traversalIndex: 0,
        area: 100,
        score: 100,
        mustKeep: true
      }
    ]
  });
  assert.equal(passthrough.elements[0], root);
  assert.equal(passthrough.retainedCount, 1);

  const truncated = truncateElementsToBudget({
    elements: [root],
    budget: 2,
    candidates: [
      {
        id: "keep-text",
        elementType: "text",
        ancestorIds: ["root"],
        depth: 1,
        traversalIndex: 1,
        area: 10,
        score: 90,
        mustKeep: false
      },
      {
        id: "drop-button",
        elementType: "button",
        ancestorIds: ["root"],
        depth: 1,
        traversalIndex: 2,
        area: 10,
        score: 10,
        mustKeep: false
      },
      {
        id: "root",
        elementType: "container",
        ancestorIds: [],
        depth: 0,
        traversalIndex: 0,
        area: 100,
        score: 80,
        mustKeep: false
      }
    ]
  });

  assert.equal(truncated.retainedCount, 2);
  assert.equal(truncated.droppedTypeCounts.button, 1);
  assert.deepEqual(truncated.elements[0]?.children?.map((child) => child.id), ["keep-text"]);
});

test("accordion truncation priority stays ahead of container-like elements", () => {
  const accordion = makeElement({
    id: "accordion",
    type: "accordion",
    children: [
      makeElement({
        id: "accordion-summary",
        type: "text",
        text: "Details"
      } as ScreenElementIR)
    ]
  });
  const container = makeElement({
    id: "container",
    type: "container"
  });

  const accordionPriority = resolveTruncationPriority(accordion);
  const containerPriority = resolveTruncationPriority(container);

  assert.equal(accordionPriority.mustKeep, true);
  assert.ok(accordionPriority.score > containerPriority.score);
});

test("responsive grouping helpers normalize widths, breakpoints, and layout overrides", () => {
  assert.equal(normalizeComparableWidthRatio(undefined), undefined);
  assert.equal(normalizeComparableWidthRatio(0), undefined);
  assert.equal(normalizeComparableWidthRatio(1.456), 1.2);
  assert.equal(normalizeComparableWidthRatio(0.7564), 0.756);

  assert.equal(normalizeComparableMinHeight(undefined), undefined);
  assert.equal(normalizeComparableMinHeight(0), undefined);
  assert.equal(normalizeComparableMinHeight(48.6), 49);

  assert.equal(
    resolveScreenGroupKey({
      name: "Checkout Tablet Portrait",
      fallbackId: "fallback-1"
    }),
    "checkout"
  );
  assert.equal(
    resolveScreenGroupKey({
      name: "   ",
      fallbackId: "Hero Screen"
    }),
    "screen-hero-screen"
  );

  assert.equal(resolveResponsiveBreakpointFromWidth(undefined), "lg");
  assert.equal(resolveResponsiveBreakpointFromWidth(1_600), "xl");
  assert.equal(resolveResponsiveBreakpointFromWidth(1_250), "lg");
  assert.equal(resolveResponsiveBreakpointFromWidth(920), "md");
  assert.equal(resolveResponsiveBreakpointFromWidth(640), "sm");
  assert.equal(resolveResponsiveBreakpointFromWidth(480), "xs");

  const rootLayout = toComparableRootLayout(
    makeFigmaNode({
      id: "screen",
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 16,
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "MAX"
    })
  );
  assert.deepEqual(rootLayout, {
    layoutMode: "VERTICAL",
    gap: 16,
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "MAX"
  });

  const child = makeElement({
    id: "child",
    type: "container",
    name: "CTA / Button",
    layoutMode: "HORIZONTAL",
    gap: 12,
    width: 180,
    height: 47.6
  });
  const elementLayout = toComparableElementLayout({
    element: child,
    rootWidth: 360
  });
  assert.deepEqual(elementLayout, {
    layoutMode: "HORIZONTAL",
    gap: 12,
    widthRatio: 0.5,
    minHeight: 48
  });
  assert.equal(toResponsiveMatchElementName(child.name), "cta-button");

  const matchMap = buildTopLevelLayoutMatchMap({
    children: [child, { ...child, id: "child-2" }],
    rootWidth: 360
  });
  assert.deepEqual([...matchMap.keys()], ["container:cta-button#1", "container:cta-button#2"]);

  assert.equal(
    resolveLayoutOverride({
      base: {
        layoutMode: "VERTICAL",
        gap: 8,
        widthRatio: 0.5,
        minHeight: 48
      },
      current: {
        layoutMode: "VERTICAL",
        gap: 8,
        widthRatio: 0.505,
        minHeight: 48
      }
    }),
    undefined
  );
  assert.deepEqual(
    resolveLayoutOverride({
      base: {
        layoutMode: "VERTICAL",
        gap: 8,
        primaryAxisAlignItems: "MIN",
        widthRatio: 0.5,
        minHeight: 48
      },
      current: {
        layoutMode: "HORIZONTAL",
        gap: 12,
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "MAX",
        widthRatio: 0.7,
        minHeight: 56
      }
    }),
    {
      layoutMode: "HORIZONTAL",
      gap: 12,
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "MAX",
      widthRatio: 0.7,
      minHeight: 56
    }
  );
});
