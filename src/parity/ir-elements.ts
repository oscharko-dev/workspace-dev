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
  hasAnyWord,
  resolveExplicitBoardComponentFromNode
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
import {
  visitIrNode
} from "./ir-visitor.js";
import type {
  IrVisitContext,
  IrVisitor
} from "./ir-visitor.js";

export interface MapElementInput {
  node: FigmaNode;
  screenId: string;
  screenName: string;
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

interface ElementMappingVisitorState {
  input: MapElementInput;
  mapElementFn: (input: MapElementInput) => ScreenElementIR | null;
  skipNode: boolean;
  placeholderClassification: PlaceholderClassification;
  element?: ScreenElementIR;
  elementType?: ScreenElementIR["type"];
  traversalContext?: ElementTraversalContext;
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
    metrics.nodeDiagnostics.push({
      nodeId: node.id,
      category: "hidden",
      reason: "Node is marked as not visible in the design source."
    });
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
    metrics.nodeDiagnostics.push({
      nodeId: node.id,
      category: "placeholder",
      reason: "Technical placeholder node skipped inside component instance."
    });
    return {
      skip: true,
      placeholderClassification
    };
  }
  if (inInstanceContext && !inInputContext && placeholderClassification === "generic") {
    metrics.skippedPlaceholders += 1;
    metrics.nodeDiagnostics.push({
      nodeId: node.id,
      category: "placeholder",
      reason: "Generic placeholder node skipped inside component instance."
    });
    return {
      skip: true,
      placeholderClassification
    };
  }

  if (isHelperItemNode({ node }) && isNodeGeometryEmpty({ node })) {
    metrics.skippedPlaceholders += countSubtreeNodes(node);
    metrics.nodeDiagnostics.push({
      nodeId: node.id,
      category: "placeholder",
      reason: "Helper item node with empty geometry skipped."
    });
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
  depth,
  screenId,
  screenName,
  metrics,
  navigationContext
}: Pick<MapElementInput, "node" | "depth" | "screenId" | "screenName" | "metrics" | "navigationContext">): ElementBaseBuildResult => {
  const explicitBoardComponent = resolveExplicitBoardComponentFromNode(node);
  if (explicitBoardComponent && !explicitBoardComponent.type) {
    metrics.nodeDiagnostics.push({
      nodeId: node.id,
      category: "unsupported-board-component",
      reason:
        `Explicit board component '${explicitBoardComponent.rawName}' has no deterministic parity renderer mapping; ` +
        "generation falls back to generic semantic classification.",
      screenId
    });
  }
  const elementType = determineElementType(node, {
    depth,
    onFallback: ({ matchedRulePriority }) => {
      metrics.classificationFallbacks.push({
        screenId,
        screenName,
        nodeId: node.id,
        nodeName: node.name ?? node.type,
        nodeType: node.type,
        depth,
        ...(node.layoutMode ? { layoutMode: node.layoutMode } : {}),
        ...(explicitBoardComponent?.canonicalName ? { semanticType: explicitBoardComponent.canonicalName } : {}),
        ...(matchedRulePriority !== undefined ? { matchedRulePriority } : {})
      });
      metrics.nodeDiagnostics.push({
        nodeId: node.id,
        category: "classification-fallback",
        reason:
          `Element type classification used fallback rule for Figma node type '${node.type}'` +
          (explicitBoardComponent?.canonicalName ? ` despite board semantic '${explicitBoardComponent.canonicalName}'` : "") +
          ".",
        screenId
      });
    }
  });
  const variantMapping =
    node.type === "COMPONENT_SET" ? toComponentSetVariantMapping(node) : extractVariantDataFromNode(node);
  const prototypeNavigation = resolvePrototypeNavigation({
    node,
    metrics,
    navigationContext
  });
  const margin = mapMargin(node);
  const baseElement = {
    id: node.id,
    name: node.name ?? node.type,
    nodeType: node.type,
    ...(explicitBoardComponent?.canonicalName
      ? {
          semanticType: explicitBoardComponent.canonicalName,
          semanticSource: "board" as const
        }
      : {}),
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    padding: mapPadding(node),
    ...(margin ? { margin } : {}),
    ...(prototypeNavigation ? { prototypeNavigation } : {}),
    ...(variantMapping ? { variantMapping } : {}),
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };
  const element: ScreenElementIR =
    elementType === "text"
      ? {
          ...baseElement,
          type: "text",
          text: typeof node.characters === "string" ? node.characters : ""
        }
      : {
          ...baseElement,
          type: elementType
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
  screenId,
  screenName,
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
  screenId: string;
  screenName: string;
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
      screenId,
      screenName,
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
      screenId,
      screenName,
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

type ElementMappingVisitor = IrVisitor<FigmaNode, ElementMappingVisitorState>;
type ElementMappingVisitorContext = IrVisitContext<FigmaNode, ElementMappingVisitorState>;

const skipEvaluationVisitor: ElementMappingVisitor = {
  name: "skip-evaluation",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    const {
      node,
      inInstanceContext,
      inInputContext,
      placeholderMatcherConfig,
      metrics
    } = state.input;
    const skipEvaluation = evaluateElementSkip({
      node,
      inInstanceContext,
      inInputContext,
      placeholderMatcherConfig,
      metrics
    });
    state.skipNode = skipEvaluation.skip;
    state.placeholderClassification = skipEvaluation.placeholderClassification;
  }
};

const baseElementVisitor: ElementMappingVisitor = {
  name: "build-base-element",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    if (state.skipNode) {
      return;
    }
    const { node, depth, screenId, screenName, metrics, navigationContext } = state.input;
    const { element, elementType } = buildElementBase({
      node,
      depth,
      screenId,
      screenName,
      metrics,
      navigationContext
    });
    state.element = element;
    state.elementType = elementType;
  }
};

const styleAndGeometryVisitor: ElementMappingVisitor = {
  name: "style-and-geometry",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    if (state.skipNode || !state.element) {
      return;
    }
    const { node, inInstanceContext, inInputContext } = state.input;
    enrichElementStyleAndGeometry({
      node,
      element: state.element,
      placeholderClassification: state.placeholderClassification,
      inInstanceContext,
      inInputContext
    });
  }
};

const depthAccountingVisitor: ElementMappingVisitor = {
  name: "depth-accounting",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    if (state.skipNode || !state.element) {
      return;
    }
    state.input.depthContext.mappedElementCount += 1;
  }
};

const traversalContextVisitor: ElementMappingVisitor = {
  name: "resolve-traversal-context",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    if (state.skipNode || !state.elementType) {
      return;
    }
    const { node, inInstanceContext, inInputContext } = state.input;
    state.traversalContext = resolveTraversalContext({
      node,
      elementType: state.elementType,
      inInstanceContext,
      inInputContext
    });
  }
};

const childTraversalVisitor: ElementMappingVisitor = {
  name: "map-children",
  enter: ({ state }: ElementMappingVisitorContext): void => {
    if (state.skipNode || !state.element || !state.elementType || !state.traversalContext) {
      return;
    }

    const {
      node,
      screenId,
      screenName,
      depth,
      placeholderMatcherConfig,
      metrics,
      depthContext,
      navigationContext
    } = state.input;

    mapElementChildren({
      node,
      screenId,
      screenName,
      depth,
      elementType: state.elementType,
      element: state.element,
      placeholderMatcherConfig,
      metrics,
      depthContext,
      navigationContext,
      traversalContext: state.traversalContext,
      mapElementFn: state.mapElementFn
    });
  }
};

/**
 * Ordered mapping phases for one Figma node.
 *
 * Ordering is dependency-sensitive:
 * 1) skip checks gate all later work
 * 2) base element/type must exist before style enrichment
 * 3) mapped-element counting must happen before depth-based child truncation
 * 4) traversal context must be computed before child mapping
 */
export const ELEMENT_MAPPING_VISITORS: readonly ElementMappingVisitor[] = [
  skipEvaluationVisitor,
  baseElementVisitor,
  styleAndGeometryVisitor,
  depthAccountingVisitor,
  traversalContextVisitor,
  childTraversalVisitor
];

export const mapElement = (input: MapElementInput): ScreenElementIR | null => {
  const visitorState: ElementMappingVisitorState = {
    input,
    mapElementFn: mapElement,
    skipNode: false,
    placeholderClassification: "none"
  };

  visitIrNode({
    node: input.node,
    depth: input.depth,
    state: visitorState,
    visitors: ELEMENT_MAPPING_VISITORS,
    // Child traversal is explicitly controlled by the final visitor phase.
    traverseChildren: (): void => undefined
  });

  if (visitorState.skipNode || !visitorState.element) {
    return null;
  }
  return visitorState.element;
};
