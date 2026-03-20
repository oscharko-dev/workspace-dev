// ---------------------------------------------------------------------------
// ir-elements.ts — Element mapping pipeline (tree traversal & property enrichment)
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import {
  isHelperItemNode,
  isNodeGeometryEmpty
} from "../figma-node-heuristics.js";
import {
  hasAnyWord
} from "./ir-classification.js";
import {
  resolveElevationFromEffects,
  resolveFirstVisibleGradientPaint,
  resolveFirstVisibleSolidPaint,
  resolveInsetShadowFromEffects,
  toCssGradient,
  toHexColor
} from "./ir-colors.js";
import {
  countSubtreeNodes,
  shouldTruncateChildrenByDepth
} from "./ir-tree.js";
import type { ScreenDepthBudgetContext } from "./ir-tree.js";
import {
  classifyPlaceholderNode,
  extractVariantDataFromNode,
  toComponentSetVariantMapping
} from "./ir-variants.js";
import type { PlaceholderMatcherConfig } from "./ir-variants.js";
import type {
  FigmaNode,
  MetricsAccumulator,
  PrototypeNavigationResolutionContext
} from "./ir-helpers.js";
import {
  determineElementType,
  mapPadding,
  mapMargin
} from "./ir-helpers.js";
import {
  resolvePrototypeNavigation
} from "./ir-navigation.js";

export interface MapElementInput {
  node: FigmaNode;
  depth: number;
  inInstanceContext: boolean;
  inInputContext: boolean;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
  metrics: MetricsAccumulator;
  depthContext: ScreenDepthBudgetContext;
  navigationContext: PrototypeNavigationResolutionContext;
}

export type PlaceholderClassification = ReturnType<typeof classifyPlaceholderNode>;

export interface ElementSkipEvaluation {
  skip: boolean;
  placeholderClassification: PlaceholderClassification;
}

export interface ElementBaseBuildResult {
  element: ScreenElementIR;
  elementType: ScreenElementIR["type"];
}

export interface ElementTraversalContext {
  isNextInstanceContext: boolean;
  isNextInputContext: boolean;
}

export const evaluateElementSkip = ({
  node,
  inInstanceContext,
  inInputContext,
  placeholderMatcherConfig,
  metrics
}: Pick<
  MapElementInput,
  "node" | "inInstanceContext" | "inInputContext" | "placeholderMatcherConfig" | "metrics"
>): ElementSkipEvaluation => {
  if (node.visible === false) {
    metrics.skippedHidden += countSubtreeNodes(node);
    return {
      skip: true,
      placeholderClassification: "none"
    };
  }

  const placeholderClassification = classifyPlaceholderNode({
    node,
    matcher: placeholderMatcherConfig
  });
  if (inInstanceContext && placeholderClassification === "technical") {
    metrics.skippedPlaceholders += 1;
    return {
      skip: true,
      placeholderClassification
    };
  }
  if (inInstanceContext && !inInputContext && placeholderClassification === "generic") {
    metrics.skippedPlaceholders += 1;
    return {
      skip: true,
      placeholderClassification
    };
  }

  if (isHelperItemNode({ node }) && isNodeGeometryEmpty({ node })) {
    metrics.skippedPlaceholders += countSubtreeNodes(node);
    return {
      skip: true,
      placeholderClassification
    };
  }

  return {
    skip: false,
    placeholderClassification
  };
};

export const buildElementBase = ({
  node,
  metrics,
  navigationContext
}: Pick<MapElementInput, "node" | "metrics" | "navigationContext">): ElementBaseBuildResult => {
  const elementType = determineElementType(node);
  const variantMapping =
    node.type === "COMPONENT_SET" ? toComponentSetVariantMapping(node) : extractVariantDataFromNode(node);
  const prototypeNavigation = resolvePrototypeNavigation({
    node,
    metrics,
    navigationContext
  });
  const margin = mapMargin(node);
  const element: ScreenElementIR = {
    id: node.id,
    name: node.name ?? node.type,
    nodeType: node.type,
    type: elementType,
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    padding: mapPadding(node),
    ...(margin ? { margin } : {}),
    ...(prototypeNavigation ? { prototypeNavigation } : {}),
    ...(variantMapping ? { variantMapping } : {}),
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };

  return {
    element,
    elementType
  };
};

export const enrichElementStyleAndGeometry = ({
  node,
  element,
  placeholderClassification,
  inInstanceContext,
  inInputContext
}: {
  node: FigmaNode;
  element: ScreenElementIR;
  placeholderClassification: PlaceholderClassification;
  inInstanceContext: boolean;
  inInputContext: boolean;
}): void => {
  const fill = resolveFirstVisibleSolidPaint(node.fills);
  const gradientFill = resolveFirstVisibleGradientPaint(node.fills);
  const stroke = resolveFirstVisibleSolidPaint(node.strokes);
  const elevation = resolveElevationFromEffects(node.effects);
  const insetShadow = resolveInsetShadowFromEffects(node.effects);
  const vectorPaths = [...(node.fillGeometry ?? []), ...(node.strokeGeometry ?? [])]
    .map((item) => item.path)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  if (node.characters !== undefined) {
    element.text = node.characters;
  }
  if (inInstanceContext && inInputContext && placeholderClassification === "generic") {
    element.textRole = "placeholder";
  }
  if (node.absoluteBoundingBox?.x !== undefined) {
    element.x = node.absoluteBoundingBox.x;
  }
  if (node.absoluteBoundingBox?.y !== undefined) {
    element.y = node.absoluteBoundingBox.y;
  }
  if (node.absoluteBoundingBox?.width !== undefined) {
    element.width = node.absoluteBoundingBox.width;
  }
  if (node.absoluteBoundingBox?.height !== undefined) {
    element.height = node.absoluteBoundingBox.height;
  }

  const fillColor = toHexColor(fill?.color, fill?.opacity);
  if (fillColor) {
    element.fillColor = fillColor;
  }
  const fillGradient = toCssGradient(gradientFill);
  if (fillGradient) {
    element.fillGradient = fillGradient;
  }
  if (typeof node.opacity === "number" && Number.isFinite(node.opacity) && node.opacity >= 0 && node.opacity < 1) {
    element.opacity = node.opacity;
  }
  if (typeof elevation === "number") {
    element.elevation = elevation;
  }
  if (insetShadow) {
    element.insetShadow = insetShadow;
  }
  const strokeColor = toHexColor(stroke?.color, stroke?.opacity);
  if (strokeColor) {
    element.strokeColor = strokeColor;
  }
  if (node.strokeWeight !== undefined) {
    element.strokeWidth = node.strokeWeight;
  }
  if (node.style?.fontSize !== undefined) {
    element.fontSize = node.style.fontSize;
  }
  if (node.style?.fontWeight !== undefined) {
    element.fontWeight = node.style.fontWeight;
  }
  if (node.style?.fontFamily !== undefined) {
    element.fontFamily = node.style.fontFamily;
  }
  if (node.style?.lineHeightPx !== undefined) {
    element.lineHeight = node.style.lineHeightPx;
  }
  if (node.style?.letterSpacing !== undefined) {
    element.letterSpacing = node.style.letterSpacing;
  }
  if (node.style?.textAlignHorizontal !== undefined) {
    element.textAlign = node.style.textAlignHorizontal;
  }
  if (vectorPaths.length > 0) {
    element.vectorPaths = vectorPaths;
  }
  if (node.cornerRadius !== undefined) {
    element.cornerRadius = node.cornerRadius;
  }
};

export const resolveTraversalContext = ({
  node,
  elementType,
  inInstanceContext,
  inInputContext
}: {
  node: FigmaNode;
  elementType: ScreenElementIR["type"];
  inInstanceContext: boolean;
  inInputContext: boolean;
}): ElementTraversalContext => {
  const loweredNodeName = (node.name ?? "").toLowerCase();
  const isCurrentInputContext =
    inInputContext ||
    elementType === "input" ||
    hasAnyWord(loweredNodeName, ["input", "textfield", "select", "formcontrol"]);
  return {
    isNextInstanceContext: inInstanceContext || node.type === "INSTANCE" || node.type === "COMPONENT_SET",
    isNextInputContext: isCurrentInputContext
  };
};

export const markDepthTruncation = ({
  depth,
  depthContext
}: Pick<MapElementInput, "depth" | "depthContext">): void => {
  const nextDepth = depth + 1;
  depthContext.truncatedBranchCount += 1;
  depthContext.firstTruncatedDepth =
    depthContext.firstTruncatedDepth === undefined
      ? nextDepth
      : Math.min(depthContext.firstTruncatedDepth, nextDepth);
};

export const mapElementChildren = ({
  node,
  depth,
  elementType,
  element,
  placeholderMatcherConfig,
  metrics,
  depthContext,
  navigationContext,
  traversalContext,
  mapElementFn
}: {
  node: FigmaNode;
  depth: number;
  elementType: ScreenElementIR["type"];
  element: ScreenElementIR;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
  metrics: MetricsAccumulator;
  depthContext: ScreenDepthBudgetContext;
  navigationContext: PrototypeNavigationResolutionContext;
  traversalContext: ElementTraversalContext;
  mapElementFn: (input: MapElementInput) => ScreenElementIR | null;
}): void => {
  if (node.type === "COMPONENT_SET") {
    const visibleChildren = (node.children ?? []).filter((child) => child.visible !== false);
    const defaultVariantNodeId = element.variantMapping?.defaultVariantNodeId;
    const defaultVariantNode =
      (defaultVariantNodeId ? visibleChildren.find((child) => child.id === defaultVariantNodeId) : undefined) ??
      visibleChildren[0];
    if (!defaultVariantNode) {
      return;
    }

    if (shouldTruncateChildrenByDepth({ node, depth, elementType, context: depthContext })) {
      element.children = [];
      markDepthTruncation({ depth, depthContext });
      return;
    }

    const mappedDefault = mapElementFn({
      node: defaultVariantNode,
      depth: depth + 1,
      inInstanceContext: traversalContext.isNextInstanceContext,
      inInputContext: traversalContext.isNextInputContext,
      placeholderMatcherConfig,
      metrics,
      depthContext,
      navigationContext
    });
    if (mappedDefault) {
      element.children = [mappedDefault];
    }
    return;
  }

  if (shouldTruncateChildrenByDepth({ node, depth, elementType, context: depthContext })) {
    element.children = [];
    markDepthTruncation({ depth, depthContext });
    return;
  }

  if (!node.children?.length) {
    return;
  }

  const children: ScreenElementIR[] = [];
  for (const child of node.children) {
    const mappedChild = mapElementFn({
      node: child,
      depth: depth + 1,
      inInstanceContext: traversalContext.isNextInstanceContext,
      inInputContext: traversalContext.isNextInputContext,
      placeholderMatcherConfig,
      metrics,
      depthContext,
      navigationContext
    });
    if (mappedChild) {
      children.push(mappedChild);
    }
  }
  if (children.length > 0) {
    element.children = children;
  }
};

export const mapElement = ({
  node,
  depth,
  inInstanceContext,
  inInputContext,
  placeholderMatcherConfig,
  metrics,
  depthContext,
  navigationContext
}: MapElementInput): ScreenElementIR | null => {
  const skipEvaluation = evaluateElementSkip({
    node,
    inInstanceContext,
    inInputContext,
    placeholderMatcherConfig,
    metrics
  });
  if (skipEvaluation.skip) {
    return null;
  }

  const { element, elementType } = buildElementBase({
    node,
    metrics,
    navigationContext
  });
  enrichElementStyleAndGeometry({
    node,
    element,
    placeholderClassification: skipEvaluation.placeholderClassification,
    inInstanceContext,
    inInputContext
  });
  depthContext.mappedElementCount += 1;

  const traversalContext = resolveTraversalContext({
    node,
    elementType,
    inInstanceContext,
    inInputContext
  });
  mapElementChildren({
    node,
    depth,
    elementType,
    element,
    placeholderMatcherConfig,
    metrics,
    depthContext,
    navigationContext,
    traversalContext,
    mapElementFn: mapElement
  });

  return element;
};
