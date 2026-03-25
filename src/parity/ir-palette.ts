// ---------------------------------------------------------------------------
// ir-palette.ts — Color sampling, clustering, and semantic palette selection
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type { DesignTokens } from "./types.js";
import {
  resolveFirstVisibleSolidPaint,
  toHexColor
} from "./ir-colors.js";
import {
  hasAnySubstring
} from "./ir-classification.js";
import {
  DEFAULT_SPACING_BASE,
  HEADING_FONT_SIZE_MIN,
  HEADING_FONT_WEIGHT_MIN,
  TEXT_WIDTH_PROMINENCE_DIVISOR,
  AREA_GEOMETRY_WEIGHT_DIVISOR
} from "./constants.js";
import {
  completeTypographyScale
} from "./typography-tokens.js";
import type { FigmaTextStyleEntry } from "./typography-tokens.js";
import type {
  FigmaNode,
  FigmaFile,
  ColorSample,
  ColorCluster,
  ColorSampleContext,
  StyleSignalKey,
  SemanticPaletteKey,
  ColorFamily
} from "./ir-helpers.js";
import {
  parseHex,
  clearParseHexCache,
  luminance,
  contrastRatio,
  saturation,
  colorDistance,
  clamp,
  toHexFromRgb,
  toHexWithAlpha,
  quantizeColorKey,
  emptyStyleSignals,
  addStyleSignals,
  createSpatialColorGrid
} from "./ir-helpers.js";

export const TOKEN_DERIVATION_DEFAULTS: DesignTokens = {
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
  spacingBase: DEFAULT_SPACING_BASE,
  fontFamily: "Roboto, Arial, sans-serif",
  headingSize: 24,
  bodySize: 14,
  typography: completeTypographyScale({
    fontFamily: "Roboto, Arial, sans-serif",
    headingSize: 24,
    bodySize: 14
  })
};

export const COLOR_CLUSTER_STEP = 16;
export const COLOR_CLUSTER_MERGE_THRESHOLD = 0.12;


export const emptyContextWeights = (): Record<ColorSampleContext, number> => ({
  button: 0,
  heading: 0,
  body: 0,
  surface: 0,
  decorative: 0
});

export const parseHexChannel = (hex: string, start: number): number => {
  const normalized = hex.replace("#", "");
  const parsed = Number.parseInt(normalized.slice(start, start + 2), 16);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(parsed, 0, 255);
};

export const resolveNodeArea = (node: FigmaNode): number => {
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  return Math.max(1, width * height);
};

export const resolveTextRole = (node: FigmaNode): "heading" | "body" => {
  const fontSize = node.style?.fontSize ?? 0;
  const fontWeight = node.style?.fontWeight ?? 0;
  const loweredName = (node.name ?? "").toLowerCase();
  if (
    fontSize >= HEADING_FONT_SIZE_MIN ||
    fontWeight >= HEADING_FONT_WEIGHT_MIN ||
    hasAnySubstring(loweredName, ["heading", "headline", "title", "h1", "h2", "h3"])
  ) {
    return "heading";
  }
  return "body";
};

export const resolveNodeStyleCatalog = (file: FigmaFile): Map<string, string> => {
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

export const resolveNodeStyleNames = (node: FigmaNode, styleCatalog: Map<string, string>): string[] => {
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

export const collectFigmaTextStyleEntries = ({
  nodes,
  styleCatalog
}: {
  nodes: FigmaNode[];
  styleCatalog: Map<string, string>;
}): FigmaTextStyleEntry[] => {
  const seenStyleIds = new Set<string>();
  const entries: FigmaTextStyleEntry[] = [];

  for (const node of nodes) {
    if (node.type !== "TEXT" || node.visible === false) {
      continue;
    }
    const textStyleId = node.textStyleId ?? node.styles?.["text"];
    if (typeof textStyleId !== "string" || textStyleId.trim().length === 0) {
      continue;
    }
    if (seenStyleIds.has(textStyleId)) {
      continue;
    }
    const styleName = styleCatalog.get(textStyleId);
    if (typeof styleName !== "string" || styleName.length === 0) {
      continue;
    }
    const fontSize = node.style?.fontSize;
    if (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize < 1) {
      continue;
    }
    seenStyleIds.add(textStyleId);
    entries.push({
      styleName,
      fontSizePx: fontSize,
      fontWeight: node.style?.fontWeight ?? 400,
      lineHeightPx: node.style?.lineHeightPx ?? Math.round(fontSize * 1.4),
      ...(node.style?.fontFamily?.trim() ? { fontFamily: node.style.fontFamily.trim() } : {}),
      ...(typeof node.style?.letterSpacing === "number" && Number.isFinite(node.style.letterSpacing)
        ? { letterSpacingPx: node.style.letterSpacing }
        : {})
    });
  }

  return entries;
};

export const deriveStyleSignals = ({
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

export const resolveSampleWeight = ({
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
    const emphasis = (node.style?.fontWeight ?? 0) >= HEADING_FONT_WEIGHT_MIN ? 1.15 : 1;
    return base * clamp(textWidth / TEXT_WIDTH_PROMINENCE_DIVISOR, 1, 6) * emphasis;
  }

  return base * clamp(Math.sqrt(area) / AREA_GEOMETRY_WEIGHT_DIVISOR, 1, 8);
};

export const resolveFillColor = (node: FigmaNode): string | undefined => {
  const fill = resolveFirstVisibleSolidPaint(node.fills);
  return toHexColor(fill?.color, fill?.opacity);
};

export const resolveStrokeColor = (node: FigmaNode): string | undefined => {
  const stroke = resolveFirstVisibleSolidPaint(node.strokes);
  return toHexColor(stroke?.color, stroke?.opacity);
};

export const resolveShapeContext = (node: FigmaNode): ColorSampleContext => {
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

export const collectColorSamples = ({
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

export const finalizeClusterColor = (cluster: ColorCluster): string => {
  if (cluster.totalWeight <= 0) {
    return cluster.color;
  }
  return toHexFromRgb(
    cluster.channels.r / cluster.totalWeight,
    cluster.channels.g / cluster.totalWeight,
    cluster.channels.b / cluster.totalWeight
  );
};

export const mergeClusters = (target: ColorCluster, source: ColorCluster): void => {
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

export const NEAR_DUPLICATE_DISTANCE = 5;

const deduplicateSamples = (samples: ColorSample[]): ColorSample[] => {
  const seen = new Map<string, ColorSample>();
  for (const sample of samples) {
    const key = quantizeColorKey(sample.color, NEAR_DUPLICATE_DISTANCE);
    const existing = seen.get(key);
    if (existing) {
      existing.weight += sample.weight;
      addStyleSignals(existing.styleSignals, sample.styleSignals);
    } else {
      seen.set(key, { ...sample, styleSignals: { ...sample.styleSignals } });
    }
  }
  return [...seen.values()];
};

export const clusterSamples = (samples: ColorSample[]): ColorCluster[] => {
  const deduped = deduplicateSamples(samples);
  const buckets = new Map<string, ColorCluster>();

  for (const sample of deduped) {
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
  const grid = createSpatialColorGrid<ColorCluster>(COLOR_CLUSTER_MERGE_THRESHOLD);

  for (const cluster of sorted) {
    const match = grid.findNearest(cluster.color, COLOR_CLUSTER_MERGE_THRESHOLD);
    if (match) {
      mergeClusters(match, cluster);
      // Re-index is not needed: the match stays in place and its color
      // shifts only marginally (weighted average), so it remains reachable
      // in the same or adjacent grid cell for subsequent lookups.
    } else {
      const copy: ColorCluster = {
        color: cluster.color,
        totalWeight: cluster.totalWeight,
        channels: { ...cluster.channels },
        contexts: { ...cluster.contexts },
        styleSignals: { ...cluster.styleSignals }
      };
      merged.push(copy);
      grid.insert(copy, copy.color);
    }
  }

  clearParseHexCache();
  return merged.sort((left, right) => right.totalWeight - left.totalWeight);
};

export const resolveHue = (hex: string): number | undefined => {
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

export const resolveColorFamily = (hex: string): ColorFamily => {
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

export const resolveSemanticFamilyScore = ({
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

const resolveSemanticSignalStrength = (cluster: ColorCluster): number => {
  return (
    cluster.styleSignals.success +
    cluster.styleSignals.warning +
    cluster.styleSignals.error +
    cluster.styleSignals.info
  );
};

const resolveSignalHuePenalty = ({
  cluster,
  mode
}: {
  cluster: ColorCluster;
  mode: "primary" | "secondary";
}): number => {
  const family = resolveColorFamily(cluster.color);
  const semanticSignalStrength = resolveSemanticSignalStrength(cluster);
  const explicitBrandStrength = cluster.styleSignals.primary + cluster.styleSignals.secondary + cluster.styleSignals.brand;
  const hasStrongInteractiveIntent = explicitBrandStrength >= 1 || cluster.contexts.button >= 1.4;

  const baseFamilyPenalty = (() => {
    if (family === "green") {
      return mode === "secondary" ? 4.8 : 4.2;
    }
    if (family === "orange" || family === "yellow") {
      return mode === "secondary" ? 3.4 : 3;
    }
    if (family === "red") {
      return mode === "secondary" ? 1.6 : 1.2;
    }
    return 0;
  })();
  const semanticSignalPenalty = semanticSignalStrength * (mode === "secondary" ? 2.6 : 2.1);
  const totalPenalty = baseFamilyPenalty + semanticSignalPenalty;
  if (totalPenalty <= 0) {
    return 0;
  }

  if (hasStrongInteractiveIntent) {
    return totalPenalty * 0.35;
  }
  if (explicitBrandStrength > 0) {
    return totalPenalty * 0.55;
  }
  return totalPenalty;
};

export const isDistinctFromColors = ({
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

export const pickDistinctColor = ({
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

export const resolveSemanticFallbackColor = ({
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

export const buildActionPalette = ({
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

export const chooseSemanticColor = ({
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

export const chooseBackgroundColor = (clusters: ColorCluster[]): string => {
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

export const chooseTextColor = ({
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

export const choosePrimaryColor = ({
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
    value -= resolveSignalHuePenalty({
      cluster,
      mode: "primary"
    });
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

export const chooseSecondaryColor = ({
  clusters,
  backgroundColor,
  primaryColor
}: {
  clusters: ColorCluster[];
  backgroundColor: string;
  primaryColor: string;
}): string => {
  const nonBackgroundPool = clusters.filter(
    (cluster) => colorDistance(cluster.color, primaryColor) >= 0.14 && colorDistance(cluster.color, backgroundColor) >= 0.08
  );
  const pool = nonBackgroundPool.length > 0
    ? nonBackgroundPool
    : clusters.filter((cluster) => colorDistance(cluster.color, primaryColor) >= 0.14);
  if (pool.length === 0) {
    return TOKEN_DERIVATION_DEFAULTS.palette.secondary;
  }

  const score = (cluster: ColorCluster): number => {
    let value =
      cluster.styleSignals.secondary * 4.4 +
      cluster.styleSignals.accent * 2.2 +
      cluster.contexts.heading +
      cluster.contexts.button * 1.2 +
      saturation(cluster.color) * 2 +
      colorDistance(cluster.color, primaryColor) * 2 +
      cluster.totalWeight * 0.03;
    if (contrastRatio(cluster.color, backgroundColor) >= 3) {
      value += 1.2;
    }
    value -= resolveSignalHuePenalty({
      cluster,
      mode: "secondary"
    });
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
