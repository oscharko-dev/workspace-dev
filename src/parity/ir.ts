import type {
  CounterAxisAlignItems,
  DesignIR,
  DesignTokens,
  FigmaMcpEnrichment,
  GenerationMetrics,
  PrimaryAxisAlignItems,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { applySparkasseThemeDefaults } from "./sparkasse-theme.js";

const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;
const PLACEHOLDER_TEXT_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaPaint {
  type?: string;
  color?: FigmaColor;
  opacity?: number;
}

interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  fillGeometry?: Array<{
    path?: string;
    windingRule?: string;
  }>;
  strokeGeometry?: Array<{
    path?: string;
    windingRule?: string;
  }>;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  characters?: string;
  style?: {
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    lineHeightPx?: number;
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT";
  };
  cornerRadius?: number;
}

interface FigmaFile {
  name?: string;
  document?: FigmaNode;
}

interface WeightedColor {
  color: string;
  weight: number;
}

interface MetricsAccumulator {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  screenElementCounts: GenerationMetrics["screenElementCounts"];
  truncatedScreens: GenerationMetrics["truncatedScreens"];
  degradedGeometryNodes: string[];
}

interface FigmaToIrOptions {
  mcpEnrichment?: FigmaMcpEnrichment;
  screenElementBudget?: number;
  sourceMetrics?: {
    fetchedNodes?: number;
    degradedGeometryNodes?: string[];
  };
}

const toHexColor = (color?: FigmaColor, opacity?: number): string | undefined => {
  if (!color) {
    return undefined;
  }

  const alpha = typeof opacity === "number" ? opacity : (color.a ?? 1);
  if (alpha <= 0) {
    return undefined;
  }

  const blendOnWhite = (channel: number): number => {
    if (alpha >= 1) {
      return channel;
    }
    return channel * alpha + (1 - alpha);
  };

  const toHex = (value: number): string => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(blendOnWhite(color.r))}${toHex(blendOnWhite(color.g))}${toHex(blendOnWhite(color.b))}`;
};

const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return { r, g, b };
};

const luminance = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const saturation = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    return 0;
  }
  const lightness = (max + min) / 2;
  if (lightness <= 0.5) {
    return (max - min) / (max + min);
  }
  return (max - min) / (2 - max - min);
};

const uniqueByColor = (entries: WeightedColor[]): WeightedColor[] => {
  const weights = new Map<string, number>();
  for (const entry of entries) {
    weights.set(entry.color, (weights.get(entry.color) ?? 0) + entry.weight);
  }
  return [...weights.entries()].map(([color, weight]) => ({ color, weight }));
};

const countSubtreeNodes = (node: FigmaNode): number => {
  const children = node.children ?? [];
  if (children.length === 0) {
    return 1;
  }
  return 1 + children.reduce((count, child) => count + countSubtreeNodes(child), 0);
};

const collectNodes = (node: FigmaNode, predicate: (candidate: FigmaNode) => boolean): FigmaNode[] => {
  if (node.visible === false) {
    return [];
  }

  const collected: FigmaNode[] = [];
  if (predicate(node)) {
    collected.push(node);
  }
  if (!node.children) {
    return collected;
  }
  for (const child of node.children) {
    collected.push(...collectNodes(child, predicate));
  }
  return collected;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const hasAnySubstring = (value: string, tokens: string[]): boolean => {
  return tokens.some((token) => value.includes(token));
};

const hasAnyWord = (value: string, words: string[]): boolean => {
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(value));
};

const determineElementType = (node: FigmaNode): ScreenElementIR["type"] => {
  const name = (node.name ?? "").toLowerCase();
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  const childCount = node.children?.length ?? 0;
  const textChildCount = (node.children ?? []).filter((child) => child.type === "TEXT" && (child.characters ?? "").trim().length > 0).length;
  const hasChildren = childCount > 0;
  const hasSolidFill = Boolean(node.fills?.find((item) => item.type === "SOLID" && item.color));
  const hasStroke = Boolean(node.strokes?.find((item) => item.type === "SOLID" && item.color));
  const hasRoundedCorners = (node.cornerRadius ?? 0) >= 8;
  const hasListishChildNames = (node.children ?? []).some((child) => {
    const childName = (child.name ?? "").toLowerCase();
    return (
      childName.includes("listitem") ||
      childName.includes("list item") ||
      childName.includes("muilistitem") ||
      childName.includes("navigationaction")
    );
  });
  const hasInputSemantic = hasAnySubstring(name, [
    "muiformcontrolroot",
    "textfield",
    "input field",
    "muioutlinedinputroot",
    "muioutlinedinputinput",
    "muiinputadornmentroot",
    "muiselectselect",
    "muiinputbaseroot",
    "muiinputbaseinput",
    "muiinputroot",
    "formcontrol"
  ]);
  const isFieldSized = width >= 96 && height >= 28 && height <= 140;
  const isLikelyDividerByGeometry =
    !hasChildren && hasSolidFill && ((width >= 16 && height > 0 && height <= 2) || (height >= 16 && width > 0 && width <= 2));
  const hasButtonLabelHint =
    name.includes("zur übersicht") || name.includes("termin vereinbaren") || name.includes("zum finanzierungsplaner");
  const hasButtonKeyword = hasAnySubstring(name, ["muibutton", "buttonbase", "button", "cta"]);
  const hasStrongImageName = hasAnyWord(name, ["image", "photo", "illustration", "hero", "banner"]);

  if (node.type === "TEXT") {
    return "text";
  }

  if ((hasInputSemantic || hasAnyWord(name, ["input", "textfield", "select"])) && (isFieldSized || hasChildren)) {
    return "input";
  }

  if (hasAnySubstring(name, ["muiswitch", "switchbase"]) || hasAnyWord(name, ["switch", "toggle"])) {
    return "switch";
  }

  if (hasAnySubstring(name, ["muicheckbox"]) || hasAnyWord(name, ["checkbox"])) {
    return "checkbox";
  }

  if (hasAnySubstring(name, ["muiradio"]) || hasAnyWord(name, ["radio"])) {
    return "radio";
  }

  if (hasAnySubstring(name, ["muichip"]) || hasAnyWord(name, ["chip"])) {
    return "chip";
  }

  if (hasAnySubstring(name, ["muitabs", "muitab"]) || hasAnyWord(name, ["tab", "tabs"])) {
    return "tab";
  }

  if (
    hasAnySubstring(name, ["muicircularprogress", "muilinearprogress", "circularprogress", "linearprogress", "progressbar"]) ||
    hasAnyWord(name, ["progress", "loader", "loading", "spinner"])
  ) {
    return "progress";
  }

  if (hasAnySubstring(name, ["muiavatar"]) || hasAnyWord(name, ["avatar"])) {
    return "avatar";
  }

  if (hasAnySubstring(name, ["muibadge"]) || hasAnyWord(name, ["badge"])) {
    return "badge";
  }

  if (hasAnySubstring(name, ["muidivider", "separator"]) || hasAnyWord(name, ["divider"]) || isLikelyDividerByGeometry) {
    return "divider";
  }

  if (hasAnySubstring(name, ["muiappbar", "topbar"]) || hasAnyWord(name, ["appbar", "app bar", "toolbar"])) {
    return "appbar";
  }

  if (
    hasAnySubstring(name, ["bottomnavigation", "navigationbar", "muitabbar"]) ||
    hasAnyWord(name, ["navigation", "navbar"])
  ) {
    return "navigation";
  }

  if (hasAnySubstring(name, ["muidialog", "modal"]) || hasAnyWord(name, ["dialog", "modal"])) {
    return "dialog";
  }

  if (hasAnySubstring(name, ["muistepper"]) || hasAnyWord(name, ["stepper"])) {
    return "stepper";
  }

  const isLikelyListByStructure =
    !hasSolidFill && childCount >= 3 && textChildCount >= 2 && (node.layoutMode === "VERTICAL" || node.layoutMode === "NONE");
  if (
    hasAnySubstring(name, ["muilist", "listitem", "muilistitem"]) ||
    hasAnyWord(name, ["list"]) ||
    hasListishChildNames ||
    isLikelyListByStructure
  ) {
    return "list";
  }

  if (hasAnySubstring(name, ["muicard"]) || hasAnyWord(name, ["card"])) {
    return "card";
  }

  if (hasChildren && hasSolidFill && hasRoundedCorners && width >= 120 && height >= 80) {
    return "card";
  }

  if (name.includes("cta") || (hasButtonKeyword && (hasSolidFill || hasStroke || hasRoundedCorners || hasButtonLabelHint))) {
    return "button";
  }

  if ((node.type === "RECTANGLE" || node.type === "FRAME") && hasStrongImageName && !hasChildren) {
    return "image";
  }

  return "container";
};

const mapPadding = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } => {
  return {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0
  };
};

const hasPlaceholderText = (node: FigmaNode): boolean => {
  if (node.type !== "TEXT") {
    return false;
  }
  const normalized = (node.characters ?? "").trim().toLowerCase();
  return PLACEHOLDER_TEXT_VALUES.has(normalized);
};

const isGeometryEmpty = (node: FigmaNode): boolean => {
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  return width <= 0 || height <= 0;
};

const isHelperItemNode = (node: FigmaNode): boolean => {
  const normalized = (node.name ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "_item" ||
    normalized.startsWith("_item ") ||
    normalized.startsWith("item_") ||
    normalized.endsWith("_item")
  );
};

const mapElement = ({
  node,
  depth,
  inInstanceContext,
  metrics
}: {
  node: FigmaNode;
  depth: number;
  inInstanceContext: boolean;
  metrics: MetricsAccumulator;
}): ScreenElementIR | null => {
  if (node.visible === false) {
    metrics.skippedHidden += countSubtreeNodes(node);
    return null;
  }

  if (inInstanceContext && hasPlaceholderText(node)) {
    metrics.skippedPlaceholders += 1;
    return null;
  }

  if (isHelperItemNode(node) && isGeometryEmpty(node)) {
    metrics.skippedPlaceholders += countSubtreeNodes(node);
    return null;
  }

  const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
  const stroke = node.strokes?.find((item) => item.type === "SOLID" && item.color);
  const vectorPaths = [...(node.fillGeometry ?? []), ...(node.strokeGeometry ?? [])]
    .map((item) => item.path)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const element: ScreenElementIR = {
    id: node.id,
    name: node.name ?? node.type,
    nodeType: node.type,
    type: determineElementType(node),
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    padding: mapPadding(node),
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };

  if (node.characters !== undefined) {
    element.text = node.characters;
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
  if (node.style?.textAlignHorizontal !== undefined) {
    element.textAlign = node.style.textAlignHorizontal;
  }
  if (vectorPaths.length > 0) {
    element.vectorPaths = vectorPaths;
  }
  if (node.cornerRadius !== undefined) {
    element.cornerRadius = node.cornerRadius;
  }

  const isNextInstanceContext = inInstanceContext || node.type === "INSTANCE" || node.type === "COMPONENT_SET";

  if (depth >= 14) {
    element.children = [];
  } else if (node.children?.length) {
    const children: ScreenElementIR[] = [];
    for (const child of node.children) {
      const mappedChild = mapElement({
        node: child,
        depth: depth + 1,
        inInstanceContext: isNextInstanceContext,
        metrics
      });
      if (mappedChild) {
        children.push(mappedChild);
      }
    }
    if (children.length > 0) {
      element.children = children;
    }
  }

  return element;
};

const isScreenLikeNode = (node: FigmaNode | undefined): node is FigmaNode => {
  if (!node || node.visible === false) {
    return false;
  }
  return node.type === "FRAME" || node.type === "COMPONENT";
};

const isGenericFrameName = (name: string | undefined): boolean => {
  if (!name) {
    return true;
  }
  const normalized = name.trim();
  if (!normalized) {
    return true;
  }
  return /^t\d+$/i.test(normalized) || /^frame\s*\d*$/i.test(normalized) || /^group\s*\d*$/i.test(normalized);
};

const unwrapScreenRoot = (candidate: FigmaNode): { node: FigmaNode; name: string } => {
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

const collectSectionScreens = ({
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

const countElements = (elements: ScreenElementIR[]): number => {
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

const truncateElementsToBudget = ({
  elements,
  budget
}: {
  elements: ScreenElementIR[];
  budget: number;
}): { elements: ScreenElementIR[]; retainedCount: number } => {
  let remaining = budget;

  const visit = (element: ScreenElementIR): ScreenElementIR | null => {
    if (remaining <= 0) {
      return null;
    }
    remaining -= 1;

    const nextChildren: ScreenElementIR[] = [];
    for (const child of element.children ?? []) {
      const mapped = visit(child);
      if (mapped) {
        nextChildren.push(mapped);
      }
      if (remaining <= 0) {
        break;
      }
    }

    if (nextChildren.length === 0) {
      const withoutChildren = { ...element };
      delete withoutChildren.children;
      return withoutChildren;
    }
    return {
      ...element,
      children: nextChildren
    };
  };

  const truncated: ScreenElementIR[] = [];
  for (const element of elements) {
    const mapped = visit(element);
    if (!mapped) {
      break;
    }
    truncated.push(mapped);
    if (remaining <= 0) {
      break;
    }
  }

  return {
    elements: truncated,
    retainedCount: budget - remaining
  };
};

const extractScreens = ({
  file,
  metrics,
  screenElementBudget
}: {
  file: FigmaFile;
  metrics: MetricsAccumulator;
  screenElementBudget: number;
}): ScreenIR[] => {
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

  const screens: ScreenIR[] = [];

  for (const candidate of screenCandidates) {
    const normalized = unwrapScreenRoot(candidate);
    const sourceNode = normalized.node;
    const fill = sourceNode.fills?.find((item) => item.type === "SOLID" && item.color);

    const mappedChildren: ScreenElementIR[] = [];
    for (const child of sourceNode.children ?? []) {
      const mapped = mapElement({
        node: child,
        depth: 0,
        inInstanceContext: sourceNode.type === "INSTANCE" || sourceNode.type === "COMPONENT_SET",
        metrics
      });
      if (mapped) {
        mappedChildren.push(mapped);
      }
    }

    const originalElements = countElements(mappedChildren);
    metrics.screenElementCounts.push({
      screenId: sourceNode.id,
      screenName: normalized.name,
      elements: originalElements
    });

    const { elements: budgetedChildren, retainedCount } =
      originalElements > screenElementBudget
        ? truncateElementsToBudget({ elements: mappedChildren, budget: screenElementBudget })
        : { elements: mappedChildren, retainedCount: originalElements };

    if (originalElements > screenElementBudget) {
      metrics.truncatedScreens.push({
        screenId: sourceNode.id,
        screenName: normalized.name,
        originalElements,
        retainedElements: retainedCount,
        budget: screenElementBudget
      });
    }

    const screen: ScreenIR = {
      id: sourceNode.id,
      name: normalized.name,
      layoutMode: sourceNode.layoutMode ?? "NONE",
      gap: sourceNode.itemSpacing ?? 0,
      padding: mapPadding(sourceNode),
      children: budgetedChildren,
      ...(sourceNode.primaryAxisAlignItems ? { primaryAxisAlignItems: sourceNode.primaryAxisAlignItems } : {}),
      ...(sourceNode.counterAxisAlignItems ? { counterAxisAlignItems: sourceNode.counterAxisAlignItems } : {})
    };
    if (sourceNode.absoluteBoundingBox?.width !== undefined) {
      screen.width = sourceNode.absoluteBoundingBox.width;
    }
    if (sourceNode.absoluteBoundingBox?.height !== undefined) {
      screen.height = sourceNode.absoluteBoundingBox.height;
    }
    const fillColor = toHexColor(fill?.color, fill?.opacity);
    if (fillColor) {
      screen.fillColor = fillColor;
    }
    screens.push(screen);
  }

  return screens;
};

const deriveTokens = (file: FigmaFile): DesignTokens => {
  const nodes = file.document ? collectNodes(file.document, () => true) : [];

  const textNodes = nodes.filter((node) => node.type === "TEXT");
  const textColorWeighted = uniqueByColor(
    textNodes
      .map((node) => {
        const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
        const color = toHexColor(fill?.color, fill?.opacity);
        if (!color) {
          return undefined;
        }
        const weight = Math.max(1, node.absoluteBoundingBox?.width ?? 1);
        return { color, weight };
      })
      .filter((entry): entry is WeightedColor => Boolean(entry))
  );

  const surfaceColorWeighted = uniqueByColor(
    nodes
      .filter((node) => node.type === "FRAME" || node.type === "RECTANGLE")
      .map((node) => {
        const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
        const color = toHexColor(fill?.color, fill?.opacity);
        if (!color) {
          return undefined;
        }
        const area = (node.absoluteBoundingBox?.width ?? 1) * (node.absoluteBoundingBox?.height ?? 1);
        return { color, weight: Math.max(1, area) };
      })
      .filter((entry): entry is WeightedColor => Boolean(entry))
  );

  const buttonColors = uniqueByColor(
    nodes
      .filter((node) => (node.name ?? "").toLowerCase().includes("button"))
      .map((node) => {
        const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
        const color = toHexColor(fill?.color, fill?.opacity);
        if (!color) {
          return undefined;
        }
        return { color, weight: 2 };
      })
      .filter((entry): entry is WeightedColor => Boolean(entry))
  );

  const largeTextAccentColors = uniqueByColor(
    textNodes
      .filter((node) => (node.style?.fontSize ?? 0) >= 28)
      .map((node) => {
        const fill = node.fills?.find((item) => item.type === "SOLID" && item.color);
        const color = toHexColor(fill?.color, fill?.opacity);
        if (!color) {
          return undefined;
        }
        return { color, weight: 1 };
      })
      .filter((entry): entry is WeightedColor => Boolean(entry))
  );

  const sortedSurfaces = [...surfaceColorWeighted].sort((a, b) => b.weight - a.weight);
  const backgroundCandidate =
    sortedSurfaces.find((entry) => luminance(entry.color) > 0.82) ??
    sortedSurfaces.find((entry) => luminance(entry.color) > 0.72) ??
    sortedSurfaces.at(0) ??
    { color: "#f7f8fb", weight: 1 };

  const sortedTextColors = [...textColorWeighted].sort((a, b) => a.weight - b.weight);
  const textCandidate =
    [...sortedTextColors].sort((a, b) => luminance(a.color) - luminance(b.color)).at(0) ??
    { color: "#1f2937", weight: 1 };

  const primaryCandidate =
    [...buttonColors].sort((a, b) => b.weight - a.weight).at(0) ??
    [...largeTextAccentColors]
      .filter((entry) => saturation(entry.color) > 0.35)
      .sort((a, b) => b.weight - a.weight)
      .at(0) ??
    [...surfaceColorWeighted]
      .filter((entry) => saturation(entry.color) > 0.45 && luminance(entry.color) > 0.25)
      .sort((a, b) => b.weight - a.weight)
      .at(0) ??
    { color: "#d4001a", weight: 1 };

  const secondaryCandidate =
    [...largeTextAccentColors]
      .filter((entry) => entry.color !== primaryCandidate.color && saturation(entry.color) > 0.25)
      .sort((a, b) => b.weight - a.weight)
      .at(0) ??
    [...surfaceColorWeighted]
      .filter((entry) => entry.color !== primaryCandidate.color && saturation(entry.color) > 0.25)
      .sort((a, b) => b.weight - a.weight)
      .at(0) ??
    { color: "#5f8f2f", weight: 1 };

  const textNode = textNodes.find((node) => node.style?.fontFamily);

  const spacings = nodes
    .map((node) => node.itemSpacing)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .sort((a, b) => a - b);

  const radii = nodes
    .map((node) => node.cornerRadius)
    .filter((value): value is number => typeof value === "number" && value >= 0)
    .sort((a, b) => a - b);

  const headingSizes = textNodes
    .filter((node) => (node.style?.fontSize ?? 0) >= 20)
    .map((node) => node.style?.fontSize ?? 24)
    .sort((a, b) => b - a);

  const bodySizes = textNodes
    .filter((node) => (node.style?.fontSize ?? 0) < 20)
    .map((node) => node.style?.fontSize ?? 14)
    .sort((a, b) => a - b);

  return {
    palette: {
      primary: primaryCandidate.color,
      secondary: secondaryCandidate.color,
      background: backgroundCandidate.color,
      text: textCandidate.color
    },
    borderRadius: radii.find((radius) => radius > 0) ?? 8,
    spacingBase: spacings.find((spacing) => spacing >= 8) ?? 8,
    fontFamily: textNode?.style?.fontFamily ?? "Roboto, Arial, sans-serif",
    headingSize: headingSizes[0] ?? 24,
    bodySize: bodySizes[Math.floor(bodySizes.length / 2)] ?? 14
  };
};

const isGenericElementName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "container" ||
    normalized === "styled(div)" ||
    normalized === "vector" ||
    normalized === "frame" ||
    normalized.startsWith("frame ")
  );
};

const inferTypeFromSemanticHint = (
  semanticName: string | undefined,
  semanticType: string | undefined
): ScreenElementIR["type"] | undefined => {
  const combined = `${semanticName ?? ""} ${semanticType ?? ""}`.toLowerCase();
  if (!combined.trim()) {
    return undefined;
  }

  if (hasAnyWord(combined, ["text", "typography", "headline", "title", "label"])) {
    return "text";
  }

  if (hasAnySubstring(combined, ["formcontrol", "textfield", "text field"]) || hasAnyWord(combined, ["input", "select", "field"])) {
    return "input";
  }

  if (hasAnyWord(combined, ["switch", "toggle"])) {
    return "switch";
  }

  if (hasAnyWord(combined, ["checkbox"])) {
    return "checkbox";
  }

  if (hasAnyWord(combined, ["radio"])) {
    return "radio";
  }

  if (hasAnyWord(combined, ["chip"])) {
    return "chip";
  }

  if (hasAnyWord(combined, ["tab", "tabs"])) {
    return "tab";
  }

  if (hasAnyWord(combined, ["progress", "loader", "spinner"])) {
    return "progress";
  }

  if (hasAnyWord(combined, ["avatar"])) {
    return "avatar";
  }

  if (hasAnyWord(combined, ["badge"])) {
    return "badge";
  }

  if (hasAnyWord(combined, ["divider", "separator"])) {
    return "divider";
  }

  if (hasAnySubstring(combined, ["appbar", "app bar"]) || hasAnyWord(combined, ["toolbar"])) {
    return "appbar";
  }

  if (hasAnyWord(combined, ["navigation", "navbar"])) {
    return "navigation";
  }

  if (hasAnyWord(combined, ["dialog", "modal"])) {
    return "dialog";
  }

  if (hasAnyWord(combined, ["stepper", "step"])) {
    return "stepper";
  }

  if (hasAnyWord(combined, ["list", "listitem"])) {
    return "list";
  }

  if (hasAnyWord(combined, ["card"])) {
    return "card";
  }

  if (hasAnyWord(combined, ["button", "cta"])) {
    return "button";
  }

  if (hasAnyWord(combined, ["image", "photo", "illustration", "icon"])) {
    return "image";
  }
  return undefined;
};

const applyMcpHintToElement = (
  element: ScreenElementIR,
  hintsById: Map<string, FigmaMcpEnrichment["nodeHints"][number]>
): ScreenElementIR => {
  const hint = hintsById.get(element.id);
  const inferredType = hint ? inferTypeFromSemanticHint(hint.semanticName, hint.semanticType) : undefined;

  const nextName =
    hint?.semanticName && (isGenericElementName(element.name) || hint.semanticName.length > element.name.length + 2)
      ? hint.semanticName
      : element.name;

  return {
    ...element,
    name: nextName,
    type: inferredType ?? element.type,
    children: (element.children ?? []).map((child) => applyMcpHintToElement(child, hintsById))
  };
};

const applyMcpEnrichmentToIr = (ir: DesignIR, enrichment: FigmaMcpEnrichment): DesignIR => {
  if (enrichment.nodeHints.length === 0) {
    return ir;
  }

  const hintsById = new Map(enrichment.nodeHints.map((hint) => [hint.nodeId, hint]));
  return {
    ...ir,
    screens: ir.screens.map((screen) => ({
      ...screen,
      children: screen.children.map((child) => applyMcpHintToElement(child, hintsById))
    }))
  };
};

export const figmaToDesignIr = (figmaJson: unknown): DesignIR => {
  return figmaToDesignIrWithOptions(figmaJson);
};

export const figmaToDesignIrWithOptions = (figmaJson: unknown, options?: FigmaToIrOptions): DesignIR => {
  const parsed = figmaJson as FigmaFile;
  const screenElementBudget =
    typeof options?.screenElementBudget === "number" && Number.isFinite(options.screenElementBudget)
      ? Math.max(1, Math.trunc(options.screenElementBudget))
      : DEFAULT_SCREEN_ELEMENT_BUDGET;

  const metrics: MetricsAccumulator = {
    fetchedNodes:
      typeof options?.sourceMetrics?.fetchedNodes === "number" && Number.isFinite(options.sourceMetrics.fetchedNodes)
        ? Math.max(0, Math.trunc(options.sourceMetrics.fetchedNodes))
        : 0,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    screenElementCounts: [],
    truncatedScreens: [],
    degradedGeometryNodes: [...(options?.sourceMetrics?.degradedGeometryNodes ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort((left, right) => left.localeCompare(right))
  };

  const screens = extractScreens({
    file: parsed,
    metrics,
    screenElementBudget
  });

  if (screens.length === 0) {
    throw new Error("No top-level frames/components found in Figma file");
  }

  const baseIr: DesignIR = {
    sourceName: parsed.name ?? "Figma File",
    screens,
    tokens: applySparkasseThemeDefaults(deriveTokens(parsed)),
    metrics
  };

  if (!options?.mcpEnrichment) {
    return baseIr;
  }
  return applyMcpEnrichmentToIr(baseIr, options.mcpEnrichment);
};
