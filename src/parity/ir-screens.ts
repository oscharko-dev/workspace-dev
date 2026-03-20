// ---------------------------------------------------------------------------
// ir-screens.ts — Screen discovery, responsive grouping, truncation, extraction
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type {
  CounterAxisAlignItems,
  PrimaryAxisAlignItems,
  ResponsiveBreakpoint,
  ScreenResponsiveIR,
  ScreenResponsiveLayoutOverride,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  ScreenResponsiveVariantIR,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import {
  isTechnicalPlaceholderText
} from "../figma-node-heuristics.js";
import {
  resolveFirstVisibleSolidPaint,
  resolveFirstVisibleGradientPaint,
  toCssGradient,
  toHexColor
} from "./ir-colors.js";
import {
  countSubtreeNodes,
  analyzeDepthPressure,
  DEFAULT_SCREEN_ELEMENT_BUDGET
} from "./ir-tree.js";
import type { ScreenDepthBudgetContext } from "./ir-tree.js";
import type { PlaceholderMatcherConfig } from "./ir-variants.js";
import type {
  FigmaNode,
  FigmaFile,
  MetricsAccumulator,
  PrototypeNavigationResolutionContext
} from "./ir-helpers.js";
import {
  DECORATIVE_NAME_PATTERN,
  clamp,
  determineElementType,
  mapPadding
} from "./ir-helpers.js";
import {
  mapElement
} from "./ir-elements.js";

export const isScreenLikeNode = (node: FigmaNode | undefined): node is FigmaNode => {
  if (!node || node.visible === false) {
    return false;
  }
  return node.type === "FRAME" || node.type === "COMPONENT";
};

export const isGenericFrameName = (name: string | undefined): boolean => {
  if (!name) {
    return true;
  }
  const normalized = name.trim();
  if (!normalized) {
    return true;
  }
  return /^t\d+$/i.test(normalized) || /^frame\s*\d*$/i.test(normalized) || /^group\s*\d*$/i.test(normalized);
};

export const unwrapScreenRoot = (candidate: FigmaNode): { node: FigmaNode; name: string } => {
  let current = candidate;
  const preferredName = candidate.name ?? `Screen_${candidate.id}`;

  for (let depth = 0; depth < 4; depth += 1) {
    if (!current.children || current.children.length !== 1) {
      break;
    }

    const child = current.children[0];
    if (!isScreenLikeNode(child)) {
      break;
    }

    const parentWidth = current.absoluteBoundingBox?.width ?? 0;
    const childWidth = child.absoluteBoundingBox?.width ?? 0;
    const parentHeight = current.absoluteBoundingBox?.height ?? 0;
    const childHeight = child.absoluteBoundingBox?.height ?? 0;

    const hasCenteringPadding =
      (current.paddingLeft ?? 0) > 0 ||
      (current.paddingRight ?? 0) > 0 ||
      (current.paddingTop ?? 0) > 0 ||
      (current.paddingBottom ?? 0) > 0;
    const isVisiblySmallerChild =
      parentWidth > 0 &&
      childWidth > 0 &&
      parentHeight > 0 &&
      childHeight > 0 &&
      (childWidth / parentWidth < 0.95 || childHeight / parentHeight < 0.95);
    const childLooksGeneric = isGenericFrameName(child.name);

    if (!hasCenteringPadding && !isVisiblySmallerChild && !childLooksGeneric) {
      break;
    }

    current = child;
  }

  const resolvedName = isGenericFrameName(current.name) ? preferredName : (current.name ?? preferredName);
  return { node: current, name: resolvedName };
};

export const collectSectionScreens = ({
  section,
  metrics
}: {
  section: FigmaNode;
  metrics: MetricsAccumulator;
}): FigmaNode[] => {
  const screens: FigmaNode[] = [];

  for (const child of section.children ?? []) {
    if (child.visible === false) {
      metrics.skippedHidden += countSubtreeNodes(child);
      continue;
    }

    if (child.type === "SECTION") {
      screens.push(...collectSectionScreens({ section: child, metrics }));
      continue;
    }

    if (child.type === "FRAME" || child.type === "COMPONENT") {
      screens.push(child);
    }
  }

  return screens;
};

export const indexScreenNodeIds = ({
  root,
  screenId,
  index
}: {
  root: FigmaNode;
  screenId: string;
  index: Map<string, string>;
}): void => {
  const stack: FigmaNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (!index.has(current.id)) {
      index.set(current.id, screenId);
    }
    for (const child of current.children ?? []) {
      stack.push(child);
    }
  }
};

export const countElements = (elements: ScreenElementIR[]): number => {
  let total = 0;
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    total += 1;
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return total;
};

export interface TruncationCandidate {
  id: string;
  elementType: ScreenElementIR["type"];
  ancestorIds: string[];
  depth: number;
  traversalIndex: number;
  area: number;
  score: number;
  mustKeep: boolean;
}

export const hasMeaningfulTextContent = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().length > 0 && !isTechnicalPlaceholderText({ text: value });
};

export const hasVisualSubstance = (element: ScreenElementIR): boolean => {
  const hasPadding = element.padding
    ? element.padding.top + element.padding.right + element.padding.bottom + element.padding.left > 0
    : false;

  return (
    typeof element.fillColor === "string" ||
    typeof element.fillGradient === "string" ||
    typeof element.strokeColor === "string" ||
    (typeof element.strokeWidth === "number" && element.strokeWidth > 0) ||
    (typeof element.cornerRadius === "number" && element.cornerRadius > 0) ||
    (typeof element.gap === "number" && element.gap > 0) ||
    hasPadding ||
    (element.vectorPaths?.length ?? 0) > 0
  );
};

export const resolveElementBasePriority = (type: ScreenElementIR["type"]): number => {
  switch (type) {
    case "button":
    case "input":
    case "select":
    case "switch":
    case "checkbox":
    case "radio":
    case "slider":
    case "rating":
    case "tab":
    case "drawer":
    case "breadcrumbs":
    case "navigation":
    case "stepper":
      return 100;
    case "text":
    case "list":
    case "table":
    case "dialog":
    case "snackbar":
    case "appbar":
    case "tooltip":
    case "card":
      return 70;
    case "chip":
    case "avatar":
    case "badge":
    case "progress":
    case "skeleton":
    case "paper":
    case "grid":
    case "stack":
    case "image":
      return 55;
    case "container":
      return 35;
    case "divider":
      return 20;
    default:
      return 35;
  }
};

export const resolveElementArea = (element: ScreenElementIR): number => {
  if (
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0 &&
    typeof element.height === "number" &&
    Number.isFinite(element.height) &&
    element.height > 0
  ) {
    return Math.max(1, element.width * element.height);
  }
  return 1;
};

export const resolveTruncationPriority = (
  element: ScreenElementIR
): {
  score: number;
  mustKeep: boolean;
} => {
  const basePriority = resolveElementBasePriority(element.type);
  const meaningfulText = hasMeaningfulTextContent(element.text);
  const visualSubstance = hasVisualSubstance(element);
  const childCount = element.children?.length ?? 0;
  const isDecorativeName = DECORATIVE_NAME_PATTERN.test(element.name);
  const emptyDecorative = childCount === 0 && !meaningfulText && !visualSubstance;
  let score = basePriority;

  if (meaningfulText) {
    score += 20;
  }
  if (visualSubstance) {
    score += 10;
  }
  score += Math.min(childCount, 5) * 2;
  if (emptyDecorative) {
    score -= 20;
  }
  if (isDecorativeName) {
    score -= 15;
  }

  return {
    score,
    mustKeep: basePriority >= 100 || (element.type === "text" && meaningfulText)
  };
};

export const collectTruncationCandidates = (elements: ScreenElementIR[]): TruncationCandidate[] => {
  const candidates: TruncationCandidate[] = [];
  const ancestorIds: string[] = [];
  let traversalIndex = 0;

  const visit = (element: ScreenElementIR, depth: number): void => {
    const { score, mustKeep } = resolveTruncationPriority(element);
    candidates.push({
      id: element.id,
      elementType: element.type,
      ancestorIds: [...ancestorIds],
      depth,
      traversalIndex,
      area: resolveElementArea(element),
      score,
      mustKeep
    });
    traversalIndex += 1;
    ancestorIds.push(element.id);
    for (const child of element.children ?? []) {
      visit(child, depth + 1);
    }
    ancestorIds.pop();
  };

  for (const element of elements) {
    visit(element, 0);
  }
  return candidates;
};

export const sortCandidatesByPriority = (candidates: TruncationCandidate[]): TruncationCandidate[] => {
  return [...candidates].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.area !== right.area) {
      return right.area - left.area;
    }
    return left.traversalIndex - right.traversalIndex;
  });
};

export const pruneElementToSelection = ({
  element,
  selectedIds
}: {
  element: ScreenElementIR;
  selectedIds: Set<string>;
}): ScreenElementIR | null => {
  if (!selectedIds.has(element.id)) {
    return null;
  }

  const nextChildren: ScreenElementIR[] = [];
  for (const child of element.children ?? []) {
    const pruned = pruneElementToSelection({ element: child, selectedIds });
    if (pruned) {
      nextChildren.push(pruned);
    }
  }

  const withoutChildren = { ...element };
  delete withoutChildren.children;
  if (nextChildren.length === 0) {
    return withoutChildren;
  }
  return {
    ...withoutChildren,
    children: nextChildren
  };
};

export const INTERACTIVE_ELEMENT_TYPES: ReadonlySet<ScreenElementIR["type"]> = new Set([
  "button", "input", "select", "switch", "checkbox", "radio", "slider", "rating",
  "tab", "drawer", "breadcrumbs", "navigation", "stepper"
]);

export const ADAPTIVE_BUDGET_MAX_SCALE = 1.5;
export const ADAPTIVE_BUDGET_INTERACTIVE_THRESHOLD = 0.15;

export const countInteractiveElements = (elements: ScreenElementIR[]): number => {
  let count = 0;
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (INTERACTIVE_ELEMENT_TYPES.has(current.type)) {
      count += 1;
    }
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return count;
};

export const resolveAdaptiveBudget = ({
  elements,
  originalCount,
  baseBudget
}: {
  elements: ScreenElementIR[];
  originalCount: number;
  baseBudget: number;
}): number => {
  if (originalCount <= baseBudget) {
    return baseBudget;
  }
  if (baseBudget < DEFAULT_SCREEN_ELEMENT_BUDGET) {
    return baseBudget;
  }
  const interactiveCount = countInteractiveElements(elements);
  const interactiveRatio = originalCount > 0 ? interactiveCount / originalCount : 0;
  if (interactiveRatio >= ADAPTIVE_BUDGET_INTERACTIVE_THRESHOLD) {
    const scale = 1 + Math.min(interactiveRatio, 0.5);
    return Math.trunc(Math.min(baseBudget * scale, baseBudget * ADAPTIVE_BUDGET_MAX_SCALE));
  }
  return baseBudget;
};

export interface TruncationResult {
  elements: ScreenElementIR[];
  retainedCount: number;
  droppedTypeCounts: Record<string, number>;
}

export const truncateElementsToBudget = ({
  elements,
  budget
}: {
  elements: ScreenElementIR[];
  budget: number;
}): TruncationResult => {
  if (budget <= 0 || elements.length === 0) {
    return {
      elements: [],
      retainedCount: 0,
      droppedTypeCounts: {}
    };
  }

  const candidates = collectTruncationCandidates(elements);
  if (candidates.length <= budget) {
    return {
      elements,
      retainedCount: candidates.length,
      droppedTypeCounts: {}
    };
  }

  const selectedIds = new Set<string>();
  let remaining = budget;
  const sortedCandidates = sortCandidatesByPriority(candidates);

  const selectCandidate = (candidate: TruncationCandidate): void => {
    if (remaining <= 0 || selectedIds.has(candidate.id)) {
      return;
    }
    const chain = [...candidate.ancestorIds, candidate.id];
    const missingChain = chain.filter((id) => !selectedIds.has(id));
    if (missingChain.length === 0 || missingChain.length > remaining) {
      return;
    }
    for (const id of missingChain) {
      selectedIds.add(id);
      remaining -= 1;
    }
  };

  for (const candidate of sortedCandidates.filter((entry) => entry.mustKeep)) {
    selectCandidate(candidate);
    if (remaining <= 0) {
      break;
    }
  }

  if (remaining > 0) {
    for (const candidate of sortedCandidates) {
      selectCandidate(candidate);
      if (remaining <= 0) {
        break;
      }
    }
  }

  if (remaining > 0 && selectedIds.size === 0) {
    const fallbackCandidate = candidates.find((candidate) => candidate.depth === 0) ?? candidates[0];
    if (fallbackCandidate) {
      selectCandidate(fallbackCandidate);
    }
  }

  const droppedTypeCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    if (!selectedIds.has(candidate.id)) {
      droppedTypeCounts[candidate.elementType] = (droppedTypeCounts[candidate.elementType] ?? 0) + 1;
    }
  }

  const truncated: ScreenElementIR[] = [];
  for (const element of elements) {
    const pruned = pruneElementToSelection({ element, selectedIds });
    if (pruned) {
      truncated.push(pruned);
    }
  }

  return {
    elements: truncated,
    retainedCount: countElements(truncated),
    droppedTypeCounts
  };
};

export const RESPONSIVE_BREAKPOINT_ORDER: ResponsiveBreakpoint[] = ["xs", "sm", "md", "lg", "xl"];
export const RESPONSIVE_BASE_BREAKPOINT_PRIORITY: ResponsiveBreakpoint[] = ["lg", "xl", "md", "sm", "xs"];

export const BREAKPOINT_SUFFIX_TOKEN_TO_VALUE: Record<string, ResponsiveBreakpoint> = {
  xs: "xs",
  mobile: "xs",
  phone: "xs",
  sm: "sm",
  tablet: "sm",
  md: "md",
  lg: "lg",
  desktop: "lg",
  xl: "xl",
  widescreen: "xl"
};

export interface ComparableLayoutState {
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap: number;
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  widthRatio?: number;
  minHeight?: number;
}

export interface TopLevelLayoutMatchEntry {
  elementId: string;
  layout: ComparableLayoutState;
}

export const RESPONSIVE_WIDTH_RATIO_MIN = 0.001;
export const RESPONSIVE_WIDTH_RATIO_MAX = 1.2;
export const RESPONSIVE_WIDTH_RATIO_EPSILON = 0.01;
export const RESPONSIVE_MIN_HEIGHT_EPSILON_PX = 1;

export const normalizeComparableWidthRatio = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = clamp(value, RESPONSIVE_WIDTH_RATIO_MIN, RESPONSIVE_WIDTH_RATIO_MAX);
  return Math.round(normalized * 1000) / 1000;
};

export const normalizeComparableMinHeight = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
};

export interface MappedScreenCandidate {
  sourceNode: FigmaNode;
  name: string;
  groupKey: string;
  breakpoint: ResponsiveBreakpoint;
  width?: number;
  height?: number;
  area: number;
  fillColor?: string;
  fillGradient?: string;
  layout: ComparableLayoutState;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  children: ScreenElementIR[];
  topLevelLayoutByMatchKey: Map<string, TopLevelLayoutMatchEntry>;
  originalElements: number;
  retainedCount: number;
  truncatedByBudget: boolean;
  droppedTypeCounts: Record<string, number>;
  depthTruncatedBranchCount: number;
  firstTruncatedDepth?: number;
}

export interface PreparedScreenCandidate {
  candidate: FigmaNode;
  normalized: { node: FigmaNode; name: string };
}

export interface ScreenGroupResolution {
  groupKey: string;
  winnersByBreakpoint: Map<ResponsiveBreakpoint, MappedScreenCandidate>;
  baseBreakpoint: ResponsiveBreakpoint;
  baseCandidate: MappedScreenCandidate;
}

export const toAsciiLower = (value: string): string => {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

export const toNameTokens = (value: string): string[] => {
  return toAsciiLower(value).match(/[a-z0-9]+/g) ?? [];
};

export const resolveScreenGroupKey = ({
  name,
  fallbackId
}: {
  name: string;
  fallbackId: string;
}): string => {
  const tokens = toNameTokens(name);
  if (tokens.length === 0) {
    const sanitizedFallback = fallbackId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return sanitizedFallback ? `screen-${sanitizedFallback}` : "screen";
  }

  const reduced = [...tokens];
  let keepReducing = true;
  while (keepReducing && reduced.length > 0) {
    keepReducing = false;
    const last = reduced[reduced.length - 1];
    const lastPair = reduced.slice(-2).join(" ");

    if (lastPair === "tablet portrait") {
      reduced.splice(-2, 2);
      keepReducing = true;
      continue;
    }
    if (lastPair === "tablet landscape") {
      reduced.splice(-2, 2);
      keepReducing = true;
      continue;
    }
    if (lastPair === "large desktop") {
      reduced.splice(-2, 2);
      keepReducing = true;
      continue;
    }

    if (last && BREAKPOINT_SUFFIX_TOKEN_TO_VALUE[last]) {
      reduced.pop();
      keepReducing = true;
    }
  }

  const normalized = (reduced.length > 0 ? reduced : tokens).join("-");
  return normalized.length > 0 ? normalized : `screen-${fallbackId}`;
};

export const resolveResponsiveBreakpointFromWidth = (width: number | undefined): ResponsiveBreakpoint => {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return "lg";
  }
  if (width >= 1536) {
    return "xl";
  }
  if (width >= 1200) {
    return "lg";
  }
  if (width >= 900) {
    return "md";
  }
  if (width >= 600) {
    return "sm";
  }
  return "xs";
};

export const toComparableRootLayout = (node: FigmaNode): ComparableLayoutState => {
  return {
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };
};

export const toComparableElementLayout = ({
  element,
  rootWidth
}: {
  element: ScreenElementIR;
  rootWidth: number | undefined;
}): ComparableLayoutState => {
  const widthRatio =
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0 &&
    typeof rootWidth === "number" &&
    Number.isFinite(rootWidth) &&
    rootWidth > 0
      ? normalizeComparableWidthRatio(element.width / rootWidth)
      : undefined;
  const minHeight = normalizeComparableMinHeight(element.height);
  return {
    layoutMode: element.layoutMode ?? "NONE",
    gap: element.gap ?? 0,
    ...(element.primaryAxisAlignItems ? { primaryAxisAlignItems: element.primaryAxisAlignItems } : {}),
    ...(element.counterAxisAlignItems ? { counterAxisAlignItems: element.counterAxisAlignItems } : {}),
    ...(widthRatio !== undefined ? { widthRatio } : {}),
    ...(minHeight !== undefined ? { minHeight } : {})
  };
};

export const toResponsiveMatchElementName = (name: string): string => {
  const tokens = toNameTokens(name);
  return tokens.length > 0 ? tokens.join("-") : "element";
};

export const buildTopLevelLayoutMatchMap = ({
  children,
  rootWidth
}: {
  children: ScreenElementIR[];
  rootWidth: number | undefined;
}): Map<string, TopLevelLayoutMatchEntry> => {
  const entries = new Map<string, TopLevelLayoutMatchEntry>();
  const occurrenceBySignature = new Map<string, number>();
  for (const child of children) {
    const signature = `${child.type}:${toResponsiveMatchElementName(child.name)}`;
    const nextIndex = (occurrenceBySignature.get(signature) ?? 0) + 1;
    occurrenceBySignature.set(signature, nextIndex);
    const matchKey = `${signature}#${nextIndex}`;
    entries.set(matchKey, {
      elementId: child.id,
      layout: toComparableElementLayout({ element: child, rootWidth })
    });
  }
  return entries;
};

export const resolveLayoutOverride = ({
  base,
  current
}: {
  base: ComparableLayoutState;
  current: ComparableLayoutState;
}): ScreenResponsiveLayoutOverride | undefined => {
  const override: ScreenResponsiveLayoutOverride = {};
  if (current.layoutMode !== base.layoutMode) {
    override.layoutMode = current.layoutMode;
  }
  if (current.gap !== base.gap) {
    override.gap = current.gap;
  }
  if (current.primaryAxisAlignItems && current.primaryAxisAlignItems !== base.primaryAxisAlignItems) {
    override.primaryAxisAlignItems = current.primaryAxisAlignItems;
  }
  if (current.counterAxisAlignItems && current.counterAxisAlignItems !== base.counterAxisAlignItems) {
    override.counterAxisAlignItems = current.counterAxisAlignItems;
  }
  if (
    current.widthRatio !== undefined &&
    (base.widthRatio === undefined || Math.abs(current.widthRatio - base.widthRatio) >= RESPONSIVE_WIDTH_RATIO_EPSILON)
  ) {
    override.widthRatio = current.widthRatio;
  }
  if (
    current.minHeight !== undefined &&
    (base.minHeight === undefined || Math.abs(current.minHeight - base.minHeight) > RESPONSIVE_MIN_HEIGHT_EPSILON_PX)
  ) {
    override.minHeight = current.minHeight;
  }
  return Object.keys(override).length > 0 ? override : undefined;
};

export const compareResponsiveWinnerPriority = (left: MappedScreenCandidate, right: MappedScreenCandidate): number => {
  if (left.originalElements !== right.originalElements) {
    return right.originalElements - left.originalElements;
  }
  if (left.area !== right.area) {
    return right.area - left.area;
  }
  return left.sourceNode.id.localeCompare(right.sourceNode.id);
};

export const mapScreenCandidate = ({
  candidate,
  normalizedCandidate,
  metrics,
  screenElementBudget,
  screenElementMaxDepth,
  placeholderMatcherConfig,
  navigationContext
}: {
  candidate: FigmaNode;
  normalizedCandidate?: { node: FigmaNode; name: string };
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
  navigationContext: PrototypeNavigationResolutionContext;
}): MappedScreenCandidate => {
  const normalized = normalizedCandidate ?? unwrapScreenRoot(candidate);
  const sourceNode = normalized.node;
  const fill = resolveFirstVisibleSolidPaint(sourceNode.fills);
  const gradientFill = resolveFirstVisibleGradientPaint(sourceNode.fills);
  const depthAnalysis = analyzeDepthPressure(sourceNode.children ?? [], determineElementType);
  const depthContext: ScreenDepthBudgetContext = {
    screenElementBudget,
    configuredMaxDepth: screenElementMaxDepth,
    mappedElementCount: 0,
    nodeCountByDepth: depthAnalysis.nodeCountByDepth,
    semanticCountByDepth: depthAnalysis.semanticCountByDepth,
    subtreeHasSemanticById: depthAnalysis.subtreeHasSemanticById,
    truncatedBranchCount: 0
  };

  const mappedChildren: ScreenElementIR[] = [];
  for (const child of sourceNode.children ?? []) {
    const mapped = mapElement({
      node: child,
      depth: 0,
      inInstanceContext: sourceNode.type === "INSTANCE" || sourceNode.type === "COMPONENT_SET",
      inInputContext: false,
      placeholderMatcherConfig,
      metrics,
      depthContext,
      navigationContext
    });
    if (mapped) {
      mappedChildren.push(mapped);
    }
  }

  const originalElements = countElements(mappedChildren);
  const adaptiveBudget = resolveAdaptiveBudget({
    elements: mappedChildren,
    originalCount: originalElements,
    baseBudget: screenElementBudget
  });
  const { elements: budgetedChildren, retainedCount, droppedTypeCounts } =
    originalElements > adaptiveBudget
      ? truncateElementsToBudget({ elements: mappedChildren, budget: adaptiveBudget })
      : { elements: mappedChildren, retainedCount: originalElements, droppedTypeCounts: {} as Record<string, number> };

  const width = sourceNode.absoluteBoundingBox?.width;
  const height = sourceNode.absoluteBoundingBox?.height;
  const area =
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
      ? width * height
      : 0;
  const fillColor = toHexColor(fill?.color, fill?.opacity);
  const fillGradient = toCssGradient(gradientFill);

  return {
    sourceNode,
    name: normalized.name,
    groupKey: resolveScreenGroupKey({
      name: normalized.name,
      fallbackId: sourceNode.id
    }),
    breakpoint: resolveResponsiveBreakpointFromWidth(width),
    ...(typeof width === "number" ? { width } : {}),
    ...(typeof height === "number" ? { height } : {}),
    area,
    ...(fillColor ? { fillColor } : {}),
    ...(fillGradient ? { fillGradient } : {}),
    layout: toComparableRootLayout(sourceNode),
    padding: mapPadding(sourceNode),
    children: budgetedChildren,
    topLevelLayoutByMatchKey: buildTopLevelLayoutMatchMap({
      children: budgetedChildren,
      rootWidth: width
    }),
    originalElements,
    retainedCount,
    truncatedByBudget: originalElements > adaptiveBudget,
    droppedTypeCounts,
    depthTruncatedBranchCount: depthContext.truncatedBranchCount,
    ...(depthContext.firstTruncatedDepth !== undefined
      ? { firstTruncatedDepth: depthContext.firstTruncatedDepth }
      : {})
  };
};

export const buildResponsiveMetadata = ({
  groupKey,
  baseBreakpoint,
  baseCandidate,
  winnersByBreakpoint
}: {
  groupKey: string;
  baseBreakpoint: ResponsiveBreakpoint;
  baseCandidate: MappedScreenCandidate;
  winnersByBreakpoint: Map<ResponsiveBreakpoint, MappedScreenCandidate>;
}): ScreenResponsiveIR | undefined => {
  if (winnersByBreakpoint.size <= 1) {
    return undefined;
  }

  const variants: ScreenResponsiveVariantIR[] = RESPONSIVE_BREAKPOINT_ORDER
    .filter((breakpoint) => winnersByBreakpoint.has(breakpoint))
    .map((breakpoint) => {
      const winner = winnersByBreakpoint.get(breakpoint) as MappedScreenCandidate;
      return {
        breakpoint,
        nodeId: winner.sourceNode.id,
        name: winner.name,
        ...(winner.width !== undefined ? { width: winner.width } : {}),
        ...(winner.height !== undefined ? { height: winner.height } : {}),
        layoutMode: winner.layout.layoutMode,
        gap: winner.layout.gap,
        ...(winner.layout.primaryAxisAlignItems ? { primaryAxisAlignItems: winner.layout.primaryAxisAlignItems } : {}),
        ...(winner.layout.counterAxisAlignItems ? { counterAxisAlignItems: winner.layout.counterAxisAlignItems } : {}),
        padding: winner.padding,
        isBase: breakpoint === baseBreakpoint
      };
    });

  const rootLayoutOverrides: ScreenResponsiveLayoutOverridesByBreakpoint = {};
  const topLevelLayoutOverrides: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint> = {};

  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    if (breakpoint === baseBreakpoint) {
      continue;
    }
    const winner = winnersByBreakpoint.get(breakpoint);
    if (!winner) {
      continue;
    }

    const rootOverride = resolveLayoutOverride({
      base: baseCandidate.layout,
      current: winner.layout
    });
    if (rootOverride) {
      rootLayoutOverrides[breakpoint] = rootOverride;
    }

    for (const [matchKey, baseEntry] of baseCandidate.topLevelLayoutByMatchKey.entries()) {
      const variantEntry = winner.topLevelLayoutByMatchKey.get(matchKey);
      if (!variantEntry) {
        continue;
      }
      const childOverride = resolveLayoutOverride({
        base: baseEntry.layout,
        current: variantEntry.layout
      });
      if (!childOverride) {
        continue;
      }
      const existing = topLevelLayoutOverrides[baseEntry.elementId] ?? {};
      existing[breakpoint] = childOverride;
      topLevelLayoutOverrides[baseEntry.elementId] = existing;
    }
  }

  return {
    groupKey,
    baseBreakpoint,
    variants,
    ...(Object.keys(rootLayoutOverrides).length > 0 ? { rootLayoutOverrides } : {}),
    ...(Object.keys(topLevelLayoutOverrides).length > 0 ? { topLevelLayoutOverrides } : {})
  };
};

export const toScreenFromCandidate = ({
  candidate,
  responsive
}: {
  candidate: MappedScreenCandidate;
  responsive?: ScreenResponsiveIR;
}): ScreenIR => {
  return {
    id: candidate.sourceNode.id,
    name: candidate.name,
    layoutMode: candidate.layout.layoutMode,
    gap: candidate.layout.gap,
    padding: candidate.padding,
    children: candidate.children,
    ...(candidate.layout.primaryAxisAlignItems ? { primaryAxisAlignItems: candidate.layout.primaryAxisAlignItems } : {}),
    ...(candidate.layout.counterAxisAlignItems ? { counterAxisAlignItems: candidate.layout.counterAxisAlignItems } : {}),
    ...(candidate.width !== undefined ? { width: candidate.width } : {}),
    ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    ...(candidate.fillColor ? { fillColor: candidate.fillColor } : {}),
    ...(candidate.fillGradient ? { fillGradient: candidate.fillGradient } : {}),
    ...(responsive ? { responsive } : {})
  };
};

export const collectScreenCandidates = ({
  file,
  metrics
}: {
  file: FigmaFile;
  metrics: MetricsAccumulator;
}): FigmaNode[] => {
  const root = file.document;
  if (!root?.children?.length) {
    return [];
  }

  const screenCandidates: FigmaNode[] = [];

  for (const page of root.children) {
    if (page.visible === false) {
      metrics.skippedHidden += countSubtreeNodes(page);
      continue;
    }

    for (const child of page.children ?? []) {
      if (child.visible === false) {
        metrics.skippedHidden += countSubtreeNodes(child);
        continue;
      }

      if (child.type === "SECTION") {
        screenCandidates.push(...collectSectionScreens({ section: child, metrics }));
        continue;
      }

      if (child.type === "FRAME" || child.type === "COMPONENT") {
        screenCandidates.push(child);
      }
    }
  }

  return screenCandidates;
};

export const prepareScreenCandidates = ({
  screenCandidates
}: {
  screenCandidates: FigmaNode[];
}): PreparedScreenCandidate[] => {
  return screenCandidates.map((candidate) => ({
    candidate,
    normalized: unwrapScreenRoot(candidate)
  }));
};

export const buildScreenNavigationContext = ({
  preparedScreenCandidates
}: {
  preparedScreenCandidates: PreparedScreenCandidate[];
}): PrototypeNavigationResolutionContext => {
  const knownScreenIds = new Set(preparedScreenCandidates.map((entry) => entry.normalized.node.id));
  const nodeIdToScreenId = new Map<string, string>();
  for (const entry of preparedScreenCandidates) {
    indexScreenNodeIds({
      root: entry.normalized.node,
      screenId: entry.normalized.node.id,
      index: nodeIdToScreenId
    });
  }
  const navigationContext: PrototypeNavigationResolutionContext = {
    nodeIdToScreenId,
    knownScreenIds
  };

  return navigationContext;
};

export const mapPreparedScreenCandidates = ({
  preparedScreenCandidates,
  metrics,
  screenElementBudget,
  screenElementMaxDepth,
  placeholderMatcherConfig,
  navigationContext
}: {
  preparedScreenCandidates: PreparedScreenCandidate[];
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
  navigationContext: PrototypeNavigationResolutionContext;
}): MappedScreenCandidate[] => {
  return preparedScreenCandidates.map((entry) =>
    mapScreenCandidate({
      candidate: entry.candidate,
      normalizedCandidate: entry.normalized,
      metrics,
      screenElementBudget,
      screenElementMaxDepth,
      placeholderMatcherConfig,
      navigationContext
    })
  );
};

export const groupMappedScreenCandidates = ({
  mappedCandidates
}: {
  mappedCandidates: MappedScreenCandidate[];
}): Map<string, MappedScreenCandidate[]> => {
  const groupedCandidates = new Map<string, MappedScreenCandidate[]>();
  for (const candidate of mappedCandidates) {
    const existing = groupedCandidates.get(candidate.groupKey) ?? [];
    existing.push(candidate);
    groupedCandidates.set(candidate.groupKey, existing);
  }

  return groupedCandidates;
};

export const selectResponsiveWinnersByBreakpoint = ({
  candidates
}: {
  candidates: MappedScreenCandidate[];
}): Map<ResponsiveBreakpoint, MappedScreenCandidate> => {
  const winnersByBreakpoint = new Map<ResponsiveBreakpoint, MappedScreenCandidate>();
  for (const candidate of candidates) {
    const existing = winnersByBreakpoint.get(candidate.breakpoint);
    if (!existing || compareResponsiveWinnerPriority(candidate, existing) < 0) {
      winnersByBreakpoint.set(candidate.breakpoint, candidate);
    }
  }
  return winnersByBreakpoint;
};

export const resolveScreenGroupResolution = ({
  groupKey,
  groupedCandidates
}: {
  groupKey: string;
  groupedCandidates: MappedScreenCandidate[];
}): ScreenGroupResolution | undefined => {
  const winnersByBreakpoint = selectResponsiveWinnersByBreakpoint({ candidates: groupedCandidates });
  const baseBreakpoint =
    RESPONSIVE_BASE_BREAKPOINT_PRIORITY.find((breakpoint) => winnersByBreakpoint.has(breakpoint)) ??
    RESPONSIVE_BREAKPOINT_ORDER.find((breakpoint) => winnersByBreakpoint.has(breakpoint));
  if (!baseBreakpoint) {
    return undefined;
  }
  const baseCandidate = winnersByBreakpoint.get(baseBreakpoint);
  if (!baseCandidate) {
    return undefined;
  }
  return {
    groupKey,
    winnersByBreakpoint,
    baseBreakpoint,
    baseCandidate
  };
};

export const appendBaseCandidateMetrics = ({
  baseCandidate,
  metrics,
  screenElementBudget,
  screenElementMaxDepth
}: {
  baseCandidate: MappedScreenCandidate;
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
}): void => {
  metrics.screenElementCounts.push({
    screenId: baseCandidate.sourceNode.id,
    screenName: baseCandidate.name,
    elements: baseCandidate.originalElements
  });
  if (baseCandidate.truncatedByBudget) {
    metrics.truncatedScreens.push({
      screenId: baseCandidate.sourceNode.id,
      screenName: baseCandidate.name,
      originalElements: baseCandidate.originalElements,
      retainedElements: baseCandidate.retainedCount,
      budget: screenElementBudget,
      ...(Object.keys(baseCandidate.droppedTypeCounts).length > 0
        ? { droppedTypeCounts: baseCandidate.droppedTypeCounts }
        : {})
    });
  }
  if (baseCandidate.depthTruncatedBranchCount > 0) {
    metrics.depthTruncatedScreens.push({
      screenId: baseCandidate.sourceNode.id,
      screenName: baseCandidate.name,
      maxDepth: screenElementMaxDepth,
      firstTruncatedDepth: baseCandidate.firstTruncatedDepth ?? screenElementMaxDepth + 1,
      truncatedBranchCount: baseCandidate.depthTruncatedBranchCount
    });
  }
};

export const assembleScreensFromGroups = ({
  groupedCandidates,
  metrics,
  screenElementBudget,
  screenElementMaxDepth
}: {
  groupedCandidates: Map<string, MappedScreenCandidate[]>;
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
}): ScreenIR[] => {
  const screens: ScreenIR[] = [];
  for (const [groupKey, grouped] of groupedCandidates.entries()) {
    const resolution = resolveScreenGroupResolution({
      groupKey,
      groupedCandidates: grouped
    });
    if (!resolution) {
      continue;
    }

    appendBaseCandidateMetrics({
      baseCandidate: resolution.baseCandidate,
      metrics,
      screenElementBudget,
      screenElementMaxDepth
    });
    const responsive = buildResponsiveMetadata({
      groupKey: resolution.groupKey,
      baseBreakpoint: resolution.baseBreakpoint,
      baseCandidate: resolution.baseCandidate,
      winnersByBreakpoint: resolution.winnersByBreakpoint
    });
    screens.push(
      toScreenFromCandidate({
        candidate: resolution.baseCandidate,
        ...(responsive ? { responsive } : {})
      })
    );
  }
  return screens;
};

export const extractScreens = ({
  file,
  metrics,
  screenElementBudget,
  screenElementMaxDepth,
  placeholderMatcherConfig
}: {
  file: FigmaFile;
  metrics: MetricsAccumulator;
  screenElementBudget: number;
  screenElementMaxDepth: number;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
}): ScreenIR[] => {
  const screenCandidates = collectScreenCandidates({ file, metrics });
  if (screenCandidates.length === 0) {
    return [];
  }

  const preparedScreenCandidates = prepareScreenCandidates({ screenCandidates });
  const navigationContext = buildScreenNavigationContext({ preparedScreenCandidates });
  const mappedCandidates = mapPreparedScreenCandidates({
    preparedScreenCandidates,
    metrics,
    screenElementBudget,
    screenElementMaxDepth,
    placeholderMatcherConfig,
    navigationContext
  });
  const groupedCandidates = groupMappedScreenCandidates({ mappedCandidates });
  return assembleScreensFromGroups({
    groupedCandidates,
    metrics,
    screenElementBudget,
    screenElementMaxDepth
  });
};
