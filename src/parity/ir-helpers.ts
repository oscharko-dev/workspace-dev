// ---------------------------------------------------------------------------
// ir-helpers.ts — Shared internal helpers for IR derivation
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type {
  CounterAxisAlignItems,
  PrimaryAxisAlignItems,
  ScreenElementIR
} from "./types.js";
import {
  classifyElementTypeDecisionFromNode
} from "./ir-classification.js";
import {
  hasVisibleShadowEffect,
  resolveFirstVisibleGradientPaint,
  resolveFirstVisibleImagePaint,
  resolveFirstVisibleSolidPaint
} from "./ir-colors.js";
import type { FigmaEffect, FigmaPaint } from "./ir-colors.js";
import type { WorkspaceBrandTheme } from "../contracts/index.js";
import type {
  FigmaMcpEnrichment,
  GenerationMetrics,
  NodeDiagnosticEntry
} from "./types.js";

export const DECORATIVE_NAME_PATTERN: RegExp = /(icon|decor|bg|background|shape|vector|spacer|divider)/i;

export interface FigmaComponentPropertyValue {
  type?: string;
  value?: unknown;
}

export interface FigmaComponentPropertyDefinition {
  type?: string;
  defaultValue?: unknown;
  variantOptions?: unknown;
}

export interface FigmaInteractionTrigger {
  type?: string;
}

export interface FigmaInteractionAction {
  type?: string;
  destinationId?: string;
  navigation?: string;
  transitionNodeID?: string;
  transitionNodeId?: string;
}

export interface FigmaInteraction {
  trigger?: FigmaInteractionTrigger;
  action?: FigmaInteractionAction;
  actions?: FigmaInteractionAction[];
}

export interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  styles?: Record<string, string>;
  fillStyleId?: string;
  strokeStyleId?: string;
  effectStyleId?: string;
  textStyleId?: string;
  boundVariables?: Record<string, unknown>;
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
  componentId?: string;
  componentSetId?: string;
  componentProperties?: Record<string, FigmaComponentPropertyValue>;
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
  interactions?: FigmaInteraction[];
}

export interface FigmaFile {
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

export type ColorSampleContext = "button" | "heading" | "body" | "surface" | "decorative";
export type StyleSignalKey =
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
export type SemanticPaletteKey = "success" | "warning" | "error" | "info" | "divider";
export type ColorFamily = "red" | "orange" | "yellow" | "green" | "blue" | "neutral" | "other";

export interface ColorSample {
  color: string;
  weight: number;
  context: ColorSampleContext;
  styleSignals: Record<StyleSignalKey, number>;
}

export interface ColorCluster {
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

export interface FontSample {
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

export interface TypographyCluster {
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

export interface MetricsAccumulator {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  prototypeNavigationDetected: number;
  prototypeNavigationResolved: number;
  prototypeNavigationUnresolved: number;
  screenElementCounts: GenerationMetrics["screenElementCounts"];
  truncatedScreens: GenerationMetrics["truncatedScreens"];
  depthTruncatedScreens: NonNullable<GenerationMetrics["depthTruncatedScreens"]>;
  classificationFallbacks: NonNullable<GenerationMetrics["classificationFallbacks"]>;
  degradedGeometryNodes: string[];
  nodeDiagnostics: NodeDiagnosticEntry[];
}

export interface FigmaToIrOptions {
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

export const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return { r, g, b };
};

// ── Cached parseHex for hot paths (palette clustering) ──────────────────
const parseHexCache = new Map<string, { r: number; g: number; b: number }>();

export const parseHexCached = (hex: string): { r: number; g: number; b: number } => {
  const cached = parseHexCache.get(hex);
  if (cached) {
    return cached;
  }
  const result = parseHex(hex);
  parseHexCache.set(hex, result);
  return result;
};

export const clearParseHexCache = (): void => {
  parseHexCache.clear();
};

export const luminance = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const relativeLuminance = (hex: string): number => {
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

export const contrastRatio = (first: string, second: string): number => {
  const left = relativeLuminance(first);
  const right = relativeLuminance(second);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
};

export const saturation = (hex: string): number => {
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

export const colorDistance = (leftHex: string, rightHex: string): number => {
  const left = parseHex(leftHex);
  const right = parseHex(rightHex);
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

export const colorDistanceCached = (leftHex: string, rightHex: string): number => {
  const left = parseHexCached(leftHex);
  const right = parseHexCached(rightHex);
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const toHexFromChannel = (value: number): string => {
  const normalized = clamp(Math.round(value), 0, 255);
  return normalized.toString(16).padStart(2, "0");
};

export const toHexFromRgb = (red: number, green: number, blue: number): string => {
  return `#${toHexFromChannel(red)}${toHexFromChannel(green)}${toHexFromChannel(blue)}`;
};

export const toHexWithAlpha = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const colorPayload = normalized.length >= 6 ? normalized.slice(0, 6) : normalized;
  if (!/^[0-9a-f]{6}$/i.test(colorPayload)) {
    return hex;
  }
  return `#${colorPayload}${toHexFromChannel(clamp(alpha, 0, 1) * 255)}`;
};

export const quantizeColorKey = (hex: string, step: number): string => {
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

// ── Spatial grid for O(n log n) color cluster merging ────────────────────
export interface SpatialColorGrid<T> {
  insert: (item: T, hex: string) => void;
  findNearest: (hex: string, maxDistance: number) => T | undefined;
}

export const createSpatialColorGrid = <T>(cellSize: number): SpatialColorGrid<T> => {
  const cells = new Map<string, Array<{ item: T; r: number; g: number; b: number }>>();

  const toCellKey = (r: number, g: number, b: number): string => {
    const cr = Math.floor(r / cellSize);
    const cg = Math.floor(g / cellSize);
    const cb = Math.floor(b / cellSize);
    return `${cr},${cg},${cb}`;
  };

  const neighborOffsets: Array<[number, number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dg = -1; dg <= 1; dg++) {
      for (let db = -1; db <= 1; db++) {
        neighborOffsets.push([dr, dg, db]);
      }
    }
  }

  return {
    insert(item: T, hex: string): void {
      const parsed = parseHexCached(hex);
      const key = toCellKey(parsed.r, parsed.g, parsed.b);
      const bucket = cells.get(key);
      if (bucket) {
        bucket.push({ item, r: parsed.r, g: parsed.g, b: parsed.b });
      } else {
        cells.set(key, [{ item, r: parsed.r, g: parsed.g, b: parsed.b }]);
      }
    },

    findNearest(hex: string, maxDistance: number): T | undefined {
      const parsed = parseHexCached(hex);
      const cr = Math.floor(parsed.r / cellSize);
      const cg = Math.floor(parsed.g / cellSize);
      const cb = Math.floor(parsed.b / cellSize);
      const maxDistSq = maxDistance * maxDistance;
      let bestItem: T | undefined;
      let bestDistSq = maxDistSq + 1;

      for (const [dr, dg, db] of neighborOffsets) {
        const key = `${cr + dr},${cg + dg},${cb + db}`;
        const bucket = cells.get(key);
        if (!bucket) {
          continue;
        }
        for (const entry of bucket) {
          const diffR = parsed.r - entry.r;
          const diffG = parsed.g - entry.g;
          const diffB = parsed.b - entry.b;
          const distSq = diffR * diffR + diffG * diffG + diffB * diffB;
          if (distSq <= maxDistSq && distSq < bestDistSq) {
            bestDistSq = distSq;
            bestItem = entry.item;
          }
        }
      }

      return bestItem;
    }
  };
};

export const median = (values: number[]): number | undefined => {
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

export const weightedMedian = (samples: Array<{ value: number; weight: number }>): number | undefined => {
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

export const normalizeFontStack = (families: string[]): string => {
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

export const emptyStyleSignals = (): Record<StyleSignalKey, number> => ({
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

export const addStyleSignals = (
  target: Record<StyleSignalKey, number>,
  signals: Record<StyleSignalKey, number>,
  multiplier = 1
): void => {
  for (const key of Object.keys(signals) as StyleSignalKey[]) {
    target[key] += signals[key] * multiplier;
  }
};

export const determineElementType = (
  node: FigmaNode,
  options?: {
    onFallback?: (input: {
      node: FigmaNode;
      depth: number;
      matchedRulePriority?: number;
    }) => void;
    depth?: number;
  }
): ScreenElementIR["type"] => {
  const decision = classifyElementTypeDecisionFromNode({
    node,
    dependencies: {
      hasSolidFill: (candidate) => Boolean(resolveFirstVisibleSolidPaint(candidate.fills)),
      hasGradientFill: (candidate) => Boolean(resolveFirstVisibleGradientPaint(candidate.fills)),
      hasImageFill: (candidate) => Boolean(resolveFirstVisibleImagePaint(candidate.fills)),
      hasVisibleShadow: (candidate) => hasVisibleShadowEffect(candidate.effects),
      hasStroke: (candidate) => Boolean(resolveFirstVisibleSolidPaint(candidate.strokes))
    }
  });
  if (decision.fallback) {
    options?.onFallback?.({
      node,
      depth: options.depth ?? 0,
      ...(decision.matchedRulePriority !== undefined ? { matchedRulePriority: decision.matchedRulePriority } : {})
    });
  }
  return decision.type;
};

export const mapPadding = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } => {
  return {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0
  };
};

export const mapMargin = (node: FigmaNode): { top: number; right: number; bottom: number; left: number } | undefined => {
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

export interface PrototypeNavigationResolutionContext {
  nodeIdToScreenId: Map<string, string>;
  knownScreenIds: Set<string>;
}
