// ---------------------------------------------------------------------------
// ir-design-context.ts — Figma Design-Context to DesignIR transformer
// Issue #1002: Converts structured Figma node data into the DesignIR model
// ---------------------------------------------------------------------------
import type {
  DesignIR,
  DesignTokens,
  FigmaMcpEnrichment,
  GenerationMetrics,
  ScreenElementIR,
  ScreenElementType,
  ScreenIR,
} from "./types.js";
import type { FigmaNode, FigmaFile } from "./ir-helpers.js";
import { resolveFirstVisibleSolidPaint, toHexColor } from "./ir-colors.js";
import { deriveTokens } from "./ir-tokens.js";
import {
  analyzeElementsForBudgeting,
  ADAPTIVE_BUDGET_MAX_SCALE,
  resolveAdaptiveBudget,
  truncateElementsToBudget,
} from "./ir-screens.js";
import {
  analyzeDepthPressure,
  countSubtreeNodes,
  DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
  shouldTruncateChildrenByDepth,
  type ScreenDepthBudgetContext,
} from "./ir-tree.js";

// ---------------------------------------------------------------------------
// Type narrowing for unknown subtree documents
// ---------------------------------------------------------------------------

const isFigmaNodeLike = (value: unknown): value is FigmaNode =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof (value as Record<string, unknown>)["id"] === "string" &&
  "type" in value &&
  typeof (value as Record<string, unknown>)["type"] === "string";

// ---------------------------------------------------------------------------
// mapFigmaNodeTypeToIrElementType
// ---------------------------------------------------------------------------

export const mapFigmaNodeTypeToIrElementType = (
  nodeType: string,
  layoutMode?: string,
): ScreenElementType => {
  switch (nodeType) {
    case "FRAME":
      return layoutMode !== undefined && layoutMode !== "NONE"
        ? "container"
        : "frame";
    case "COMPONENT":
      return "component";
    case "INSTANCE":
      return "instance";
    case "TEXT":
      return "text";
    case "RECTANGLE":
      return "shape";
    case "VECTOR":
    case "ELLIPSE":
    case "STAR":
    case "LINE":
    case "BOOLEAN_OPERATION":
      return "vector";
    case "GROUP":
      return "group";
    case "SECTION":
      return "section";
    case "COMPONENT_SET":
      return "componentSet";
    default:
      return "container";
  }
};

// ---------------------------------------------------------------------------
// Visual property extraction helpers
// ---------------------------------------------------------------------------

const extractFillColor = (node: FigmaNode): string | undefined => {
  const paint = resolveFirstVisibleSolidPaint(node.fills);
  if (!paint) {
    return undefined;
  }
  return toHexColor(paint.color, paint.opacity);
};

const extractStrokeColor = (node: FigmaNode): string | undefined => {
  const paint = resolveFirstVisibleSolidPaint(node.strokes);
  if (!paint) {
    return undefined;
  }
  return toHexColor(paint.color, paint.opacity);
};

const extractDimensions = (
  node: FigmaNode,
): { width?: number; height?: number } => {
  if (node.absoluteBoundingBox) {
    return {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }
  const size = (node as unknown as Record<string, unknown>)["size"];
  if (typeof size === "object" && size !== null && "x" in size && "y" in size) {
    const sizeRecord = size as Record<string, unknown>;
    const x = sizeRecord["x"];
    const y = sizeRecord["y"];
    if (typeof x === "number" && typeof y === "number") {
      return { width: x, height: y };
    }
  }
  return {};
};

const extractPadding = (
  node: FigmaNode,
): { top: number; right: number; bottom: number; left: number } => ({
  top: node.paddingTop ?? 0,
  right: node.paddingRight ?? 0,
  bottom: node.paddingBottom ?? 0,
  left: node.paddingLeft ?? 0,
});

const extractLayoutMode = (
  node: FigmaNode,
): "VERTICAL" | "HORIZONTAL" | "NONE" => {
  const mode = node.layoutMode;
  if (mode === "VERTICAL" || mode === "HORIZONTAL") {
    return mode;
  }
  return "NONE";
};

// ---------------------------------------------------------------------------
// transformNodeToScreenElement
// ---------------------------------------------------------------------------

export const transformNodeToScreenElement = (
  document: unknown,
): ScreenElementIR => {
  return transformNodeToScreenElementInternal(document);
};

interface DesignContextDepthBudgetContext extends ScreenDepthBudgetContext {
  maxTraversalElements: number;
  rawBudgetOverflowCount: number;
}

const transformNodeToScreenElementInternal = (
  document: unknown,
  options?: {
    depth?: number;
    depthContext?: DesignContextDepthBudgetContext;
  },
): ScreenElementIR => {
  const depth = options?.depth ?? 0;
  const depthContext = options?.depthContext;
  const node = isFigmaNodeLike(document)
    ? document
    : ({ id: "unknown", type: "FRAME", name: "Unknown" } satisfies FigmaNode);

  const elementType = mapFigmaNodeTypeToIrElementType(
    node.type,
    node.layoutMode,
  );

  const dimensions = extractDimensions(node);
  const fillColor = extractFillColor(node);
  const strokeColor = extractStrokeColor(node);
  const layoutMode = extractLayoutMode(node);
  const padding = extractPadding(node);
  const gap = node.itemSpacing ?? 0;

  if (depthContext) {
    depthContext.mappedElementCount += 1;
  }

  let children: ScreenElementIR[] | undefined;
  if (Array.isArray(node.children) && node.children.length > 0) {
    const shouldTruncate =
      depthContext !== undefined
        ? shouldTruncateChildrenByDepth({
            node,
            depth,
            elementType,
            context: depthContext,
          })
        : false;

    if (shouldTruncate) {
      depthContext!.truncatedBranchCount += 1;
      if (depthContext!.firstTruncatedDepth === undefined) {
        depthContext!.firstTruncatedDepth = depth + 1;
      }
    } else {
      const nextChildren: ScreenElementIR[] = [];
      for (const child of node.children) {
        if (!isFigmaNodeLike(child)) {
          nextChildren.push(transformNodeToScreenElementInternal(child, {
            depth: depth + 1,
            ...(depthContext ? { depthContext } : {}),
          }));
          continue;
        }

        if (
          depthContext &&
          depthContext.mappedElementCount >= depthContext.maxTraversalElements
        ) {
          depthContext.rawBudgetOverflowCount += countSubtreeNodes(child);
          continue;
        }

        nextChildren.push(
          transformNodeToScreenElementInternal(child, {
            depth: depth + 1,
            ...(depthContext ? { depthContext } : {}),
          }),
        );
      }
      children = nextChildren.length > 0 ? nextChildren : undefined;
    }
  }

  const base = {
    id: node.id,
    name: node.name ?? "",
    nodeType: node.type,
    semanticSource: "board" as const,
    ...(dimensions.width !== undefined ? { width: dimensions.width } : {}),
    ...(dimensions.height !== undefined ? { height: dimensions.height } : {}),
    ...(fillColor !== undefined ? { fillColor } : {}),
    ...(strokeColor !== undefined ? { strokeColor } : {}),
    ...(node.strokeWeight !== undefined
      ? { strokeWidth: node.strokeWeight }
      : {}),
    ...(node.cornerRadius !== undefined
      ? { cornerRadius: node.cornerRadius }
      : {}),
    ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    ...(layoutMode !== "NONE" ? { layoutMode } : {}),
    ...(gap > 0 ? { gap } : {}),
    ...(padding.top > 0 ||
    padding.right > 0 ||
    padding.bottom > 0 ||
    padding.left > 0
      ? { padding }
      : {}),
    ...(node.primaryAxisAlignItems !== undefined
      ? { primaryAxisAlignItems: node.primaryAxisAlignItems }
      : {}),
    ...(node.counterAxisAlignItems !== undefined
      ? { counterAxisAlignItems: node.counterAxisAlignItems }
      : {}),
    ...(children !== undefined ? { children } : {}),
  };

  if (elementType === "text") {
    const style = node.style;
    return {
      ...base,
      type: "text" as const,
      text: node.characters ?? "",
      ...(style?.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
      ...(style?.fontWeight !== undefined
        ? { fontWeight: style.fontWeight }
        : {}),
      ...(style?.fontFamily !== undefined
        ? { fontFamily: style.fontFamily }
        : {}),
      ...(style?.lineHeightPx !== undefined
        ? { lineHeight: style.lineHeightPx }
        : {}),
      ...(style?.letterSpacing !== undefined
        ? { letterSpacing: style.letterSpacing }
        : {}),
      ...(style?.textAlignHorizontal !== undefined
        ? { textAlign: style.textAlignHorizontal }
        : {}),
    };
  }

  return {
    ...base,
    type: elementType,
  };
};

interface DesignContextScreenTransformResult {
  screen: ScreenIR;
  originalElements: number;
  retainedElements: number;
  truncatedByBudget: boolean;
  droppedTypeCounts: Record<string, number>;
  depthTruncatedBranchCount: number;
  firstTruncatedDepth?: number;
}

const transformDesignContextSubtreeToScreen = ({
  subtree,
  screenElementBudget,
  screenElementMaxDepth,
}: {
  subtree: {
    nodeId: string;
    document: unknown;
  };
  screenElementBudget: number;
  screenElementMaxDepth: number;
}): DesignContextScreenTransformResult => {
  const doc = subtree.document;
  const node = isFigmaNodeLike(doc)
    ? doc
    : ({
        id: subtree.nodeId,
        type: "FRAME",
        name: subtree.nodeId,
      } satisfies FigmaNode);

  const layoutMode = extractLayoutMode(node);
  const padding = extractPadding(node);
  const dimensions = extractDimensions(node);
  const fillColor = extractFillColor(node);

  const depthAnalysis = analyzeDepthPressure(node.children ?? [], (candidate) =>
    mapFigmaNodeTypeToIrElementType(
      candidate.type,
      "layoutMode" in candidate && typeof candidate.layoutMode === "string"
        ? candidate.layoutMode
        : undefined,
    ),
  );
  const depthContext: DesignContextDepthBudgetContext = {
    screenElementBudget,
    configuredMaxDepth: screenElementMaxDepth,
    mappedElementCount: 0,
    nodeCountByDepth: depthAnalysis.nodeCountByDepth,
    semanticCountByDepth: depthAnalysis.semanticCountByDepth,
    subtreeHasSemanticById: depthAnalysis.subtreeHasSemanticById,
    truncatedBranchCount: 0,
    maxTraversalElements: Math.max(
      screenElementBudget,
      Math.ceil(screenElementBudget * ADAPTIVE_BUDGET_MAX_SCALE),
    ),
    rawBudgetOverflowCount: 0,
  };

  const mappedChildren: ScreenElementIR[] = [];
  for (const child of node.children ?? []) {
    if (
      isFigmaNodeLike(child) &&
      depthContext.mappedElementCount >= depthContext.maxTraversalElements
    ) {
      depthContext.rawBudgetOverflowCount += countSubtreeNodes(child);
      continue;
    }

    mappedChildren.push(
      transformNodeToScreenElementInternal(child, {
        depth: 0,
        depthContext,
      }),
    );
  }

  const mappedElementAnalysis = analyzeElementsForBudgeting(mappedChildren);
  const originalElements =
    mappedElementAnalysis.totalCount + depthContext.rawBudgetOverflowCount;
  const adaptiveBudget = resolveAdaptiveBudget({
    elements: mappedChildren,
    originalCount: originalElements,
    baseBudget: screenElementBudget,
    interactiveCount: mappedElementAnalysis.interactiveCount,
  });
  const { elements: budgetedChildren, retainedCount, droppedTypeCounts } =
    originalElements > adaptiveBudget
      ? truncateElementsToBudget({
          elements: mappedChildren,
          budget: adaptiveBudget,
          candidates: mappedElementAnalysis.truncationCandidates,
        })
      : {
          elements: mappedChildren,
          retainedCount: mappedElementAnalysis.totalCount,
          droppedTypeCounts: {} as Record<string, number>,
        };

  return {
    screen: {
      id: node.id,
      name: node.name ?? subtree.nodeId,
      layoutMode,
      gap: node.itemSpacing ?? 0,
      padding,
      ...(dimensions.width !== undefined ? { width: dimensions.width } : {}),
      ...(dimensions.height !== undefined ? { height: dimensions.height } : {}),
      ...(fillColor !== undefined ? { fillColor } : {}),
      ...(node.primaryAxisAlignItems !== undefined
        ? { primaryAxisAlignItems: node.primaryAxisAlignItems }
        : {}),
      ...(node.counterAxisAlignItems !== undefined
        ? { counterAxisAlignItems: node.counterAxisAlignItems }
        : {}),
      children: budgetedChildren,
    },
    originalElements,
    retainedElements: retainedCount,
    truncatedByBudget: originalElements > adaptiveBudget,
    droppedTypeCounts,
    depthTruncatedBranchCount: depthContext.truncatedBranchCount,
    ...(depthContext.firstTruncatedDepth !== undefined
      ? { firstTruncatedDepth: depthContext.firstTruncatedDepth }
      : {}),
  };
};

// ---------------------------------------------------------------------------
// transformDesignContextToScreens
// ---------------------------------------------------------------------------

export const transformDesignContextToScreens = ({
  authoritativeSubtrees,
  screenElementBudget = DEFAULT_SCREEN_ELEMENT_BUDGET,
  screenElementMaxDepth = DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
}: {
  authoritativeSubtrees: ReadonlyArray<{
    nodeId: string;
    document: unknown;
  }>;
  screenElementBudget?: number;
  screenElementMaxDepth?: number;
}): ScreenIR[] =>
  authoritativeSubtrees.map((subtree): ScreenIR =>
    transformDesignContextSubtreeToScreen({
      subtree,
      screenElementBudget,
      screenElementMaxDepth,
    }).screen,
  );

// ---------------------------------------------------------------------------
// transformDesignContextToTokens
// ---------------------------------------------------------------------------

const EMPTY_FIGMA_FILE: FigmaFile = {
  name: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [],
  },
};

export const transformDesignContextToTokens = ({
  enrichment,
}: {
  enrichment?: FigmaMcpEnrichment;
}): DesignTokens => deriveTokens(EMPTY_FIGMA_FILE, enrichment);

// ---------------------------------------------------------------------------
// transformDesignContextToDesignIr
// ---------------------------------------------------------------------------

export const transformDesignContextToDesignIr = ({
  authoritativeSubtrees,
  enrichment,
  sourceName,
  screenElementBudget = DEFAULT_SCREEN_ELEMENT_BUDGET,
  screenElementMaxDepth = DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
}: {
  authoritativeSubtrees: ReadonlyArray<{
    nodeId: string;
    document: unknown;
  }>;
  enrichment?: FigmaMcpEnrichment;
  sourceName?: string;
  screenElementBudget?: number;
  screenElementMaxDepth?: number;
}): DesignIR => {
  const screenResults = authoritativeSubtrees.map((subtree) =>
    transformDesignContextSubtreeToScreen({
      subtree,
      screenElementBudget,
      screenElementMaxDepth,
    }),
  );
  const screens = screenResults.map((result) => result.screen);
  const tokens = transformDesignContextToTokens(
    enrichment !== undefined ? { enrichment } : {},
  );

  const metrics: GenerationMetrics = {
    fetchedNodes: 0,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    prototypeNavigationDetected: 0,
    prototypeNavigationResolved: 0,
    prototypeNavigationUnresolved: 0,
    screenElementCounts: screenResults.map((result) => ({
      screenId: result.screen.id,
      screenName: result.screen.name,
      elements: result.originalElements,
    })),
    truncatedScreens: screenResults
      .filter((result) => result.truncatedByBudget)
      .map((result) => ({
        screenId: result.screen.id,
        screenName: result.screen.name,
        originalElements: result.originalElements,
        retainedElements: result.retainedElements,
        budget: screenElementBudget,
        ...(Object.keys(result.droppedTypeCounts).length > 0
          ? { droppedTypeCounts: result.droppedTypeCounts }
          : {}),
      })),
    depthTruncatedScreens: screenResults
      .filter((result) => result.depthTruncatedBranchCount > 0)
      .map((result) => ({
        screenId: result.screen.id,
        screenName: result.screen.name,
        maxDepth: screenElementMaxDepth,
        firstTruncatedDepth:
          result.firstTruncatedDepth ?? screenElementMaxDepth + 1,
        truncatedBranchCount: result.depthTruncatedBranchCount,
      })),
    classificationFallbacks: [],
    degradedGeometryNodes: [],
    nodeDiagnostics: [
      ...screenResults
        .filter((result) => result.truncatedByBudget)
        .map((result) => ({
          nodeId: result.screen.id,
          category: "truncated" as const,
          reason:
            `Screen exceeded element budget (${String(screenElementBudget)}). ` +
            `${String(result.originalElements - result.retainedElements)} element(s) dropped.`,
          screenId: result.screen.id,
        })),
      ...screenResults
        .filter((result) => result.depthTruncatedBranchCount > 0)
        .map((result) => ({
          nodeId: result.screen.id,
          category: "depth-truncated" as const,
          reason:
            `${String(result.depthTruncatedBranchCount)} branch(es) truncated at depth ` +
            `${String(screenElementMaxDepth)}.`,
          screenId: result.screen.id,
        })),
    ],
  };

  return {
    sourceName: sourceName ?? "Figma Design Context",
    screens,
    tokens,
    metrics,
  };
};
