import type { WorkspaceBrandTheme } from "../contracts/index.js";
import { safeParseFigmaPayload, summarizeFigmaPayloadValidationError } from "../figma-payload-validation.js";
import {
  isHelperItemNode,
  isNodeGeometryEmpty,
  isTechnicalPlaceholderText
} from "../figma-node-heuristics.js";
import type {
  CounterAxisAlignItems,
  DesignIR,
  DesignTokenTypographyScale,
  DesignTokenTypographyVariant,
  DesignTokenTypographyVariantName,
  DesignTokens,
  FigmaMcpEnrichment,
  GenerationMetrics,
  PrimaryAxisAlignItems,
  ResponsiveBreakpoint,
  ScreenResponsiveIR,
  ScreenResponsiveLayoutOverride,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  ScreenResponsiveVariantIR,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { applySparkasseThemeDefaults } from "./sparkasse-theme.js";
import {
  HEADING_TYPOGRAPHY_VARIANTS,
  completeTypographyScale
} from "./typography-tokens.js";
import {
  classifyElementTypeFromNode,
  classifyElementTypeFromSemanticHint,
  hasAnySubstring,
  hasAnyWord
} from "./ir-classification.js";
import {
  hasVisibleShadowEffect,
  resolveElevationFromEffects,
  resolveFirstVisibleGradientPaint,
  resolveFirstVisibleImagePaint,
  resolveFirstVisibleSolidPaint,
  resolveInsetShadowFromEffects,
  toCssGradient,
  toHexColor
} from "./ir-colors.js";
import type { FigmaEffect, FigmaPaint } from "./ir-colors.js";
import {
  countSubtreeNodes,
  collectNodes,
  analyzeDepthPressure,
  shouldTruncateChildrenByDepth,
  hasMeaningfulNodeText,
  DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH
} from "./ir-tree.js";
import type { ScreenDepthBudgetContext } from "./ir-tree.js";
export {
  buildComponentSetVariantCandidate,
  classifyPlaceholderNode,
  classifyPlaceholderText,
  diffVariantStyle,
  extractDefaultVariantProperties,
  extractFirstTextFillColor,
  extractVariantDataFromNode,
  extractVariantNameProperties,
  extractVariantPropertiesFromComponentProperties,
  extractVariantStyleFromNode,
  isTruthyVariantFlag,
  normalizeVariantKey,
  normalizeVariantValue,
  resolveDefaultVariantCandidate,
  resolveMuiPropsFromVariantProperties,
  resolvePlaceholderMatcherConfig,
  scoreVariantSimilarity,
  toComponentSetVariantMapping,
  toMuiSize,
  toMuiVariant,
  toSortedVariantProperties,
  toVariantState,
  GENERIC_PLACEHOLDER_TEXT_PATTERNS
} from "./ir-variants.js";
export type {
  ComponentSetVariantCandidate,
  NormalizedVariantData,
  PlaceholderMatcherConfig
} from "./ir-variants.js";
import {
  classifyPlaceholderNode,
  extractVariantDataFromNode,
  resolvePlaceholderMatcherConfig,
  toComponentSetVariantMapping
} from "./ir-variants.js";
import type { PlaceholderMatcherConfig } from "./ir-variants.js";
export {
  countSubtreeNodes,
  collectNodes,
  analyzeDepthPressure,
  shouldTruncateChildrenByDepth,
  DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
  DEPTH_SEMANTIC_TYPES,
  DEPTH_SEMANTIC_NAME_HINTS,
  isDepthSemanticNode
} from "./ir-tree.js";
export type {
  DepthAnalysis,
  ScreenDepthBudgetContext,
  TreeFigmaNode
} from "./ir-tree.js";
const DECORATIVE_NAME_PATTERN = /(icon|decor|bg|background|shape|vector|spacer|divider)/i;

interface FigmaComponentPropertyValue {
  type?: string;
  value?: unknown;
}

interface FigmaComponentPropertyDefinition {
  type?: string;
  defaultValue?: unknown;
  variantOptions?: unknown;
}

interface FigmaInteractionTrigger {
  type?: string;
}

interface FigmaInteractionAction {
  type?: string;
  destinationId?: string;
  navigation?: string;
  transitionNodeID?: string;
  transitionNodeId?: string;
}

interface FigmaInteraction {
  trigger?: FigmaInteractionTrigger;
  action?: FigmaInteractionAction;
  actions?: FigmaInteractionAction[];
}

interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  styles?: Record<string, string>;
  fillStyleId?: string;
  strokeStyleId?: string;
  effectStyleId?: string;
  textStyleId?: string;
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
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  opacity?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  effects?: FigmaEffect[];
  strokeWeight?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  characters?: string;
  style?: {
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT";
  };
  cornerRadius?: number;
  componentProperties?: Record<string, FigmaComponentPropertyValue>;
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
  interactions?: FigmaInteraction[];
}

interface FigmaFile {
  name?: string;
  document?: FigmaNode;
  styles?: Record<
    string,
    {
      name?: string;
      styleType?: string;
      style_type?: string;
      key?: string;
      description?: string;
    }
  >;
}

type ColorSampleContext = "button" | "heading" | "body" | "surface" | "decorative";
type StyleSignalKey =
  | "primary"
  | "secondary"
  | "background"
  | "text"
  | "brand"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "divider";
type SemanticPaletteKey = "success" | "warning" | "error" | "info" | "divider";
type ColorFamily = "red" | "orange" | "yellow" | "green" | "blue" | "neutral" | "other";

interface ColorSample {
  color: string;
  weight: number;
  context: ColorSampleContext;
  styleSignals: Record<StyleSignalKey, number>;
}

interface ColorCluster {
  color: string;
  totalWeight: number;
  channels: {
    r: number;
    g: number;
    b: number;
  };
  contexts: Record<ColorSampleContext, number>;
  styleSignals: Record<StyleSignalKey, number>;
}

interface FontSample {
  family: string;
  role: "heading" | "body";
  size: number;
  weight: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacingPx?: number;
  isButtonLike: boolean;
  isUppercaseLike: boolean;
}

interface TypographyCluster {
  normalizedSize: number;
  totalWeight: number;
  headingWeight: number;
  bodyWeight: number;
  buttonWeight: number;
  uppercaseWeight: number;
  fontWeight: number;
  lineHeight: number;
  fontFamily?: string;
  letterSpacingEm?: number;
}

interface MetricsAccumulator {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  prototypeNavigationDetected: number;
  prototypeNavigationResolved: number;
  prototypeNavigationUnresolved: number;
  screenElementCounts: GenerationMetrics["screenElementCounts"];
  truncatedScreens: GenerationMetrics["truncatedScreens"];
  depthTruncatedScreens: NonNullable<GenerationMetrics["depthTruncatedScreens"]>;
  degradedGeometryNodes: string[];
}

interface FigmaToIrOptions {
  mcpEnrichment?: FigmaMcpEnrichment;
  screenElementBudget?: number;
  screenElementMaxDepth?: number;
  placeholderRules?: {
    allowlist?: string[];
    blocklist?: string[];
  };
  brandTheme?: WorkspaceBrandTheme;
  sourceMetrics?: {
    fetchedNodes?: number;
    degradedGeometryNodes?: string[];
  };
}

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

const relativeLuminance = (hex: string): number => {
  const transform = (value: number): number => {
    if (value <= 0.03928) {
      return value / 12.92;
    }
    return ((value + 0.055) / 1.055) ** 2.4;
  };

  const { r, g, b } = parseHex(hex);
  const rl = transform(r);
  const gl = transform(g);
  const bl = transform(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
};

const contrastRatio = (first: string, second: string): number => {
  const left = relativeLuminance(first);
  const right = relativeLuminance(second);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
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

const colorDistance = (leftHex: string, rightHex: string): number => {
  const left = parseHex(leftHex);
  const right = parseHex(rightHex);
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const toHexFromChannel = (value: number): string => {
  const normalized = clamp(Math.round(value), 0, 255);
  return normalized.toString(16).padStart(2, "0");
};

const toHexFromRgb = (red: number, green: number, blue: number): string => {
  return `#${toHexFromChannel(red)}${toHexFromChannel(green)}${toHexFromChannel(blue)}`;
};

const toHexWithAlpha = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const colorPayload = normalized.length >= 6 ? normalized.slice(0, 6) : normalized;
  if (!/^[0-9a-f]{6}$/i.test(colorPayload)) {
    return hex;
  }
  return `#${colorPayload}${toHexFromChannel(clamp(alpha, 0, 1) * 255)}`;
};

const quantizeColorKey = (hex: string, step: number): string => {
  const normalized = hex.replace("#", "");
  const parseChannel = (start: number): number => {
    const channel = Number.parseInt(normalized.slice(start, start + 2), 16);
    if (!Number.isFinite(channel)) {
      return 0;
    }
    const quantized = Math.round(channel / step) * step;
    return clamp(quantized, 0, 255);
  };
  return toHexFromRgb(parseChannel(0), parseChannel(2), parseChannel(4));
};

const median = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  const lower = sorted[midpoint - 1];
  const upper = sorted[midpoint];
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  return (lower + upper) / 2;
};

const weightedMedian = (samples: Array<{ value: number; weight: number }>): number | undefined => {
  const filtered = samples.filter((sample) => Number.isFinite(sample.value) && Number.isFinite(sample.weight) && sample.weight > 0);
  if (filtered.length === 0) {
    return undefined;
  }
  const sorted = [...filtered].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const threshold = totalWeight / 2;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= threshold) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1]?.value;
};

const normalizeFontStack = (families: string[]): string => {
  const tokens = families
    .flatMap((family) => family.split(","))
    .map((family) => family.trim())
    .filter((family) => family.length > 0);

  const unique: string[] = [];
  for (const token of tokens) {
    if (unique.some((entry) => entry.toLowerCase() === token.toLowerCase())) {
      continue;
    }
    unique.push(token);
  }

  if (!unique.some((entry) => /roboto/i.test(entry))) {
    unique.push("Roboto");
  }
  if (!unique.some((entry) => /arial/i.test(entry))) {
    unique.push("Arial");
  }
  if (!unique.some((entry) => /sans-serif/i.test(entry))) {
    unique.push("sans-serif");
  }

  return unique.join(", ");
};

const emptyStyleSignals = (): Record<StyleSignalKey, number> => ({
  primary: 0,
  secondary: 0,
  background: 0,
  text: 0,
  brand: 0,
  accent: 0,
  success: 0,
  warning: 0,
  error: 0,
  info: 0,
  divider: 0
});

const addStyleSignals = (
  target: Record<StyleSignalKey, number>,
  signals: Record<StyleSignalKey, number>,
  multiplier = 1
): void => {
  for (const key of Object.keys(signals) as StyleSignalKey[]) {
    target[key] += signals[key] * multiplier;
  }
};

const determineElementType = (node: FigmaNode): ScreenElementIR["type"] => {
  return classifyElementTypeFromNode({
    node,
    dependencies: {
      hasSolidFill: (candidate) => Boolean(resolveFirstVisibleSolidPaint(candidate.fills)),
      hasGradientFill: (candidate) => Boolean(resolveFirstVisibleGradientPaint(candidate.fills)),
      hasImageFill: (candidate) => Boolean(resolveFirstVisibleImagePaint(candidate.fills)),
      hasVisibleShadow: (candidate) => hasVisibleShadowEffect(candidate.effects),
      hasStroke: (candidate) => Boolean(resolveFirstVisibleSolidPaint(candidate.strokes))
    }
  });
};

const mapPadding = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } => {
  return {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0
  };
};

const mapMargin = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } | undefined => {
  const mappedMargin = {
    top: node.marginTop ?? 0,
    right: node.marginRight ?? 0,
    bottom: node.marginBottom ?? 0,
    left: node.marginLeft ?? 0
  };
  if (mappedMargin.top <= 0 && mappedMargin.right <= 0 && mappedMargin.bottom <= 0 && mappedMargin.left <= 0) {
    return undefined;
  }
  return mappedMargin;
};

// DEPTH_SEMANTIC_TYPES, DEPTH_SEMANTIC_NAME_HINTS, DepthAnalysis, ScreenDepthBudgetContext,
// hasMeaningfulNodeText, isDepthSemanticNode, analyzeDepthPressure, shouldTruncateChildrenByDepth
// moved to ir-tree.ts

interface PrototypeNavigationResolutionContext {
  nodeIdToScreenId: Map<string, string>;
  knownScreenIds: Set<string>;
}

const normalizeNodeActionType = (value: string | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

const resolvePrototypeNavigationMode = (
  navigation: string | undefined
): NonNullable<ScreenElementIR["prototypeNavigation"]>["mode"] | undefined => {
  const normalized = normalizeNodeActionType(navigation);
  if (!normalized || normalized === "NAVIGATE") {
    return "push";
  }
  if (normalized === "SWAP" || normalized === "REPLACE") {
    return "replace";
  }
  if (normalized === "OVERLAY") {
    return "overlay";
  }
  if (normalized === "CHANGE_TO") {
    return undefined;
  }
  return "push";
};

const resolvePrototypeDestinationId = (action: FigmaInteractionAction): string | undefined => {
  const candidates = [action.destinationId, action.transitionNodeID, action.transitionNodeId];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
};

const resolvePrototypeNavigation = ({
  node,
  metrics,
  navigationContext
}: {
  node: FigmaNode;
  metrics: MetricsAccumulator;
  navigationContext: PrototypeNavigationResolutionContext;
}): ScreenElementIR["prototypeNavigation"] | undefined => {
  for (const interaction of node.interactions ?? []) {
    if (normalizeNodeActionType(interaction.trigger?.type) !== "ON_CLICK") {
      continue;
    }
    const actions = Array.isArray(interaction.actions)
      ? interaction.actions
      : interaction.action
        ? [interaction.action]
        : [];
    for (const action of actions) {
      if (normalizeNodeActionType(action.type) !== "NODE") {
        continue;
      }
      const mode = resolvePrototypeNavigationMode(action.navigation);
      if (!mode) {
        continue;
      }

      metrics.prototypeNavigationDetected += 1;
      const destinationId = resolvePrototypeDestinationId(action);
      if (!destinationId) {
        metrics.prototypeNavigationUnresolved += 1;
        continue;
      }

      const targetScreenId =
        navigationContext.nodeIdToScreenId.get(destinationId) ??
        (navigationContext.knownScreenIds.has(destinationId) ? destinationId : undefined);
      if (!targetScreenId) {
        metrics.prototypeNavigationUnresolved += 1;
        continue;
      }

      metrics.prototypeNavigationResolved += 1;
      return {
        targetScreenId,
        mode
      };
    }
  }

  return undefined;
};

interface MapElementInput {
  node: FigmaNode;
  depth: number;
  inInstanceContext: boolean;
  inInputContext: boolean;
  placeholderMatcherConfig: PlaceholderMatcherConfig;
  metrics: MetricsAccumulator;
  depthContext: ScreenDepthBudgetContext;
  navigationContext: PrototypeNavigationResolutionContext;
}

type PlaceholderClassification = ReturnType<typeof classifyPlaceholderNode>;

interface ElementSkipEvaluation {
  skip: boolean;
  placeholderClassification: PlaceholderClassification;
}

interface ElementBaseBuildResult {
  element: ScreenElementIR;
  elementType: ScreenElementIR["type"];
}

interface ElementTraversalContext {
  isNextInstanceContext: boolean;
  isNextInputContext: boolean;
}

const evaluateElementSkip = ({
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

const buildElementBase = ({
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

const enrichElementStyleAndGeometry = ({
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

const resolveTraversalContext = ({
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

const markDepthTruncation = ({
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

const mapElementChildren = ({
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

const mapElement = ({
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

const indexScreenNodeIds = ({
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

interface TruncationCandidate {
  id: string;
  ancestorIds: string[];
  depth: number;
  traversalIndex: number;
  area: number;
  score: number;
  mustKeep: boolean;
}

const hasMeaningfulTextContent = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().length > 0 && !isTechnicalPlaceholderText({ text: value });
};

const hasVisualSubstance = (element: ScreenElementIR): boolean => {
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

const resolveElementBasePriority = (type: ScreenElementIR["type"]): number => {
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

const resolveElementArea = (element: ScreenElementIR): number => {
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

const resolveTruncationPriority = (
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

const collectTruncationCandidates = (elements: ScreenElementIR[]): TruncationCandidate[] => {
  const candidates: TruncationCandidate[] = [];
  const ancestorIds: string[] = [];
  let traversalIndex = 0;

  const visit = (element: ScreenElementIR, depth: number): void => {
    const { score, mustKeep } = resolveTruncationPriority(element);
    candidates.push({
      id: element.id,
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

const sortCandidatesByPriority = (candidates: TruncationCandidate[]): TruncationCandidate[] => {
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

const pruneElementToSelection = ({
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

const truncateElementsToBudget = ({
  elements,
  budget
}: {
  elements: ScreenElementIR[];
  budget: number;
}): { elements: ScreenElementIR[]; retainedCount: number } => {
  if (budget <= 0 || elements.length === 0) {
    return {
      elements: [],
      retainedCount: 0
    };
  }

  const candidates = collectTruncationCandidates(elements);
  if (candidates.length <= budget) {
    return {
      elements,
      retainedCount: candidates.length
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

  const truncated: ScreenElementIR[] = [];
  for (const element of elements) {
    const pruned = pruneElementToSelection({ element, selectedIds });
    if (pruned) {
      truncated.push(pruned);
    }
  }

  return {
    elements: truncated,
    retainedCount: countElements(truncated)
  };
};

const RESPONSIVE_BREAKPOINT_ORDER: ResponsiveBreakpoint[] = ["xs", "sm", "md", "lg", "xl"];
const RESPONSIVE_BASE_BREAKPOINT_PRIORITY: ResponsiveBreakpoint[] = ["lg", "xl", "md", "sm", "xs"];

const BREAKPOINT_SUFFIX_TOKEN_TO_VALUE: Record<string, ResponsiveBreakpoint> = {
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

interface ComparableLayoutState {
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap: number;
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  widthRatio?: number;
  minHeight?: number;
}

interface TopLevelLayoutMatchEntry {
  elementId: string;
  layout: ComparableLayoutState;
}

const RESPONSIVE_WIDTH_RATIO_MIN = 0.001;
const RESPONSIVE_WIDTH_RATIO_MAX = 1.2;
const RESPONSIVE_WIDTH_RATIO_EPSILON = 0.01;
const RESPONSIVE_MIN_HEIGHT_EPSILON_PX = 1;

const normalizeComparableWidthRatio = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = clamp(value, RESPONSIVE_WIDTH_RATIO_MIN, RESPONSIVE_WIDTH_RATIO_MAX);
  return Math.round(normalized * 1000) / 1000;
};

const normalizeComparableMinHeight = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
};

interface MappedScreenCandidate {
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
  depthTruncatedBranchCount: number;
  firstTruncatedDepth?: number;
}

interface PreparedScreenCandidate {
  candidate: FigmaNode;
  normalized: { node: FigmaNode; name: string };
}

interface ScreenGroupResolution {
  groupKey: string;
  winnersByBreakpoint: Map<ResponsiveBreakpoint, MappedScreenCandidate>;
  baseBreakpoint: ResponsiveBreakpoint;
  baseCandidate: MappedScreenCandidate;
}

const toAsciiLower = (value: string): string => {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

const toNameTokens = (value: string): string[] => {
  return toAsciiLower(value).match(/[a-z0-9]+/g) ?? [];
};

const resolveScreenGroupKey = ({
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

const resolveResponsiveBreakpointFromWidth = (width: number | undefined): ResponsiveBreakpoint => {
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

const toComparableRootLayout = (node: FigmaNode): ComparableLayoutState => {
  return {
    layoutMode: node.layoutMode ?? "NONE",
    gap: node.itemSpacing ?? 0,
    ...(node.primaryAxisAlignItems ? { primaryAxisAlignItems: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxisAlignItems: node.counterAxisAlignItems } : {})
  };
};

const toComparableElementLayout = ({
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

const toResponsiveMatchElementName = (name: string): string => {
  const tokens = toNameTokens(name);
  return tokens.length > 0 ? tokens.join("-") : "element";
};

const buildTopLevelLayoutMatchMap = ({
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

const resolveLayoutOverride = ({
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

const compareResponsiveWinnerPriority = (left: MappedScreenCandidate, right: MappedScreenCandidate): number => {
  if (left.originalElements !== right.originalElements) {
    return right.originalElements - left.originalElements;
  }
  if (left.area !== right.area) {
    return right.area - left.area;
  }
  return left.sourceNode.id.localeCompare(right.sourceNode.id);
};

const mapScreenCandidate = ({
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
  const { elements: budgetedChildren, retainedCount } =
    originalElements > screenElementBudget
      ? truncateElementsToBudget({ elements: mappedChildren, budget: screenElementBudget })
      : { elements: mappedChildren, retainedCount: originalElements };

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
    truncatedByBudget: originalElements > screenElementBudget,
    depthTruncatedBranchCount: depthContext.truncatedBranchCount,
    ...(depthContext.firstTruncatedDepth !== undefined
      ? { firstTruncatedDepth: depthContext.firstTruncatedDepth }
      : {})
  };
};

const buildResponsiveMetadata = ({
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

const toScreenFromCandidate = ({
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

const collectScreenCandidates = ({
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

const prepareScreenCandidates = ({
  screenCandidates
}: {
  screenCandidates: FigmaNode[];
}): PreparedScreenCandidate[] => {
  return screenCandidates.map((candidate) => ({
    candidate,
    normalized: unwrapScreenRoot(candidate)
  }));
};

const buildScreenNavigationContext = ({
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

const mapPreparedScreenCandidates = ({
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

const groupMappedScreenCandidates = ({
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

const selectResponsiveWinnersByBreakpoint = ({
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

const resolveScreenGroupResolution = ({
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

const appendBaseCandidateMetrics = ({
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
      budget: screenElementBudget
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

const assembleScreensFromGroups = ({
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

const extractScreens = ({
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

const TOKEN_DERIVATION_DEFAULTS: DesignTokens = {
  palette: {
    primary: "#d4001a",
    secondary: "#5f8f2f",
    background: "#f7f8fb",
    text: "#1f2937",
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    info: "#0288D1",
    divider: "#1f29371f",
    action: {
      active: "#1f29378a",
      hover: "#d4001a0a",
      selected: "#d4001a14",
      disabled: "#1f293742",
      disabledBackground: "#1f29371f",
      focus: "#d4001a1f"
    }
  },
  borderRadius: 8,
  spacingBase: 8,
  fontFamily: "Roboto, Arial, sans-serif",
  headingSize: 24,
  bodySize: 14,
  typography: completeTypographyScale({
    fontFamily: "Roboto, Arial, sans-serif",
    headingSize: 24,
    bodySize: 14
  })
};

const COLOR_CLUSTER_STEP = 16;
const COLOR_CLUSTER_MERGE_THRESHOLD = 0.12;
const TYPOGRAPHY_SIZE_SNAP_THRESHOLD_PX = 1.75;
const TYPOGRAPHY_INTEGER_EPSILON_PX = 0.15;

const emptyContextWeights = (): Record<ColorSampleContext, number> => ({
  button: 0,
  heading: 0,
  body: 0,
  surface: 0,
  decorative: 0
});

const parseHexChannel = (hex: string, start: number): number => {
  const normalized = hex.replace("#", "");
  const parsed = Number.parseInt(normalized.slice(start, start + 2), 16);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(parsed, 0, 255);
};

const resolveNodeArea = (node: FigmaNode): number => {
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  return Math.max(1, width * height);
};

const resolveTextRole = (node: FigmaNode): "heading" | "body" => {
  const fontSize = node.style?.fontSize ?? 0;
  const fontWeight = node.style?.fontWeight ?? 0;
  const loweredName = (node.name ?? "").toLowerCase();
  if (
    fontSize >= 20 ||
    fontWeight >= 650 ||
    hasAnySubstring(loweredName, ["heading", "headline", "title", "h1", "h2", "h3"])
  ) {
    return "heading";
  }
  return "body";
};

const resolveNodeStyleCatalog = (file: FigmaFile): Map<string, string> => {
  const catalog = new Map<string, string>();
  for (const [styleId, styleEntry] of Object.entries(file.styles ?? {})) {
    const normalized = [styleEntry.name, styleEntry.styleType, styleEntry.style_type]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .toLowerCase();
    if (normalized.length > 0) {
      catalog.set(styleId, normalized);
    }
  }
  return catalog;
};

const resolveNodeStyleNames = (node: FigmaNode, styleCatalog: Map<string, string>): string[] => {
  const styleIds = [
    ...Object.values(node.styles ?? {}).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    node.fillStyleId,
    node.strokeStyleId,
    node.effectStyleId,
    node.textStyleId
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const names = styleIds
    .map((styleId) => styleCatalog.get(styleId))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return [...new Set(names)];
};

const deriveStyleSignals = ({
  styleNames,
  nodeName
}: {
  styleNames: string[];
  nodeName: string | undefined;
}): Record<StyleSignalKey, number> => {
  const signals = emptyStyleSignals();
  const signalSources = [...styleNames];
  if (typeof nodeName === "string" && nodeName.trim().length > 0) {
    signalSources.push(nodeName.toLowerCase());
  }

  for (const signalSource of signalSources) {
    if (hasAnySubstring(signalSource, ["primary"])) {
      signals.primary += 1;
    }
    if (hasAnySubstring(signalSource, ["secondary"])) {
      signals.secondary += 1;
    }
    if (hasAnySubstring(signalSource, ["background", "surface", "canvas", "paper"])) {
      signals.background += 1;
    }
    if (hasAnySubstring(signalSource, ["text", "foreground", "content"])) {
      signals.text += 1;
    }
    if (hasAnySubstring(signalSource, ["brand"])) {
      signals.brand += 1;
    }
    if (hasAnySubstring(signalSource, ["accent", "highlight"])) {
      signals.accent += 1;
    }
    if (hasAnySubstring(signalSource, ["success", "valid", "done", "positive"])) {
      signals.success += 1;
    }
    if (hasAnySubstring(signalSource, ["warning", "alert", "caution"])) {
      signals.warning += 1;
    }
    if (hasAnySubstring(signalSource, ["error", "danger", "invalid", "negative"])) {
      signals.error += 1;
    }
    if (hasAnySubstring(signalSource, ["info", "hint", "help", "notice"])) {
      signals.info += 1;
    }
    if (hasAnySubstring(signalSource, ["divider", "separator", "border", "outline", "stroke"])) {
      signals.divider += 1;
    }
  }
  return signals;
};

const resolveSampleWeight = ({
  node,
  context
}: {
  node: FigmaNode;
  context: ColorSampleContext;
}): number => {
  const area = resolveNodeArea(node);
  const textWidth = node.absoluteBoundingBox?.width ?? 120;
  const base = (() => {
    switch (context) {
      case "button":
        return 16;
      case "heading":
        return 12;
      case "body":
        return 9;
      case "surface":
        return 6;
      case "decorative":
      default:
        return 2;
    }
  })();

  if (context === "heading" || context === "body") {
    const emphasis = (node.style?.fontWeight ?? 0) >= 650 ? 1.15 : 1;
    return base * clamp(textWidth / 160, 1, 6) * emphasis;
  }

  return base * clamp(Math.sqrt(area) / 120, 1, 8);
};

const resolveFillColor = (node: FigmaNode): string | undefined => {
  const fill = resolveFirstVisibleSolidPaint(node.fills);
  return toHexColor(fill?.color, fill?.opacity);
};

const resolveStrokeColor = (node: FigmaNode): string | undefined => {
  const stroke = resolveFirstVisibleSolidPaint(node.strokes);
  return toHexColor(stroke?.color, stroke?.opacity);
};

const resolveShapeContext = (node: FigmaNode): ColorSampleContext => {
  const loweredName = (node.name ?? "").toLowerCase();
  const hasButtonHint = hasAnySubstring(loweredName, [
    "button",
    "cta",
    "chip",
    "tab",
    "navigationaction",
    "appbar"
  ]);
  if (hasButtonHint) {
    return "button";
  }

  const area = resolveNodeArea(node);
  if ((node.type === "FRAME" || node.type === "RECTANGLE") && area >= 3_000) {
    return "surface";
  }

  return "decorative";
};

const collectColorSamples = ({
  nodes,
  styleCatalog
}: {
  nodes: FigmaNode[];
  styleCatalog: Map<string, string>;
}): ColorSample[] => {
  const samples: ColorSample[] = [];

  for (const node of nodes) {
    const styleNames = resolveNodeStyleNames(node, styleCatalog);
    const styleSignals = deriveStyleSignals({ styleNames, nodeName: node.name });

    const fillColor = resolveFillColor(node);
    if (fillColor) {
      const context = node.type === "TEXT" ? resolveTextRole(node) : resolveShapeContext(node);
      samples.push({
        color: fillColor,
        context,
        styleSignals,
        weight: resolveSampleWeight({ node, context })
      });
    }

    const strokeColor = resolveStrokeColor(node);
    if (strokeColor && node.type !== "TEXT") {
      samples.push({
        color: strokeColor,
        context: "decorative",
        styleSignals,
        weight: Math.max(1, resolveSampleWeight({ node, context: "decorative" }) * 0.2)
      });
    }
  }

  return samples;
};

const finalizeClusterColor = (cluster: ColorCluster): string => {
  if (cluster.totalWeight <= 0) {
    return cluster.color;
  }
  return toHexFromRgb(
    cluster.channels.r / cluster.totalWeight,
    cluster.channels.g / cluster.totalWeight,
    cluster.channels.b / cluster.totalWeight
  );
};

const mergeClusters = (target: ColorCluster, source: ColorCluster): void => {
  target.totalWeight += source.totalWeight;
  target.channels.r += source.channels.r;
  target.channels.g += source.channels.g;
  target.channels.b += source.channels.b;
  for (const key of Object.keys(target.contexts) as ColorSampleContext[]) {
    target.contexts[key] += source.contexts[key];
  }
  addStyleSignals(target.styleSignals, source.styleSignals);
  target.color = finalizeClusterColor(target);
};

const clusterSamples = (samples: ColorSample[]): ColorCluster[] => {
  const buckets = new Map<string, ColorCluster>();

  for (const sample of samples) {
    const key = quantizeColorKey(sample.color, COLOR_CLUSTER_STEP);
    const existing = buckets.get(key);
    if (!existing) {
      const created: ColorCluster = {
        color: key,
        totalWeight: 0,
        channels: {
          r: 0,
          g: 0,
          b: 0
        },
        contexts: emptyContextWeights(),
        styleSignals: emptyStyleSignals()
      };
      buckets.set(key, created);
    }

    const cluster = buckets.get(key);
    if (!cluster) {
      continue;
    }
    cluster.totalWeight += sample.weight;
    cluster.channels.r += parseHexChannel(sample.color, 0) * sample.weight;
    cluster.channels.g += parseHexChannel(sample.color, 2) * sample.weight;
    cluster.channels.b += parseHexChannel(sample.color, 4) * sample.weight;
    cluster.contexts[sample.context] += sample.weight;
    addStyleSignals(cluster.styleSignals, sample.styleSignals, sample.weight);
    cluster.color = finalizeClusterColor(cluster);
  }

  const merged: ColorCluster[] = [];
  const sorted = [...buckets.values()].sort((left, right) => right.totalWeight - left.totalWeight);
  for (const cluster of sorted) {
    const match = merged.find((candidate) => colorDistance(candidate.color, cluster.color) <= COLOR_CLUSTER_MERGE_THRESHOLD);
    if (match) {
      mergeClusters(match, cluster);
    } else {
      merged.push({
        color: cluster.color,
        totalWeight: cluster.totalWeight,
        channels: { ...cluster.channels },
        contexts: { ...cluster.contexts },
        styleSignals: { ...cluster.styleSignals }
      });
    }
  }

  return merged.sort((left, right) => right.totalWeight - left.totalWeight);
};

const resolveHue = (hex: string): number | undefined => {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return undefined;
  }

  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return (hue * 60 + 360) % 360;
};

const resolveColorFamily = (hex: string): ColorFamily => {
  if (saturation(hex) <= 0.12) {
    return "neutral";
  }

  const hue = resolveHue(hex);
  if (hue === undefined) {
    return "other";
  }
  if (hue < 20 || hue >= 345) {
    return "red";
  }
  if (hue < 50) {
    return "orange";
  }
  if (hue < 75) {
    return "yellow";
  }
  if (hue < 170) {
    return "green";
  }
  if (hue < 330) {
    return "blue";
  }
  return "other";
};

const resolveSemanticFamilyScore = ({
  semanticKey,
  color
}: {
  semanticKey: SemanticPaletteKey;
  color: string;
}): number => {
  const family = resolveColorFamily(color);
  if (semanticKey === "divider") {
    return family === "neutral" ? 5 : family === "other" ? -1 : -3;
  }

  const familyPreferences: Record<Exclude<SemanticPaletteKey, "divider">, ColorFamily[]> = {
    success: ["green"],
    warning: ["orange", "yellow"],
    error: ["red"],
    info: ["blue"]
  };
  const preferences = familyPreferences[semanticKey];
  const index = preferences.indexOf(family);
  if (index === 0) {
    return 5;
  }
  if (index === 1) {
    return 3.5;
  }
  if (family === "neutral") {
    return -3.5;
  }
  return -1.5;
};

const isDistinctFromColors = ({
  color,
  references,
  minDistance
}: {
  color: string;
  references: Array<string | undefined>;
  minDistance: number;
}): boolean => {
  return references.every((reference) => !reference || colorDistance(color, reference) >= minDistance);
};

const pickDistinctColor = ({
  candidates,
  references,
  minDistance
}: {
  candidates: string[];
  references: Array<string | undefined>;
  minDistance: number;
}): string => {
  const [fallbackCandidate] = candidates;
  if (!fallbackCandidate) {
    return TOKEN_DERIVATION_DEFAULTS.palette.info;
  }
  return candidates.find((candidate) => isDistinctFromColors({ color: candidate, references, minDistance })) ?? fallbackCandidate;
};

const resolveSemanticFallbackColor = ({
  semanticKey,
  textColor,
  primaryColor
}: {
  semanticKey: SemanticPaletteKey;
  textColor: string;
  primaryColor: string;
}): string => {
  switch (semanticKey) {
    case "success":
      return TOKEN_DERIVATION_DEFAULTS.palette.success;
    case "warning":
      return TOKEN_DERIVATION_DEFAULTS.palette.warning;
    case "error":
      return TOKEN_DERIVATION_DEFAULTS.palette.error;
    case "info":
      return pickDistinctColor({
        candidates: ["#0288D1", "#1976D2", "#4DABF5"],
        references: [primaryColor],
        minDistance: 0.08
      });
    case "divider":
      return toHexWithAlpha(textColor, 0.12);
  }
};

const buildActionPalette = ({
  primaryColor,
  textColor
}: {
  primaryColor: string;
  textColor: string;
}): DesignTokens["palette"]["action"] => {
  return {
    active: toHexWithAlpha(textColor, 0.54),
    hover: toHexWithAlpha(primaryColor, 0.04),
    selected: toHexWithAlpha(primaryColor, 0.08),
    disabled: toHexWithAlpha(textColor, 0.26),
    disabledBackground: toHexWithAlpha(textColor, 0.12),
    focus: toHexWithAlpha(primaryColor, 0.12)
  };
};

const chooseSemanticColor = ({
  semanticKey,
  clusters,
  backgroundColor,
  textColor,
  primaryColor,
  secondaryColor
}: {
  semanticKey: SemanticPaletteKey;
  clusters: ColorCluster[];
  backgroundColor: string;
  textColor: string;
  primaryColor: string;
  secondaryColor: string;
}): string => {
  const fallback = resolveSemanticFallbackColor({
    semanticKey,
    textColor,
    primaryColor
  });
  if (clusters.length === 0) {
    return fallback;
  }

  if (semanticKey === "divider") {
    const pool = clusters.filter((cluster) => colorDistance(cluster.color, backgroundColor) >= 0.02);
    const candidates = (pool.length > 0 ? pool : clusters).filter((cluster) => cluster.styleSignals.divider > 0);
    if (candidates.length === 0) {
      return fallback;
    }

    const scored = candidates
      .map((cluster) => {
        const distanceFromBackground = colorDistance(cluster.color, backgroundColor);
        let score =
          cluster.styleSignals.divider * 7 +
          cluster.contexts.decorative * 1.5 +
          cluster.contexts.surface * 1.1 +
          cluster.totalWeight * 0.03 +
          resolveSemanticFamilyScore({ semanticKey, color: cluster.color });
        if (distanceFromBackground >= 0.03 && distanceFromBackground <= 0.22) {
          score += 2.5;
        } else if (distanceFromBackground > 0.3) {
          score -= 1.5;
        }
        const ratio = contrastRatio(cluster.color, backgroundColor);
        if (ratio >= 1.1 && ratio <= 2) {
          score += 1.2;
        }
        if (colorDistance(cluster.color, textColor) < 0.04) {
          score -= 5;
        }
        return { color: cluster.color, score };
      })
      .sort((left, right) => right.score - left.score);

    const selected = scored.find(({ score }) => score >= 2.5)?.color;
    return selected ?? fallback;
  }

  const pool = clusters.filter(
    (cluster) => colorDistance(cluster.color, backgroundColor) >= 0.08 && colorDistance(cluster.color, textColor) >= 0.08
  );
  if (pool.length === 0) {
    return fallback;
  }

  const scoreSemanticCandidate = (cluster: ColorCluster): { color: string; score: number; familyScore: number } => {
    const familyScore = resolveSemanticFamilyScore({ semanticKey, color: cluster.color });
    const ratio = contrastRatio(cluster.color, backgroundColor);
    let score =
      cluster.styleSignals[semanticKey] * 6 +
      cluster.contexts.button * 1.4 +
      cluster.contexts.body +
      cluster.contexts.heading * 0.8 +
      cluster.contexts.decorative * 0.4 +
      cluster.totalWeight * 0.03 +
      familyScore;
    if (cluster.styleSignals[semanticKey] === 0) {
      score -= 3.5;
    }
    if (ratio >= 3) {
      score += 1.5;
    } else {
      score -= 1.5;
    }
    if (colorDistance(cluster.color, primaryColor) < 0.05) {
      score -= semanticKey === "info" ? 10 : 2.5;
    }
    if (colorDistance(cluster.color, secondaryColor) < 0.05) {
      score -= 1;
    }
    return { color: cluster.color, score, familyScore };
  };

  const sortSemanticCandidates = (
    candidates: ColorCluster[]
  ): Array<{ color: string; score: number; familyScore: number }> => {
    return candidates
      .map(scoreSemanticCandidate)
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        const familyDelta = right.familyScore - left.familyScore;
        if (familyDelta !== 0) {
          return familyDelta;
        }
        return left.color.localeCompare(right.color);
      });
  };

  const signalCandidates = pool.filter((cluster) => cluster.styleSignals[semanticKey] > 0);
  if (signalCandidates.length > 0) {
    const signalSelection = sortSemanticCandidates(signalCandidates).find(({ color, score }) => {
      if (score < 3.5) {
        return false;
      }
      if (semanticKey === "info") {
        return isDistinctFromColors({
          color,
          references: [primaryColor],
          minDistance: 0.08
        });
      }
      return true;
    })?.color;
    if (signalSelection) {
      return signalSelection;
    }
  }

  const familyCandidates = pool.filter((cluster) => resolveSemanticFamilyScore({ semanticKey, color: cluster.color }) > 0);
  if (familyCandidates.length === 0) {
    return fallback;
  }
  const familySelection = sortSemanticCandidates(familyCandidates).find(({ color, familyScore }) => {
    if (familyScore <= 0) {
      return false;
    }
    if (semanticKey === "info") {
      return isDistinctFromColors({
        color,
        references: [primaryColor],
        minDistance: 0.08
      });
    }
    return true;
  })?.color;
  return familySelection ?? fallback;
};

const chooseBackgroundColor = (clusters: ColorCluster[]): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.background;
  }

  const rank = (cluster: ColorCluster): number => {
    return (
      cluster.contexts.surface * 1.6 +
      cluster.styleSignals.background * 3.2 +
      cluster.totalWeight * 0.08 +
      luminance(cluster.color) * 4.2 -
      saturation(cluster.color) * 1.4
    );
  };

  const brightCandidates = clusters.filter((cluster) => luminance(cluster.color) >= 0.65);
  const pool = brightCandidates.length > 0 ? brightCandidates : clusters;
  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = rank(right) - rank(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return luminance(right.color) - luminance(left.color);
  });
  return sorted[0]?.color ?? TOKEN_DERIVATION_DEFAULTS.palette.background;
};

const chooseTextColor = ({
  clusters,
  backgroundColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
}): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.text;
  }

  const rolePool = clusters.filter((cluster) => cluster.contexts.body + cluster.contexts.heading > 0);
  const pool = rolePool.length > 0 ? rolePool : clusters;

  const score = (cluster: ColorCluster): number => {
    const ratio = contrastRatio(cluster.color, backgroundColor);
    let value =
      cluster.contexts.body * 1.2 +
      cluster.contexts.heading +
      cluster.styleSignals.text * 3.5 +
      (1 - luminance(cluster.color)) * 2.4 +
      cluster.totalWeight * 0.04;
    if (ratio >= 4.5) {
      value += 6;
    } else {
      value -= (4.5 - ratio) * 4;
    }
    if (colorDistance(cluster.color, backgroundColor) < 0.08) {
      value -= 10;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return contrastRatio(right.color, backgroundColor) - contrastRatio(left.color, backgroundColor);
  });

  const candidate = sorted[0]?.color;
  if (!candidate) {
    return TOKEN_DERIVATION_DEFAULTS.palette.text;
  }

  const candidateRatio = contrastRatio(candidate, backgroundColor);
  if (candidateRatio >= 4.5) {
    return candidate;
  }

  const black = "#111111";
  const white = "#ffffff";
  return contrastRatio(black, backgroundColor) >= contrastRatio(white, backgroundColor) ? black : white;
};

const choosePrimaryColor = ({
  clusters,
  backgroundColor,
  textColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
  textColor: string;
}): string => {
  if (clusters.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.primary;
  }

  const candidates = clusters.filter((cluster) => colorDistance(cluster.color, backgroundColor) >= 0.08);
  const pool = candidates.length > 0 ? candidates : clusters;

  const score = (cluster: ColorCluster): number => {
    let value =
      cluster.contexts.button * 2.5 +
      cluster.contexts.heading * 1.3 +
      cluster.styleSignals.primary * 4.2 +
      cluster.styleSignals.brand * 2.4 +
      cluster.styleSignals.accent * 1.4 +
      saturation(cluster.color) * 2.6 +
      cluster.totalWeight * 0.04;
    if (contrastRatio(cluster.color, backgroundColor) >= 3) {
      value += 3;
    } else {
      value -= 2;
    }
    if (colorDistance(cluster.color, textColor) < 0.08) {
      value -= 8;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return saturation(right.color) - saturation(left.color);
  });
  return sorted[0]?.color ?? TOKEN_DERIVATION_DEFAULTS.palette.primary;
};

const chooseSecondaryColor = ({
  clusters,
  backgroundColor,
  primaryColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
  primaryColor: string;
}): string => {
  const pool = clusters.filter((cluster) => colorDistance(cluster.color, primaryColor) >= 0.14);
  if (pool.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.secondary;
  }

  const score = (cluster: ColorCluster): number => {
    let value =
      cluster.styleSignals.secondary * 4.4 +
      cluster.styleSignals.accent * 2.2 +
      cluster.contexts.heading +
      cluster.contexts.button * 0.8 +
      saturation(cluster.color) * 2 +
      colorDistance(cluster.color, primaryColor) * 2 +
      cluster.totalWeight * 0.03;
    if (contrastRatio(cluster.color, backgroundColor) >= 3) {
      value += 1.2;
    }
    return value;
  };

  const sorted = [...pool].sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return colorDistance(right.color, primaryColor) - colorDistance(left.color, primaryColor);
  });

  const selected = sorted[0]?.color;
  if (!selected || selected === primaryColor) {
    return TOKEN_DERIVATION_DEFAULTS.palette.secondary;
  }
  return selected;
};

const isUppercaseLikeText = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const letters = value.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length < 2) {
    return false;
  }
  const uppercaseLetters = letters.replace(/[^A-ZÄÖÜ]/g, "");
  return uppercaseLetters.length / letters.length >= 0.8;
};

const isButtonLikeTextNode = ({
  node,
  ancestorNames
}: {
  node: FigmaNode;
  ancestorNames: string[];
}): boolean => {
  const combined = [node.name, ...ancestorNames].join(" ").toLowerCase();
  return (
    hasAnySubstring(combined, ["muibutton", "buttonbase", "buttonlabel"]) ||
    hasAnyWord(combined, ["button", "cta", "chip", "tab", "step", "pill"])
  );
};

const collectFontSamples = (root: FigmaNode | undefined): FontSample[] => {
  if (!root) {
    return [];
  }

  const samples: FontSample[] = [];
  const visit = (node: FigmaNode, ancestorNames: string[]): void => {
    if (node.visible === false) {
      return;
    }

    if (node.type === "TEXT" && hasMeaningfulNodeText(node)) {
      const role = resolveTextRole(node);
      const size = node.style?.fontSize ?? (role === "heading" ? 24 : 14);
      const height = node.absoluteBoundingBox?.height ?? Math.max(size * (role === "heading" ? 1.3 : 1.5), size);
      const width = node.absoluteBoundingBox?.width ?? 120;
      const family = node.style?.fontFamily?.trim() || (TOKEN_DERIVATION_DEFAULTS.fontFamily.split(",")[0] ?? "Roboto");
      const fontWeight = node.style?.fontWeight ?? (role === "heading" ? 700 : 400);
      const lineHeight = node.style?.lineHeightPx ?? Math.max(Math.round(size * (role === "heading" ? 1.3 : 1.5)), size);
      const isButtonLike = isButtonLikeTextNode({ node, ancestorNames });
      const roleWeight = role === "heading" ? 1.8 : 1;
      const prominenceWeight = clamp(size / 16, 0.75, 2.5);
      const geometryWeight = clamp(width / 160 + height / 96, 1, 8);
      samples.push({
        family,
        role,
        size,
        weight: geometryWeight * roleWeight * prominenceWeight * (isButtonLike ? 1.15 : 1),
        fontWeight,
        lineHeight,
        ...(typeof node.style?.letterSpacing === "number" && Number.isFinite(node.style.letterSpacing)
          ? { letterSpacingPx: node.style.letterSpacing }
          : {}),
        isButtonLike,
        isUppercaseLike: isUppercaseLikeText(node.characters)
      });
    }

    const nextAncestorNames = node.name ? [node.name, ...ancestorNames] : ancestorNames;
    for (const child of node.children ?? []) {
      visit(child, nextAncestorNames);
    }
  };

  visit(root, []);
  return samples;
};

const resolveTypographyAnchorSizes = (samples: FontSample[]): number[] => {
  const anchors = new Set<number>();
  for (const sample of samples) {
    const rounded = Math.round(sample.size);
    if (Math.abs(sample.size - rounded) <= TYPOGRAPHY_INTEGER_EPSILON_PX) {
      anchors.add(rounded);
    }
  }
  if (anchors.size === 0) {
    anchors.add(TOKEN_DERIVATION_DEFAULTS.headingSize);
    anchors.add(TOKEN_DERIVATION_DEFAULTS.bodySize);
  }
  return [...anchors].sort((left, right) => right - left);
};

const normalizeTypographyClusterSize = ({
  size,
  anchors
}: {
  size: number;
  anchors: number[];
}): number => {
  const rounded = Math.round(size);
  if (Math.abs(size - rounded) <= TYPOGRAPHY_INTEGER_EPSILON_PX) {
    return Math.max(10, rounded);
  }
  const snapped = anchors.find((anchor) => anchor <= size && size - anchor <= TYPOGRAPHY_SIZE_SNAP_THRESHOLD_PX);
  return Math.max(10, snapped ?? rounded);
};

const resolveDominantClusterFontFamily = (samples: FontSample[]): string | undefined => {
  const weights = new Map<string, number>();
  for (const sample of samples) {
    weights.set(sample.family, (weights.get(sample.family) ?? 0) + sample.weight);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

const clusterTypographySamples = (samples: FontSample[]): TypographyCluster[] => {
  if (samples.length === 0) {
    return [];
  }

  const anchors = resolveTypographyAnchorSizes(samples);
  const grouped = new Map<number, FontSample[]>();
  for (const sample of samples) {
    const key = normalizeTypographyClusterSize({
      size: sample.size,
      anchors
    });
    grouped.set(key, [...(grouped.get(key) ?? []), sample]);
  }

  return [...grouped.entries()]
    .map(([normalizedSize, clusterSamples]) => {
      const totalWeight = clusterSamples.reduce((sum, sample) => sum + sample.weight, 0);
      const headingWeight = clusterSamples
        .filter((sample) => sample.role === "heading")
        .reduce((sum, sample) => sum + sample.weight, 0);
      const bodyWeight = clusterSamples
        .filter((sample) => sample.role === "body")
        .reduce((sum, sample) => sum + sample.weight, 0);
      const buttonWeight = clusterSamples
        .filter((sample) => sample.isButtonLike)
        .reduce((sum, sample) => sum + sample.weight, 0);
      const uppercaseWeight = clusterSamples
        .filter((sample) => sample.isUppercaseLike)
        .reduce((sum, sample) => sum + sample.weight, 0);
      const cluster: TypographyCluster = {
        normalizedSize,
        totalWeight,
        headingWeight,
        bodyWeight,
        buttonWeight,
        uppercaseWeight,
        fontWeight: Math.round(
          weightedMedian(
            clusterSamples.map((sample) => ({
              value: sample.fontWeight,
              weight: sample.weight
            }))
          ) ?? 400
        ),
        lineHeight: Math.round(
          weightedMedian(
            clusterSamples.map((sample) => ({
              value: sample.lineHeight,
              weight: sample.weight
            }))
          ) ?? Math.max(normalizedSize, Math.round(normalizedSize * 1.4))
        )
      };
      const dominantFontFamily = resolveDominantClusterFontFamily(clusterSamples);
      if (dominantFontFamily) {
        cluster.fontFamily = dominantFontFamily;
      }
      const letterSpacingEm = weightedMedian(
        clusterSamples
          .filter(
            (sample): sample is FontSample & { letterSpacingPx: number } =>
              typeof sample.letterSpacingPx === "number" && Number.isFinite(sample.letterSpacingPx) && sample.size > 0
          )
          .map((sample) => ({
            value: sample.letterSpacingPx / sample.size,
            weight: sample.weight
          }))
      );
      if (typeof letterSpacingEm === "number") {
        cluster.letterSpacingEm = letterSpacingEm;
      }
      return cluster;
    })
    .sort((left, right) => {
      if (right.normalizedSize !== left.normalizedSize) {
        return right.normalizedSize - left.normalizedSize;
      }
      if (right.headingWeight !== left.headingWeight) {
        return right.headingWeight - left.headingWeight;
      }
      return right.totalWeight - left.totalWeight;
    });
};

const toTypographyVariantFromCluster = ({
  cluster,
  fallbackFontFamily,
  textTransform,
  letterSpacingEm
}: {
  cluster: TypographyCluster;
  fallbackFontFamily: string;
  textTransform?: DesignTokenTypographyVariant["textTransform"];
  letterSpacingEm?: number;
}): DesignTokenTypographyVariant => {
  return {
    fontSizePx: cluster.normalizedSize,
    fontWeight: cluster.fontWeight,
    lineHeightPx: Math.max(cluster.normalizedSize, cluster.lineHeight),
    fontFamily: cluster.fontFamily ?? fallbackFontFamily,
    ...(typeof (letterSpacingEm ?? cluster.letterSpacingEm) === "number"
      ? { letterSpacingEm: letterSpacingEm ?? cluster.letterSpacingEm }
      : {}),
    ...(textTransform ? { textTransform } : {})
  };
};

const chooseBodyTypographyCluster = (clusters: TypographyCluster[]): TypographyCluster | undefined => {
  return [...clusters].sort((left, right) => {
    const leftScore =
      left.bodyWeight * 2.6 + left.totalWeight * 0.9 + (left.normalizedSize >= 12 && left.normalizedSize <= 18 ? 2 : 0);
    const rightScore =
      right.bodyWeight * 2.6 +
      right.totalWeight * 0.9 +
      (right.normalizedSize >= 12 && right.normalizedSize <= 18 ? 2 : 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.totalWeight - left.totalWeight;
  })[0];
};

const chooseButtonTypographyCluster = (clusters: TypographyCluster[]): TypographyCluster | undefined => {
  return [...clusters].sort((left, right) => {
    const leftScore =
      left.buttonWeight * 3 + left.fontWeight * 0.01 + left.totalWeight * 0.4 + (left.normalizedSize >= 14 ? 0.5 : 0);
    const rightScore =
      right.buttonWeight * 3 +
      right.fontWeight * 0.01 +
      right.totalWeight * 0.4 +
      (right.normalizedSize >= 14 ? 0.5 : 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.normalizedSize - left.normalizedSize;
  })[0];
};

const findNextLargerTypographyCluster = ({
  clusters,
  size
}: {
  clusters: TypographyCluster[];
  size: number;
}): TypographyCluster | undefined => {
  return [...clusters].reverse().find((cluster) => cluster.normalizedSize > size);
};

const findNextSmallerTypographyCluster = ({
  clusters,
  size
}: {
  clusters: TypographyCluster[];
  size: number;
}): TypographyCluster | undefined => {
  return clusters.find((cluster) => cluster.normalizedSize < size);
};

const chooseHeadingTypographyClusters = ({
  clusters,
  bodySize
}: {
  clusters: TypographyCluster[];
  bodySize: number;
}): TypographyCluster[] => {
  const preferred = clusters.filter(
    (cluster) => cluster.normalizedSize > bodySize || cluster.headingWeight >= cluster.bodyWeight
  );
  const pool = preferred.length > 0 ? preferred : clusters;
  return [...pool]
    .sort((left, right) => {
      if (right.normalizedSize !== left.normalizedSize) {
        return right.normalizedSize - left.normalizedSize;
      }
      if (right.headingWeight !== left.headingWeight) {
        return right.headingWeight - left.headingWeight;
      }
      return right.totalWeight - left.totalWeight;
    })
    .slice(0, HEADING_TYPOGRAPHY_VARIANTS.length);
};

type PartialTypographyScale = Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>>;

interface DerivedTypographyClusterSelection {
  body1Cluster: TypographyCluster | undefined;
  body2Cluster: TypographyCluster | undefined;
  subtitle2Cluster: TypographyCluster | undefined;
  subtitle1Cluster: TypographyCluster | undefined;
  captionCluster: TypographyCluster | undefined;
  overlineCluster: TypographyCluster | undefined;
  buttonCluster: TypographyCluster | undefined;
  headingClusters: TypographyCluster[];
}

const resolveClusterFallback = (
  ...clusters: Array<TypographyCluster | undefined>
): TypographyCluster | undefined => {
  return clusters.find((cluster): cluster is TypographyCluster => cluster !== undefined);
};

const assignTypographyVariant = ({
  partialScale,
  variantName,
  cluster,
  fallbackFontFamily,
  textTransform,
  letterSpacingEm
}: {
  partialScale: PartialTypographyScale;
  variantName: DesignTokenTypographyVariantName;
  cluster: TypographyCluster | undefined;
  fallbackFontFamily: string;
  textTransform?: DesignTokenTypographyVariant["textTransform"];
  letterSpacingEm?: number;
}): void => {
  if (!cluster) {
    return;
  }
  partialScale[variantName] = toTypographyVariantFromCluster({
    cluster,
    fallbackFontFamily,
    ...(textTransform ? { textTransform } : {}),
    ...(typeof letterSpacingEm === "number" ? { letterSpacingEm } : {})
  });
};

const mapHeadingVariants = ({
  partialScale,
  headingClusters,
  subtitle1Cluster,
  body1Cluster,
  fallbackFontFamily
}: {
  partialScale: PartialTypographyScale;
  headingClusters: TypographyCluster[];
  subtitle1Cluster: TypographyCluster | undefined;
  body1Cluster: TypographyCluster | undefined;
  fallbackFontFamily: string;
}): void => {
  let lastHeadingCluster = resolveClusterFallback(headingClusters[0], subtitle1Cluster, body1Cluster);
  for (const [index, variantName] of HEADING_TYPOGRAPHY_VARIANTS.entries()) {
    const cluster = resolveClusterFallback(headingClusters[index], lastHeadingCluster);
    if (!cluster) {
      continue;
    }
    assignTypographyVariant({
      partialScale,
      variantName,
      cluster,
      fallbackFontFamily
    });
    lastHeadingCluster = cluster;
  }
};

const selectTypographyClustersForScale = ({
  clusters,
  bodySize
}: {
  clusters: TypographyCluster[];
  bodySize: number;
}): DerivedTypographyClusterSelection => {
  const body1Cluster = chooseBodyTypographyCluster(clusters);
  const body2Cluster = body1Cluster
    ? findNextSmallerTypographyCluster({ clusters, size: body1Cluster.normalizedSize }) ?? body1Cluster
    : undefined;
  const subtitle2Cluster = body1Cluster
    ? findNextLargerTypographyCluster({ clusters, size: body1Cluster.normalizedSize }) ?? body1Cluster
    : undefined;
  const subtitle1Cluster = subtitle2Cluster
    ? findNextLargerTypographyCluster({ clusters, size: subtitle2Cluster.normalizedSize }) ?? subtitle2Cluster
    : body1Cluster;
  const captionCluster = [...clusters].sort((left, right) => left.normalizedSize - right.normalizedSize)[0] ?? body2Cluster;
  const overlineCluster =
    [...clusters]
      .filter((cluster) => cluster.normalizedSize <= (captionCluster?.normalizedSize ?? Number.POSITIVE_INFINITY))
      .sort((left, right) => right.uppercaseWeight - left.uppercaseWeight || left.normalizedSize - right.normalizedSize)[0] ??
    captionCluster;
  const buttonCluster = chooseButtonTypographyCluster(clusters) ?? body2Cluster ?? subtitle2Cluster ?? body1Cluster;
  const headingClusters = chooseHeadingTypographyClusters({
    clusters,
    bodySize: body1Cluster?.normalizedSize ?? bodySize
  });

  return {
    body1Cluster,
    body2Cluster,
    subtitle2Cluster,
    subtitle1Cluster,
    captionCluster,
    overlineCluster,
    buttonCluster,
    headingClusters
  };
};

const buildDerivedTypographyScale = ({
  clusters,
  fontFamily,
  headingSize,
  bodySize
}: {
  clusters: TypographyCluster[];
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}): DesignTokenTypographyScale => {
  const partialScale: PartialTypographyScale = {};
  const {
    body1Cluster,
    body2Cluster,
    subtitle2Cluster,
    subtitle1Cluster,
    captionCluster,
    overlineCluster,
    buttonCluster,
    headingClusters
  } = selectTypographyClustersForScale({
    clusters,
    bodySize
  });

  mapHeadingVariants({
    partialScale,
    headingClusters,
    subtitle1Cluster,
    body1Cluster,
    fallbackFontFamily: fontFamily
  });

  assignTypographyVariant({
    partialScale,
    variantName: "subtitle1",
    cluster: subtitle1Cluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "subtitle2",
    cluster: resolveClusterFallback(subtitle2Cluster, subtitle1Cluster, body1Cluster),
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "body1",
    cluster: body1Cluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "body2",
    cluster: resolveClusterFallback(body2Cluster, body1Cluster),
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "button",
    cluster: buttonCluster,
    fallbackFontFamily: fontFamily,
    textTransform: "none"
  });
  assignTypographyVariant({
    partialScale,
    variantName: "caption",
    cluster: captionCluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "overline",
    cluster: resolveClusterFallback(overlineCluster, captionCluster),
    fallbackFontFamily: fontFamily,
    letterSpacingEm: overlineCluster?.letterSpacingEm ?? 0.08
  });

  return completeTypographyScale({
    partialScale,
    fontFamily,
    headingSize,
    bodySize
  });
};

const resolveDominantFont = (samples: FontSample[], role: "heading" | "body"): string | undefined => {
  const roleSamples = samples.filter((sample) => sample.role === role);
  const pool = roleSamples.length > 0 ? roleSamples : samples;
  const weights = new Map<string, number>();
  for (const sample of pool) {
    weights.set(sample.family, (weights.get(sample.family) ?? 0) + sample.weight);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

const deriveTokens = (file: FigmaFile): DesignTokens => {
  const nodes = file.document ? collectNodes(file.document, () => true) : [];
  const styleCatalog = resolveNodeStyleCatalog(file);
  const colorSamples = collectColorSamples({ nodes, styleCatalog });
  const clusters = clusterSamples(colorSamples);

  const background = chooseBackgroundColor(clusters);
  const text = chooseTextColor({
    clusters,
    backgroundColor: background
  });
  const primary = choosePrimaryColor({
    clusters,
    backgroundColor: background,
    textColor: text
  });
  const secondary = chooseSecondaryColor({
    clusters,
    backgroundColor: background,
    primaryColor: primary
  });
  const success = chooseSemanticColor({
    semanticKey: "success",
    clusters,
    backgroundColor: background,
    textColor: text,
    primaryColor: primary,
    secondaryColor: secondary
  });
  const warning = chooseSemanticColor({
    semanticKey: "warning",
    clusters,
    backgroundColor: background,
    textColor: text,
    primaryColor: primary,
    secondaryColor: secondary
  });
  const error = chooseSemanticColor({
    semanticKey: "error",
    clusters,
    backgroundColor: background,
    textColor: text,
    primaryColor: primary,
    secondaryColor: secondary
  });
  const info = chooseSemanticColor({
    semanticKey: "info",
    clusters,
    backgroundColor: background,
    textColor: text,
    primaryColor: primary,
    secondaryColor: secondary
  });
  const divider = chooseSemanticColor({
    semanticKey: "divider",
    clusters,
    backgroundColor: background,
    textColor: text,
    primaryColor: primary,
    secondaryColor: secondary
  });

  const spacings = nodes
    .map((node) => node.itemSpacing)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const radii = nodes
    .map((node) => node.cornerRadius)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const fontSamples = collectFontSamples(file.document);
  const headingSize = Math.round(
    weightedMedian(
      fontSamples
        .filter((sample) => sample.role === "heading")
        .map((sample) => ({
          value: sample.size,
          weight: sample.weight
        }))
    ) ?? TOKEN_DERIVATION_DEFAULTS.headingSize
  );
  const bodySize = Math.round(
    weightedMedian(
      fontSamples
        .filter((sample) => sample.role === "body")
        .map((sample) => ({
          value: sample.size,
          weight: sample.weight
        }))
    ) ?? TOKEN_DERIVATION_DEFAULTS.bodySize
  );

  const dominantBodyFont = resolveDominantFont(fontSamples, "body");
  const dominantHeadingFont = resolveDominantFont(fontSamples, "heading");

  const resolvedHeadingSize = Math.max(bodySize + 2, headingSize);
  const resolvedBodySize = Math.max(10, bodySize);
  const resolvedFontFamily = normalizeFontStack(
    [dominantBodyFont, dominantHeadingFont].filter((value): value is string => typeof value === "string")
  );
  const typographyClusters = clusterTypographySamples(fontSamples);
  const typography = buildDerivedTypographyScale({
    clusters: typographyClusters,
    fontFamily: resolvedFontFamily,
    headingSize: resolvedHeadingSize,
    bodySize: resolvedBodySize
  });

  return {
    palette: {
      primary,
      secondary,
      background,
      text,
      success,
      warning,
      error,
      info,
      divider,
      action: buildActionPalette({
        primaryColor: primary,
        textColor: text
      })
    },
    borderRadius: Math.max(1, Math.round(median(radii) ?? TOKEN_DERIVATION_DEFAULTS.borderRadius)),
    spacingBase: Math.max(1, Math.round(median(spacings) ?? TOKEN_DERIVATION_DEFAULTS.spacingBase)),
    fontFamily: resolvedFontFamily,
    headingSize: typography.h1.fontSizePx,
    bodySize: typography.body1.fontSizePx,
    typography
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
  return classifyElementTypeFromSemanticHint({
    semanticName,
    semanticType
  });
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

const parseFigmaPayloadOrThrow = ({ figmaJson }: { figmaJson: unknown }): FigmaFile => {
  const parsed = safeParseFigmaPayload({ input: figmaJson });
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(`Invalid Figma payload: ${summarizeFigmaPayloadValidationError({ error: parsed.error })}`);
};

export const deriveTokensForTesting = (figmaJson: unknown): DesignTokens => {
  return deriveTokens(parseFigmaPayloadOrThrow({ figmaJson }));
};

export const figmaToDesignIr = (figmaJson: unknown): DesignIR => {
  return figmaToDesignIrWithOptions(figmaJson);
};

export const figmaToDesignIrWithOptions = (figmaJson: unknown, options?: FigmaToIrOptions): DesignIR => {
  const parsed = parseFigmaPayloadOrThrow({ figmaJson });
  const resolvedBrandTheme: WorkspaceBrandTheme = options?.brandTheme === "sparkasse" ? "sparkasse" : "derived";
  const placeholderMatcherConfig = resolvePlaceholderMatcherConfig(options?.placeholderRules);
  const screenElementBudget =
    typeof options?.screenElementBudget === "number" && Number.isFinite(options.screenElementBudget)
      ? Math.max(1, Math.trunc(options.screenElementBudget))
      : DEFAULT_SCREEN_ELEMENT_BUDGET;
  const screenElementMaxDepth =
    typeof options?.screenElementMaxDepth === "number" && Number.isFinite(options.screenElementMaxDepth)
      ? Math.max(1, Math.min(64, Math.trunc(options.screenElementMaxDepth)))
      : DEFAULT_SCREEN_ELEMENT_MAX_DEPTH;

  const metrics: MetricsAccumulator = {
    fetchedNodes:
      typeof options?.sourceMetrics?.fetchedNodes === "number" && Number.isFinite(options.sourceMetrics.fetchedNodes)
        ? Math.max(0, Math.trunc(options.sourceMetrics.fetchedNodes))
        : 0,
    skippedHidden: 0,
    skippedPlaceholders: 0,
    prototypeNavigationDetected: 0,
    prototypeNavigationResolved: 0,
    prototypeNavigationUnresolved: 0,
    screenElementCounts: [],
    truncatedScreens: [],
    depthTruncatedScreens: [],
    degradedGeometryNodes: [...(options?.sourceMetrics?.degradedGeometryNodes ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort((left, right) => left.localeCompare(right))
  };

  const screens = extractScreens({
    file: parsed,
    metrics,
    screenElementBudget,
    screenElementMaxDepth,
    placeholderMatcherConfig
  });

  if (screens.length === 0) {
    throw new Error("No top-level frames/components found in Figma file");
  }

  const derivedTokens = deriveTokens(parsed);
  const baseIr: DesignIR = {
    sourceName: parsed.name ?? "Figma File",
    screens,
    tokens: resolvedBrandTheme === "sparkasse" ? applySparkasseThemeDefaults(derivedTokens) : derivedTokens,
    metrics
  };

  if (!options?.mcpEnrichment) {
    return baseIr;
  }
  return applyMcpEnrichmentToIr(baseIr, options.mcpEnrichment);
};
