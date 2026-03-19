// ---------------------------------------------------------------------------
// generator-interactive.ts — Tabs, dialogs, accordions, navigation bars
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import {
  firstText,
  firstTextColor,
  normalizeHexColor,
  collectTextNodes,
  literal,
  renderFallbackIconExpression,
  collectRenderedItems
} from "./generator-templates.js";
import {
  hasSubtreeName,
  hasVisualStyle,
  isIconLikeNode,
  isSemanticIconWrapper,
  pickBestIconNode,
  sortChildren,
  collectSubtreeNames,
  collectIconNodes,
  toSequentialDeltas,
  registerMuiImports,
  hasMeaningfulTextDescendants,
  toStateKey,
  normalizeInputSemanticText
} from "./generator-render.js";
import type {
  RenderContext,
  VirtualParent,
  InteractiveAccordionModel,
  InteractiveTabsModel,
  InteractiveDialogModel
} from "./generator-render.js";
import {
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  A11Y_NAVIGATION_HINTS
} from "./generator-a11y.js";
import type { DetectedTabInterfacePattern, DetectedDialogOverlayPattern, DialogActionModel, RenderedItem } from "./generator-templates.js";
import { resolvePrototypeNavigationBinding, toRouterLinkProps } from "./generator-navigation.js";


export const ensureTabsStateModel = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): InteractiveTabsModel => {
  const existing = context.tabs.find((candidate) => candidate.elementId === element.id);
  if (existing) {
    return existing;
  }
  const created: InteractiveTabsModel = {
    elementId: element.id,
    stateId: context.tabs.length + 1
  };
  context.tabs.push(created);
  return created;
};

export const ensureDialogStateModel = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): InteractiveDialogModel => {
  const existing = context.dialogs.find((candidate) => candidate.elementId === element.id);
  if (existing) {
    return existing;
  }
  const created: InteractiveDialogModel = {
    elementId: element.id,
    stateId: context.dialogs.length + 1
  };
  context.dialogs.push(created);
  return created;
};

const ACCORDION_NAME_HINTS = ["accordion", "accordionsummarycontent", "collapsewrapper"];

const hasAnySubtreeName = (element: ScreenElementIR, patterns: string[]): boolean => {
  return patterns.some((pattern) => hasSubtreeName(element, pattern));
};

export const isLikelyAccordionContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  return hasAnySubtreeName(element, ACCORDION_NAME_HINTS) && hasSubtreeName(element, "collapsewrapper");
};

export const registerInteractiveAccordion = ({
  context,
  element,
  defaultExpanded
}: {
  context: RenderContext;
  element: ScreenElementIR;
  defaultExpanded: boolean;
}): InteractiveAccordionModel => {
  const key = toStateKey(element);
  const existing = context.accordions.find((accordion) => accordion.key === key);
  if (existing) {
    return existing;
  }
  const created: InteractiveAccordionModel = {
    key,
    defaultExpanded
  };
  context.accordions.push(created);
  return created;
};

const NAVIGATION_BAR_CANDIDATE_TYPES = new Set<ScreenElementIR["type"]>(["container", "stack", "table"]);
export const NAVIGATION_BAR_TOP_LEVEL_DEPTH = 3;
const NAVIGATION_BAR_MIN_HEIGHT_PX = 40;
const NAVIGATION_BAR_MAX_HEIGHT_PX = 180;
const NAVIGATION_BAR_MIN_WIDTH_RATIO = 0.9;
const NAVIGATION_BAR_EDGE_PROXIMITY_PX = 56;
const NAVIGATION_BAR_MIN_RENDERABLE_BOTTOM_ACTIONS = 2;
const NAVIGATION_BAR_DATA_TABLE_MIN_ROWS = 2;
const NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS = 2;
const NAVIGATION_BAR_DATA_TABLE_TEXT_CELL_RATIO_MIN = 0.75;
const TAB_PATTERN_MIN_ACTIONS = 2;
const TAB_PATTERN_MAX_ACTIONS = 8;
const TAB_PATTERN_ROW_CENTER_TOLERANCE_PX = 16;
const TAB_PATTERN_GAP_TOLERANCE_RATIO = 0.65;
const TAB_PATTERN_GAP_TOLERANCE_PX = 24;
const TAB_PATTERN_PANEL_MIN_CONTENT_HEIGHT_PX = 24;
const TAB_PATTERN_STRIP_NAME_HINTS = ["tab", "tabs", "tab bar", "tabbar"];
const DIALOG_PATTERN_MIN_WIDTH_RATIO = 0.85;
const DIALOG_PATTERN_MIN_HEIGHT_RATIO = 0.55;
const DIALOG_PATTERN_PANEL_MIN_WIDTH_RATIO = 0.3;
const DIALOG_PATTERN_PANEL_MAX_WIDTH_RATIO = 0.95;
const DIALOG_PATTERN_PANEL_MIN_HEIGHT_RATIO = 0.2;
const DIALOG_PATTERN_PANEL_MAX_HEIGHT_RATIO = 0.95;
const DIALOG_PATTERN_CENTER_TOLERANCE_RATIO = 0.2;
const DIALOG_PATTERN_CENTER_TOLERANCE_PX = 80;
const DIALOG_ACTION_HINTS = ["ok", "confirm", "save", "cancel", "discard", "apply", "close", "bestätigen", "speichern", "abbrechen"];
const DIALOG_CLOSE_HINTS = ["close", "dismiss", "cancel", "x", "schließen", "abbrechen"];

export interface ListRowAnalysis {
  node: ScreenElementIR;
  primaryText: string;
  secondaryText?: string;
  leadingAvatarNode?: ScreenElementIR;
  leadingIconNode?: ScreenElementIR;
  trailingActionNode?: ScreenElementIR;
  hasLeadingVisual: boolean;
  hasTrailingAction: boolean;
  structureSignature: string;
}

interface ListRowCollection {
  rowNodes: ScreenElementIR[];
  hasInterItemDivider: boolean;
}

interface DetectedListPattern {
  rows: ListRowAnalysis[];
  hasInterItemDivider: boolean;
}

const LIST_PATTERN_MIN_ROWS = 3;
const LIST_PATTERN_VERTICAL_DELTA_MIN_PX = 8;
const LIST_PATTERN_VERTICAL_DELTA_RATIO_TOLERANCE = 0.35;
const LIST_PATTERN_VERTICAL_DELTA_ABSOLUTE_TOLERANCE_PX = 12;
const LIST_ACTION_RIGHT_REGION_RATIO = 0.62;
const LIST_ACTION_NAME_HINTS = [
  "action",
  "more",
  "menu",
  "next",
  "arrow",
  "edit",
  "delete",
  "remove",
  "open",
  "close",
  "chevron"
];

const isDividerLikeListSeparator = (element: ScreenElementIR): boolean => {
  if (element.type === "divider") {
    return true;
  }
  if ((element.children?.length ?? 0) > 0) {
    return false;
  }
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const hasVisualSignal = Boolean(element.fillColor || element.strokeColor);
  if (!hasVisualSignal) {
    return false;
  }
  const horizontalLine = width >= 16 && height > 0 && height <= 2;
  const verticalLine = height >= 16 && width > 0 && width <= 2;
  return horizontalLine || verticalLine;
};

const isAvatarLikeListNode = (element: ScreenElementIR): boolean => {
  if (element.type === "avatar") {
    return true;
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  return normalizedName.includes("avatar");
};

const isListActionLikeNode = (element: ScreenElementIR): boolean => {
  if (element.prototypeNavigation) {
    return true;
  }
  if (element.type === "button" || element.type === "switch" || element.type === "checkbox" || element.type === "radio") {
    return true;
  }
  if (isIconLikeNode(element) || isSemanticIconWrapper(element)) {
    return true;
  }
  if (pickBestIconNode(element)) {
    return true;
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  return LIST_ACTION_NAME_HINTS.some((hint) => normalizedName.includes(hint));
};

const toListNodeStartX = (node: ScreenElementIR): number | undefined => {
  if (typeof node.x !== "number" || !Number.isFinite(node.x)) {
    return undefined;
  }
  return node.x;
};

const toListNodeEndX = (node: ScreenElementIR): number | undefined => {
  if (typeof node.x !== "number" || !Number.isFinite(node.x)) {
    return undefined;
  }
  if (typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0) {
    return node.x + node.width;
  }
  return node.x;
};

const toListRowHorizontalBounds = ({
  children
}: {
  children: ScreenElementIR[];
}): { minX: number; maxX: number } | undefined => {
  const startValues = children.map(toListNodeStartX).filter((value): value is number => typeof value === "number");
  const endValues = children.map(toListNodeEndX).filter((value): value is number => typeof value === "number");
  if (startValues.length === 0 || endValues.length === 0) {
    return undefined;
  }
  const minX = Math.min(...startValues);
  const maxX = Math.max(...endValues);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
    return undefined;
  }
  return { minX, maxX };
};

const isRightAlignedListActionCandidate = ({
  node,
  bounds
}: {
  node: ScreenElementIR;
  bounds: { minX: number; maxX: number } | undefined;
}): boolean => {
  if (!bounds) {
    return false;
  }
  const nodeStartX = toListNodeStartX(node);
  if (typeof nodeStartX !== "number") {
    return false;
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const threshold = bounds.minX + width * LIST_ACTION_RIGHT_REGION_RATIO;
  return nodeStartX >= threshold;
};

const collectSubtreeNodeIds = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element.id, ...(element.children ?? []).flatMap((child) => collectSubtreeNodeIds(child, visited))];
};

export const analyzeListRow = ({
  row,
  generationLocale
}: {
  row: ScreenElementIR;
  generationLocale: string | undefined;
}): ListRowAnalysis => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  const sortedChildren = sortChildren(row.children ?? [], row.layoutMode ?? "NONE", sortOptions).filter(
    (child) => !isDividerLikeListSeparator(child)
  );
  const bounds = toListRowHorizontalBounds({ children: sortedChildren });

  let trailingActionNode: ScreenElementIR | undefined;
  for (const child of [...sortedChildren].reverse()) {
    if (!isListActionLikeNode(child)) {
      continue;
    }
    if (!isRightAlignedListActionCandidate({ node: child, bounds })) {
      continue;
    }
    trailingActionNode = child;
    break;
  }

  const leadingAvatarNode = sortedChildren.find((child) => child.id !== trailingActionNode?.id && isAvatarLikeListNode(child));
  const leadingIconNode = leadingAvatarNode
    ? undefined
    : sortedChildren.find((child) => {
        if (child.id === trailingActionNode?.id) {
          return false;
        }
        if (isIconLikeNode(child) || isSemanticIconWrapper(child)) {
          return true;
        }
        if (child.type === "container") {
          return Boolean(pickBestIconNode(child));
        }
        return false;
      });

  const excludedTextNodeIds = new Set<string>();
  if (trailingActionNode) {
    for (const nodeId of collectSubtreeNodeIds(trailingActionNode)) {
      excludedTextNodeIds.add(nodeId);
    }
  }
  if (leadingAvatarNode) {
    for (const nodeId of collectSubtreeNodeIds(leadingAvatarNode)) {
      excludedTextNodeIds.add(nodeId);
    }
  }

  const textNodes = collectTextNodes(row)
    .filter((node) => !excludedTextNodeIds.has(node.id))
    .sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0));
  const textValues = textNodes.map((node) => node.text?.trim() ?? "").filter((value) => value.length > 0);
  const fallbackLabel = firstText(row)?.trim() || row.name || "Item";
  const primaryText = textValues[0] ?? fallbackLabel;
  const secondaryText = textValues[1] && textValues[1] !== primaryText ? textValues[1] : undefined;
  const hasLeadingVisual = Boolean(leadingAvatarNode || leadingIconNode);
  const hasTrailingAction = Boolean(trailingActionNode);
  const leadingSignature = leadingAvatarNode ? "avatar" : leadingIconNode ? "icon" : "none";
  const textSignature = textValues.length >= 2 ? "text2" : textValues.length === 1 ? "text1" : "text0";
  const actionSignature = hasTrailingAction ? "action" : "none";

  return {
    node: row,
    primaryText,
    ...(secondaryText ? { secondaryText } : {}),
    ...(leadingAvatarNode ? { leadingAvatarNode } : {}),
    ...(leadingIconNode ? { leadingIconNode } : {}),
    ...(trailingActionNode ? { trailingActionNode } : {}),
    hasLeadingVisual,
    hasTrailingAction,
    structureSignature: `${leadingSignature}|${textSignature}|${actionSignature}`
  };
};

export const collectListRows = (element: ScreenElementIR, generationLocale?: string): ListRowCollection => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", sortOptions);
  const rowNodes: ScreenElementIR[] = [];
  let hasInterItemDivider = false;
  let seenRow = false;
  for (const child of sortedChildren) {
    if (isDividerLikeListSeparator(child)) {
      if (seenRow) {
        hasInterItemDivider = true;
      }
      continue;
    }
    rowNodes.push(child);
    seenRow = true;
  }
  return {
    rowNodes,
    hasInterItemDivider
  };
};

export const detectRepeatedListPattern = ({
  element,
  generationLocale
}: {
  element: ScreenElementIR;
  generationLocale: string;
}): DetectedListPattern | undefined => {
  if (element.type !== "container") {
    return undefined;
  }
  const collectedRows = collectListRows(element, generationLocale);
  if (collectedRows.rowNodes.length < LIST_PATTERN_MIN_ROWS) {
    return undefined;
  }

  const rowAnalyses = collectedRows.rowNodes.map((row) => analyzeListRow({ row, generationLocale }));
  const baselineSignature = rowAnalyses[0]?.structureSignature;
  if (!baselineSignature || rowAnalyses.some((analysis) => analysis.structureSignature !== baselineSignature)) {
    return undefined;
  }
  if (!rowAnalyses[0]?.hasLeadingVisual && !rowAnalyses[0]?.hasTrailingAction) {
    return undefined;
  }
  if (rowAnalyses.some((analysis) => analysis.primaryText.trim().length === 0)) {
    return undefined;
  }

  const rowYValues = collectedRows.rowNodes
    .map((row) => row.y)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (rowYValues.length !== collectedRows.rowNodes.length) {
    return undefined;
  }
  const yDeltas = toSequentialDeltas(rowYValues);
  if (yDeltas.some((delta) => delta < LIST_PATTERN_VERTICAL_DELTA_MIN_PX)) {
    return undefined;
  }
  const averageDelta = yDeltas.reduce((total, delta) => total + delta, 0) / yDeltas.length;
  const tolerance = Math.max(
    LIST_PATTERN_VERTICAL_DELTA_ABSOLUTE_TOLERANCE_PX,
    averageDelta * LIST_PATTERN_VERTICAL_DELTA_RATIO_TOLERANCE
  );
  if (yDeltas.some((delta) => Math.abs(delta - averageDelta) > tolerance)) {
    return undefined;
  }

  return {
    rows: rowAnalyses,
    hasInterItemDivider: collectedRows.hasInterItemDivider
  };
};

export const toListSecondaryActionExpression = ({
  actionNode,
  context
}: {
  actionNode: ScreenElementIR | undefined;
  context: RenderContext;
}): string | undefined => {
  if (!actionNode) {
    return undefined;
  }
  const actionIconNode = pickBestIconNode(actionNode) ?? (isIconLikeNode(actionNode) ? actionNode : undefined);
  if (!actionIconNode) {
    return undefined;
  }
  registerMuiImports(context, "IconButton");
  const ariaLabel = resolveIconButtonAriaLabel({ element: actionNode, iconNode: actionIconNode });
  const navigation = resolvePrototypeNavigationBinding({ element: actionNode, context });
  const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
  const iconExpression = renderFallbackIconExpression({
    element: actionIconNode,
    parent: { name: actionNode.name },
    context,
    ariaHidden: true,
    extraEntries: [["fontSize", literal("inherit")]]
  });
  return `<IconButton edge="end" aria-label=${literal(ariaLabel)}${linkProps}>${iconExpression}</IconButton>`;
};

const hasNavigationNameHintInSubtree = (element: ScreenElementIR): boolean => {
  const semanticCandidates = [element.name, element.text ?? "", ...collectSubtreeNames(element)];
  return semanticCandidates.some((candidate) => {
    const normalized = normalizeInputSemanticText(candidate);
    if (!normalized) {
      return false;
    }
    return A11Y_NAVIGATION_HINTS.some((hint) => normalized.includes(hint));
  });
};

const hasPrototypeNavigationInSubtree = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): boolean => {
  if (visited.has(element)) {
    return false;
  }
  visited.add(element);
  if (element.prototypeNavigation) {
    return true;
  }
  return (element.children ?? []).some((child) => hasPrototypeNavigationInSubtree(child, visited));
};

const toFiniteNumber = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const isLikelyStructuredDataTable = ({
  element,
  generationLocale
}: {
  element: ScreenElementIR;
  generationLocale: string;
}): boolean => {
  const rows = sortChildren(element.children ?? [], element.layoutMode ?? "VERTICAL", {
    generationLocale
  })
    .map((row) => {
      const rowChildren = sortChildren(row.children ?? [], row.layoutMode ?? "HORIZONTAL", {
        generationLocale
      });
      return rowChildren.length > 0 ? rowChildren : [row];
    })
    .filter((row) => row.length > 0);

  if (rows.length < NAVIGATION_BAR_DATA_TABLE_MIN_ROWS) {
    return false;
  }

  const columnCounts = rows.map((row) => row.length);
  const minColumns = Math.min(...columnCounts);
  const maxColumns = Math.max(...columnCounts);
  if (minColumns < NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS || maxColumns - minColumns > 1) {
    return false;
  }

  const flattenedCells = rows.flat();
  if (flattenedCells.length < NAVIGATION_BAR_DATA_TABLE_MIN_ROWS * NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS) {
    return false;
  }
  const textCellCount = flattenedCells.filter((cell) => Boolean(firstText(cell)?.trim() || cell.type === "text")).length;
  return textCellCount / flattenedCells.length >= NAVIGATION_BAR_DATA_TABLE_TEXT_CELL_RATIO_MIN;
};

const isRenderableBottomNavigationAction = ({
  action,
  context
}: {
  action: RenderedItem;
  context: RenderContext;
}): boolean => {
  if (action.label.trim().length === 0) {
    return false;
  }
  if (action.node.type === "button" || action.node.type === "navigation" || action.node.type === "tab") {
    return true;
  }
  if (action.node.prototypeNavigation) {
    return true;
  }
  if (isIconLikeNode(action.node) || isSemanticIconWrapper(action.node) || Boolean(pickBestIconNode(action.node))) {
    return true;
  }
  if (hasInteractiveDescendants({ element: action.node, context })) {
    return true;
  }
  return hasMeaningfulTextDescendants({ element: action.node, context });
};

export const isRenderableTabAction = ({
  action,
  context
}: {
  action: RenderedItem;
  context: RenderContext;
}): boolean => {
  if (action.label.trim().length === 0) {
    return false;
  }
  if (action.node.type === "text" || action.node.type === "tab" || action.node.type === "button") {
    return true;
  }
  if (action.node.prototypeNavigation) {
    return true;
  }
  return hasMeaningfulTextDescendants({ element: action.node, context });
};

const hasHorizontalRowAlignment = ({
  nodes,
  layoutMode
}: {
  nodes: ScreenElementIR[];
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
}): boolean => {
  if (nodes.length < TAB_PATTERN_MIN_ACTIONS) {
    return false;
  }
  if (layoutMode === "HORIZONTAL") {
    return true;
  }
  const centerYValues = nodes
    .map((node) => {
      const y = toFiniteNumber(node.y);
      const height = toFiniteNumber(node.height);
      if (y === undefined) {
        return undefined;
      }
      return y + (height ?? 0) / 2;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (centerYValues.length !== nodes.length) {
    return false;
  }
  const minCenterY = Math.min(...centerYValues);
  const maxCenterY = Math.max(...centerYValues);
  return maxCenterY - minCenterY <= TAB_PATTERN_ROW_CENTER_TOLERANCE_PX;
};

const hasUniformHorizontalSpacing = (nodes: ScreenElementIR[]): boolean => {
  const sortedNodes = [...nodes].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  const centerXValues = sortedNodes
    .map((node) => {
      const x = toFiniteNumber(node.x);
      const width = toFiniteNumber(node.width);
      if (x === undefined) {
        return undefined;
      }
      return x + (width ?? 0) / 2;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (centerXValues.length !== sortedNodes.length) {
    return false;
  }
  const gaps = toSequentialDeltas(centerXValues);
  if (gaps.length === 0 || gaps.some((gap) => gap <= 0)) {
    return false;
  }
  if (gaps.length === 1) {
    return true;
  }
  const averageGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const maxDelta = Math.max(...gaps.map((gap) => Math.abs(gap - averageGap)));
  return maxDelta <= Math.max(TAB_PATTERN_GAP_TOLERANCE_PX, averageGap * TAB_PATTERN_GAP_TOLERANCE_RATIO);
};

const hasTabNameHint = (element: ScreenElementIR): boolean => {
  const normalizedName = normalizeInputSemanticText(element.name);
  return TAB_PATTERN_STRIP_NAME_HINTS.some((hint) => normalizedName.includes(hint));
};

const hasUnderlineIndicatorInTabStrip = ({
  tabStripNode,
  tabActionNodeIds
}: {
  tabStripNode: ScreenElementIR;
  tabActionNodeIds: Set<string>;
}): boolean => {
  const stripY = toFiniteNumber(tabStripNode.y);
  const stripHeight = toFiniteNumber(tabStripNode.height);
  const stripWidth = toFiniteNumber(tabStripNode.width);
  const stripBottom = stripY !== undefined && stripHeight !== undefined ? stripY + stripHeight : undefined;
  return (tabStripNode.children ?? []).some((candidate) => {
    if (tabActionNodeIds.has(candidate.id)) {
      return false;
    }
    const normalizedName = normalizeInputSemanticText(candidate.name);
    if (normalizedName.includes("indicator") || normalizedName.includes("underline")) {
      return true;
    }
    if (isDividerLikeListSeparator(candidate)) {
      const candidateHeight = toFiniteNumber(candidate.height);
      const candidateWidth = toFiniteNumber(candidate.width);
      const candidateY = toFiniteNumber(candidate.y);
      if (
        stripBottom === undefined ||
        candidateHeight === undefined ||
        candidateWidth === undefined ||
        candidateY === undefined
      ) {
        return false;
      }
      if (stripWidth !== undefined && candidateWidth >= stripWidth * 0.9) {
        return false;
      }
      return Math.abs(stripBottom - (candidateY + candidateHeight)) <= 12;
    }
    const candidateHeight = toFiniteNumber(candidate.height);
    const candidateWidth = toFiniteNumber(candidate.width);
    const candidateY = toFiniteNumber(candidate.y);
    if (
      candidateHeight === undefined ||
      candidateWidth === undefined ||
      candidateY === undefined ||
      !candidate.fillColor ||
      candidateHeight > 4
    ) {
      return false;
    }
    if (stripWidth !== undefined && candidateWidth >= stripWidth * 0.9) {
      return false;
    }
    if (stripBottom === undefined) {
      return false;
    }
    return Math.abs(stripBottom - (candidateY + candidateHeight)) <= 12;
  });
};

const hasTabActiveVisualSignal = ({
  tabStripNode,
  tabItems
}: {
  tabStripNode: ScreenElementIR;
  tabItems: RenderedItem[];
}): boolean => {
  const colorSignals = new Set<string>();
  const fontWeights: number[] = [];
  for (const tabItem of tabItems) {
    const textNode = collectTextNodes(tabItem.node)[0];
    const color = normalizeHexColor(firstTextColor(tabItem.node) ?? tabItem.node.fillColor);
    if (color) {
      colorSignals.add(color);
    }
    const fontWeight = toFiniteNumber(textNode?.fontWeight ?? tabItem.node.fontWeight);
    if (fontWeight !== undefined) {
      fontWeights.push(fontWeight);
    }
  }
  const hasColorDelta = colorSignals.size >= 2;
  const hasWeightDelta = fontWeights.length >= 2 && Math.max(...fontWeights) - Math.min(...fontWeights) >= 120;
  const hasUnderlineSignal = hasUnderlineIndicatorInTabStrip({
    tabStripNode,
    tabActionNodeIds: new Set(tabItems.map((tabItem) => tabItem.node.id))
  });
  return hasColorDelta || hasWeightDelta || hasUnderlineSignal;
};

const toTabStripPatternCandidate = ({
  tabStripNode,
  context
}: {
  tabStripNode: ScreenElementIR;
  context: RenderContext;
}): { tabItems: RenderedItem[] } | undefined => {
  const tabItems = collectRenderedItems(tabStripNode, context.generationLocale).filter((action) =>
    isRenderableTabAction({
      action,
      context
    })
  );
  if (tabItems.length < TAB_PATTERN_MIN_ACTIONS || tabItems.length > TAB_PATTERN_MAX_ACTIONS) {
    return undefined;
  }
  const tabActionNodes = tabItems.map((tabItem) => tabItem.node);
  if (
    !hasHorizontalRowAlignment({
      nodes: tabActionNodes,
      layoutMode: tabStripNode.layoutMode ?? "NONE"
    })
  ) {
    return undefined;
  }
  if (!hasUniformHorizontalSpacing(tabActionNodes)) {
    return undefined;
  }
  const tabActionNodeIds = new Set(tabItems.map((tabItem) => tabItem.node.id));
  const hasUnderlineSignal = hasUnderlineIndicatorInTabStrip({
    tabStripNode,
    tabActionNodeIds
  });
  const hasTabHintSignal = hasTabNameHint(tabStripNode) || tabItems.some((tabItem) => hasTabNameHint(tabItem.node));
  const hasInteractiveTabSignal = tabItems.some((tabItem) => {
    if (tabItem.node.type === "button" || tabItem.node.prototypeNavigation) {
      return true;
    }
    return hasInteractiveDescendants({
      element: tabItem.node,
      context
    });
  });
  if (!hasTabHintSignal && !hasInteractiveTabSignal && !hasUnderlineSignal) {
    return undefined;
  }
  if (
    !hasTabActiveVisualSignal({
      tabStripNode,
      tabItems
    })
  ) {
    return undefined;
  }
  return { tabItems };
};

const resolveTabPanelNodes = ({
  hostElement,
  tabStripNode,
  tabCount,
  context
}: {
  hostElement: ScreenElementIR;
  tabStripNode: ScreenElementIR;
  tabCount: number;
  context: RenderContext;
}): ScreenElementIR[] => {
  if (hostElement.id === tabStripNode.id) {
    return [];
  }
  const siblings = sortChildren(hostElement.children ?? [], hostElement.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  }).filter((child) => child.id !== tabStripNode.id && !isDividerLikeListSeparator(child));
  if (siblings.length !== tabCount) {
    return [];
  }

  const stripY = toFiniteNumber(tabStripNode.y);
  const stripHeight = toFiniteNumber(tabStripNode.height);
  const stripBottom = stripY !== undefined && stripHeight !== undefined ? stripY + stripHeight : undefined;
  const hasInvalidPanels = siblings.some((candidate) => {
    const hasMeaningfulContent =
      hasMeaningfulTextDescendants({
        element: candidate,
        context
      }) || (candidate.children?.length ?? 0) > 0;
    if (!hasMeaningfulContent) {
      return true;
    }
    const candidateHeight = toFiniteNumber(candidate.height);
    if (candidateHeight !== undefined && candidateHeight < TAB_PATTERN_PANEL_MIN_CONTENT_HEIGHT_PX) {
      return true;
    }
    if (stripBottom === undefined) {
      return false;
    }
    const candidateY = toFiniteNumber(candidate.y);
    return candidateY !== undefined && candidateY < stripBottom - 8;
  });
  if (hasInvalidPanels) {
    return [];
  }
  return siblings;
};

export const detectTabInterfacePattern = ({
  element,
  depth,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
}): DetectedTabInterfacePattern | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const dataTableLike = isLikelyStructuredDataTable({
    element,
    generationLocale: context.generationLocale
  });

  const directTabStripCandidate = toTabStripPatternCandidate({
    tabStripNode: element,
    context
  });
  if (directTabStripCandidate) {
    const hasPrimarySignal =
      hasTabNameHint(element) ||
      hasNavigationNameHintInSubtree(element) ||
      directTabStripCandidate.tabItems.some((tabItem) => tabItem.node.prototypeNavigation);
    if (dataTableLike && !hasPrimarySignal) {
      return undefined;
    }
    return {
      tabStripNode: element,
      tabItems: directTabStripCandidate.tabItems,
      panelNodes: []
    };
  }

  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  for (const child of sortedChildren) {
    const stripCandidate = toTabStripPatternCandidate({
      tabStripNode: child,
      context
    });
    if (!stripCandidate) {
      continue;
    }

    const hasPrimarySignal =
      hasTabNameHint(element) ||
      hasTabNameHint(child) ||
      stripCandidate.tabItems.some((tabItem) => tabItem.node.prototypeNavigation) ||
      hasNavigationNameHintInSubtree(child);
    if (dataTableLike && !hasPrimarySignal) {
      continue;
    }

    const panelNodes = resolveTabPanelNodes({
      hostElement: element,
      tabStripNode: child,
      tabCount: stripCandidate.tabItems.length,
      context
    });
    return {
      tabStripNode: child,
      tabItems: stripCandidate.tabItems,
      panelNodes
    };
  }

  return undefined;
};

const toHexColorAlpha = (value: string | undefined): number | undefined => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return undefined;
  }
  const payload = normalized.slice(1);
  if (payload.length !== 8) {
    return undefined;
  }
  const alpha = Number.parseInt(payload.slice(6, 8), 16);
  if (!Number.isFinite(alpha)) {
    return undefined;
  }
  return alpha / 255;
};

const hasSemiTransparentOverlaySignal = (element: ScreenElementIR): boolean => {
  const opacity = toFiniteNumber(element.opacity);
  if (opacity !== undefined && opacity < 0.96) {
    return true;
  }
  const fillAlpha = toHexColorAlpha(element.fillColor);
  return fillAlpha !== undefined && fillAlpha < 0.96;
};

const collectSubtreeElements = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element, ...(element.children ?? []).flatMap((child) => collectSubtreeElements(child, visited))];
};

const toElementBounds = (
  element: ScreenElementIR
):
  | {
      x: number;
      y: number;
      width: number;
      height: number;
      centerX: number;
      centerY: number;
    }
  | undefined => {
  const x = toFiniteNumber(element.x);
  const y = toFiniteNumber(element.y);
  const width = toFiniteNumber(element.width);
  const height = toFiniteNumber(element.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2
  };
};

const hasDialogHint = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = normalizeInputSemanticText(value);
  return normalized.includes("dialog") || normalized.includes("modal") || normalized.includes("overlay");
};

const isDialogActionLikeNode = ({
  node,
  context
}: {
  node: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (node.type === "button") {
    return true;
  }
  if (node.prototypeNavigation) {
    return true;
  }
  const semanticSignals = [node.name, firstText(node) ?? node.text ?? ""]
    .map((value) => normalizeInputSemanticText(value))
    .filter((value) => value.length > 0);
  if (semanticSignals.some((signal) => DIALOG_ACTION_HINTS.some((hint) => signal.includes(hint)))) {
    return true;
  }
  return hasInteractiveDescendants({ element: node, context });
};

const isDialogCloseControlNode = ({
  node,
  panelNode
}: {
  node: ScreenElementIR;
  panelNode: ScreenElementIR;
}): boolean => {
  const semanticSignals = [node.name, firstText(node) ?? node.text ?? ""]
    .map((value) => normalizeInputSemanticText(value))
    .filter((value) => value.length > 0);
  const hasCloseHint = semanticSignals.some((signal) => DIALOG_CLOSE_HINTS.some((hint) => signal.includes(hint)));
  const isControlLike =
    node.type === "button" || isIconLikeNode(node) || isSemanticIconWrapper(node) || Boolean(pickBestIconNode(node));
  if (!hasCloseHint && !isControlLike) {
    return false;
  }

  const panelBounds = toElementBounds(panelNode);
  const nodeBounds = toElementBounds(node);
  if (!panelBounds || !nodeBounds) {
    return hasCloseHint;
  }
  const isTopRight =
    nodeBounds.centerX >= panelBounds.x + panelBounds.width * 0.58 &&
    nodeBounds.centerY <= panelBounds.y + panelBounds.height * 0.35;
  return hasCloseHint || (isControlLike && isTopRight);
};

const resolveDialogActionModels = ({
  panelNode,
  context
}: {
  panelNode: ScreenElementIR;
  context: RenderContext;
}): {
  actionModels: DialogActionModel[];
  actionHostNodeId?: string;
} => {
  const panelChildren = sortChildren(panelNode.children ?? [], panelNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const bottomToTopChildren = [...panelChildren].reverse();
  for (const child of bottomToTopChildren) {
    if (child.layoutMode !== "HORIZONTAL") {
      continue;
    }
    const actionItems = collectRenderedItems(child, context.generationLocale).filter((item) =>
      isDialogActionLikeNode({
        node: item.node,
        context
      })
    );
    if (actionItems.length < TAB_PATTERN_MIN_ACTIONS) {
      continue;
    }
    return {
      actionHostNodeId: child.id,
      actionModels: actionItems.map((item, index) => ({
        id: item.id,
        label: item.label,
        isPrimary: index === actionItems.length - 1
      }))
    };
  }

  const directActionNodes = panelChildren.filter((child) =>
    isDialogActionLikeNode({
      node: child,
      context
    })
  );
  if (directActionNodes.length === 0) {
    return { actionModels: [] };
  }
  return {
    actionModels: directActionNodes.map((node, index) => ({
      id: node.id,
      label: firstText(node)?.trim() || node.name || `Action ${index + 1}`,
      isPrimary: index === directActionNodes.length - 1
    }))
  };
};

const resolveCenteredDialogPanelNode = ({
  overlayNode,
  context
}: {
  overlayNode: ScreenElementIR;
  context: RenderContext;
}): ScreenElementIR | undefined => {
  const overlayBounds = toElementBounds(overlayNode);
  if (!overlayBounds) {
    return undefined;
  }
  const sortedChildren = sortChildren(overlayNode.children ?? [], overlayNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  let bestMatch: {
    node: ScreenElementIR;
    score: number;
  } | undefined;
  for (const child of sortedChildren) {
    const childBounds = toElementBounds(child);
    if (!childBounds) {
      continue;
    }
    const widthRatio = childBounds.width / overlayBounds.width;
    const heightRatio = childBounds.height / overlayBounds.height;
    if (
      widthRatio < DIALOG_PATTERN_PANEL_MIN_WIDTH_RATIO ||
      widthRatio > DIALOG_PATTERN_PANEL_MAX_WIDTH_RATIO ||
      heightRatio < DIALOG_PATTERN_PANEL_MIN_HEIGHT_RATIO ||
      heightRatio > DIALOG_PATTERN_PANEL_MAX_HEIGHT_RATIO
    ) {
      continue;
    }

    const centerDeltaX = Math.abs(childBounds.centerX - overlayBounds.centerX);
    const centerDeltaY = Math.abs(childBounds.centerY - overlayBounds.centerY);
    const maxCenterDeltaX = Math.max(DIALOG_PATTERN_CENTER_TOLERANCE_PX, overlayBounds.width * DIALOG_PATTERN_CENTER_TOLERANCE_RATIO);
    const maxCenterDeltaY = Math.max(DIALOG_PATTERN_CENTER_TOLERANCE_PX, overlayBounds.height * DIALOG_PATTERN_CENTER_TOLERANCE_RATIO);
    if (centerDeltaX > maxCenterDeltaX || centerDeltaY > maxCenterDeltaY) {
      continue;
    }

    const hasVisualSignal = hasVisualStyle(child) || Boolean(child.fillColor || child.strokeColor || child.elevation);
    if (!hasVisualSignal) {
      continue;
    }
    const hasContentSignal =
      hasMeaningfulTextDescendants({
        element: child,
        context
      }) || (child.children?.length ?? 0) > 0;
    if (!hasContentSignal) {
      continue;
    }
    const score =
      centerDeltaX + centerDeltaY - Math.min(childBounds.width / overlayBounds.width, childBounds.height / overlayBounds.height);
    if (!bestMatch || score < bestMatch.score) {
      bestMatch = {
        node: child,
        score
      };
    }
  }
  return bestMatch?.node;
};

export const detectDialogOverlayPattern = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): DetectedDialogOverlayPattern | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const elementWidth = toFiniteNumber(element.width);
  const elementHeight = toFiniteNumber(element.height);
  const parentWidth = toFiniteNumber(parent.width);
  const parentHeight = toFiniteNumber(parent.height);
  if (
    elementWidth === undefined ||
    elementHeight === undefined ||
    parentWidth === undefined ||
    parentHeight === undefined ||
    parentWidth <= 0 ||
    parentHeight <= 0
  ) {
    return undefined;
  }
  if (elementWidth / parentWidth < DIALOG_PATTERN_MIN_WIDTH_RATIO || elementHeight / parentHeight < DIALOG_PATTERN_MIN_HEIGHT_RATIO) {
    return undefined;
  }
  const hasOverlaySignal = hasSemiTransparentOverlaySignal(element);
  if (!hasOverlaySignal) {
    return undefined;
  }

  const panelNode = resolveCenteredDialogPanelNode({
    overlayNode: element,
    context
  });
  if (!panelNode) {
    return undefined;
  }

  const extraction = resolveDialogActionModels({
    panelNode,
    context
  });
  const closeControls = collectSubtreeElements(panelNode).filter((candidate) =>
    isDialogCloseControlNode({
      node: candidate,
      panelNode
    })
  );
  const hasCloseControl = closeControls.length > 0;
  const hasDialogSemanticHint = hasDialogHint(element.name) || hasDialogHint(panelNode.name);
  if (!hasDialogSemanticHint && !hasCloseControl && extraction.actionModels.length < TAB_PATTERN_MIN_ACTIONS) {
    return undefined;
  }

  const contentNodes = sortChildren(panelNode.children ?? [], panelNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  }).filter((child) => child.id !== extraction.actionHostNodeId && !closeControls.some((closeNode) => closeNode.id === child.id));
  const hasContentSignal =
    contentNodes.some((node) =>
      hasMeaningfulTextDescendants({
        element: node,
        context
      })
    ) || hasMeaningfulTextDescendants({ element: panelNode, context });
  if (!hasContentSignal) {
    return undefined;
  }
  const title = firstText(contentNodes[0] ?? panelNode)?.trim();
  return {
    panelNode,
    title,
    contentNodes,
    actionModels: extraction.actionModels
  };
};

export const detectNavigationBarPattern = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): "appbar" | "navigation" | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const elementWidth = toFiniteNumber(element.width);
  const elementHeight = toFiniteNumber(element.height);
  const parentWidth = toFiniteNumber(parent.width);
  const parentHeight = toFiniteNumber(parent.height);
  const elementY = toFiniteNumber(element.y);
  const parentY = toFiniteNumber(parent.y);

  if (
    elementWidth === undefined ||
    elementHeight === undefined ||
    parentWidth === undefined ||
    parentHeight === undefined ||
    elementY === undefined ||
    parentY === undefined ||
    parentWidth <= 0 ||
    parentHeight <= 0
  ) {
    return undefined;
  }

  if (elementHeight < NAVIGATION_BAR_MIN_HEIGHT_PX || elementHeight > NAVIGATION_BAR_MAX_HEIGHT_PX) {
    return undefined;
  }

  const widthRatio = elementWidth / parentWidth;
  if (widthRatio < NAVIGATION_BAR_MIN_WIDTH_RATIO) {
    return undefined;
  }

  const topDistance = Math.abs(elementY - parentY);
  const bottomDistance = Math.abs(parentY + parentHeight - (elementY + elementHeight));
  const isNearTop = topDistance <= NAVIGATION_BAR_EDGE_PROXIMITY_PX;
  const isNearBottom = bottomDistance <= NAVIGATION_BAR_EDGE_PROXIMITY_PX;
  if (!isNearTop && !isNearBottom) {
    return undefined;
  }

  const hasTitleSignal = Boolean(firstText(element)?.trim());
  const hasIconSignal = collectIconNodes(element).length > 0 || Boolean(pickBestIconNode(element));
  const hasInteractiveSignal =
    hasInteractiveDescendants({ element, context }) || hasPrototypeNavigationInSubtree(element);
  const hasNavigationHintSignal = hasNavigationNameHintInSubtree(element);
  const hasPrimaryNavSignal = hasIconSignal || hasInteractiveSignal || hasNavigationHintSignal;

  if (
    isLikelyStructuredDataTable({
      element,
      generationLocale: context.generationLocale
    }) &&
    !hasPrimaryNavSignal
  ) {
    return undefined;
  }

  if (isNearBottom) {
    const renderableActionCount = collectRenderedItems(element, context.generationLocale).filter((action) =>
      isRenderableBottomNavigationAction({
        action,
        context
      })
    ).length;
    if (renderableActionCount >= NAVIGATION_BAR_MIN_RENDERABLE_BOTTOM_ACTIONS && hasPrimaryNavSignal) {
      return "navigation";
    }
  }

  if (isNearTop && hasTitleSignal && hasPrimaryNavSignal) {
    return "appbar";
  }
  return undefined;
};
