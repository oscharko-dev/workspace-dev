// ---------------------------------------------------------------------------
// ir-tokens.ts — Token derivation, theme analysis, and MCP enrichment
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import {
  isTextElement
} from "./types.js";
import type {
  DesignIR,
  DesignIrDarkPaletteHints,
  DesignIrThemeAnalysis,
  DesignTokens,
  FigmaMcpEnrichment,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import {
  classifyElementTypeFromSemanticHint
} from "./ir-classification.js";
import {
  collectNodes
} from "./ir-tree.js";
import type {
  FigmaFile
} from "./ir-helpers.js";
import {
  luminance,
  contrastRatio,
  median,
  weightedMedian,
  normalizeFontStack
} from "./ir-helpers.js";
import {
  TOKEN_DERIVATION_DEFAULTS,
  collectFigmaTextStyleEntries,
  collectColorSamples,
  clusterSamples,
  chooseBackgroundColor,
  chooseTextColor,
  choosePrimaryColor,
  chooseSecondaryColor,
  chooseSemanticColor,
  buildActionPalette,
  resolveNodeStyleCatalog
} from "./ir-palette.js";
import {
  collectFontSamples,
  clusterTypographySamples,
  buildDerivedTypographyScale,
  resolveDominantFont
} from "./ir-typography.js";

export const deriveTokens = (file: FigmaFile): DesignTokens => {
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
  const figmaTextStyleEntries = collectFigmaTextStyleEntries({ nodes, styleCatalog });
  const typographyClusters = clusterTypographySamples(fontSamples);
  const typography = buildDerivedTypographyScale({
    clusters: typographyClusters,
    figmaTextStyleEntries,
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

export const DARK_MODE_NAME_PATTERN: RegExp = /\b(dark|night|nocturne|midnight|amoled)\b/i;
export const LIGHT_MODE_NAME_PATTERN: RegExp = /\b(light|day)\b/i;
export const DEFAULT_DARK_BACKGROUND_COLOR = "#121212";
export const DEFAULT_DARK_TEXT_COLOR = "#f5f7fb";
export const HEX_COLOR_PATTERN: RegExp = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const isHexColorLiteral = (value: string): boolean => {
  return HEX_COLOR_PATTERN.test(value);
};

export const parseHexColorRgb = (hex: string): { r: number; g: number; b: number } | undefined => {
  if (!isHexColorLiteral(hex)) {
    return undefined;
  }
  const normalized = hex.length === 9 ? hex.slice(0, 7) : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return undefined;
  }
  return { r, g, b };
};

export const clampUnitInterval = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

export const mixHexColors = ({ left, right, amount }: { left: string; right: string; amount: number }): string => {
  const leftRgb = parseHexColorRgb(left);
  const rightRgb = parseHexColorRgb(right);
  if (!leftRgb || !rightRgb) {
    return left;
  }
  const clampedAmount = clampUnitInterval(amount);
  const blendChannel = (from: number, to: number): number => Math.round(from + (to - from) * clampedAmount);
  const red = blendChannel(leftRgb.r, rightRgb.r);
  const green = blendChannel(leftRgb.g, rightRgb.g);
  const blue = blendChannel(leftRgb.b, rightRgb.b);
  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue
    .toString(16)
    .padStart(2, "0")}`;
};

export const resolveMostFrequentColor = (colors: string[]): string | undefined => {
  if (colors.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  })[0]?.[0];
};

export const resolveBestContrastCandidate = ({
  backgroundColor,
  candidates
}: {
  backgroundColor: string;
  candidates: string[];
}): string => {
  const uniqueCandidates = [...new Set(candidates.filter((candidate) => isHexColorLiteral(candidate)))];
  if (uniqueCandidates.length === 0) {
    return DEFAULT_DARK_TEXT_COLOR;
  }
  return uniqueCandidates
    .map((candidate) => ({
      candidate,
      score: contrastRatio(candidate, backgroundColor)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.candidate.localeCompare(right.candidate);
    })[0]?.candidate ?? DEFAULT_DARK_TEXT_COLOR;
};

export const deriveThemeAnalysis = ({
  file,
  screens,
  tokens
}: {
  file: FigmaFile;
  screens: ScreenIR[];
  tokens: DesignTokens;
}): DesignIrThemeAnalysis => {
  const nodes = file.document ? collectNodes(file.document, () => true) : [];
  const styleCatalog = resolveNodeStyleCatalog(file);
  const colorSamples = collectColorSamples({ nodes, styleCatalog });
  const clusters = clusterSamples(colorSamples);

  const screenBackgrounds = screens
    .map((screen) => screen.fillColor)
    .filter((value): value is string => typeof value === "string" && isHexColorLiteral(value));
  const darkScreenBackgrounds = screenBackgrounds.filter((color) => luminance(color) < 0.3);
  const lightScreenBackgrounds = screenBackgrounds.filter((color) => luminance(color) > 0.65);

  const darkNameCandidates = [
    file.name ?? "",
    ...screens.map((screen) => screen.name),
    ...nodes
      .filter((node) => node.type === "CANVAS")
      .map((node) => (typeof node.name === "string" ? node.name : ""))
  ];
  const darkNameMatches = darkNameCandidates.filter((name) => DARK_MODE_NAME_PATTERN.test(name)).length;
  const lightNameMatches = darkNameCandidates.filter((name) => LIGHT_MODE_NAME_PATTERN.test(name)).length;

  const clusterDarkCandidates = clusters.filter((cluster) => luminance(cluster.color) < 0.3 && cluster.totalWeight >= 4);
  const luminanceSignal =
    darkScreenBackgrounds.length > 0 &&
    darkScreenBackgrounds.length / Math.max(1, screenBackgrounds.length) >= 0.25;
  const namingSignal = darkNameMatches > 0 && darkNameMatches >= lightNameMatches;
  const lightDarkPairSignal = darkScreenBackgrounds.length > 0 && lightScreenBackgrounds.length > 0;

  const darkModeDetected = luminanceSignal || namingSignal || lightDarkPairSignal;
  if (!darkModeDetected) {
    return {
      darkModeDetected: false,
      signals: {
        luminance: luminanceSignal,
        naming: namingSignal,
        lightDarkPair: lightDarkPairSignal
      }
    };
  }

  const darkBackground =
    resolveMostFrequentColor(darkScreenBackgrounds) ??
    clusterDarkCandidates
      .slice()
      .sort((left, right) => {
        if (right.totalWeight !== left.totalWeight) {
          return right.totalWeight - left.totalWeight;
        }
        return left.color.localeCompare(right.color);
      })[0]?.color ??
    DEFAULT_DARK_BACKGROUND_COLOR;

  const darkPaperCandidate = clusterDarkCandidates
    .map((cluster) => cluster.color)
    .filter((color) => color !== darkBackground && luminance(color) > luminance(darkBackground) && luminance(color) <= 0.45)
    .sort((left, right) => luminance(left) - luminance(right))[0];
  const darkPaper = darkPaperCandidate ?? mixHexColors({ left: darkBackground, right: "#ffffff", amount: 0.08 });

  const inferredText = chooseTextColor({
    clusters,
    backgroundColor: darkBackground
  });
  const darkText = resolveBestContrastCandidate({
    backgroundColor: darkBackground,
    candidates: [inferredText, tokens.palette.text, DEFAULT_DARK_TEXT_COLOR, "#ffffff", "#f3f4f6"]
  });

  const darkPrimary = choosePrimaryColor({
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText
  });
  const darkSecondary = chooseSecondaryColor({
    clusters,
    backgroundColor: darkBackground,
    primaryColor: darkPrimary
  });
  const darkSuccess = chooseSemanticColor({
    semanticKey: "success",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkWarning = chooseSemanticColor({
    semanticKey: "warning",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkError = chooseSemanticColor({
    semanticKey: "error",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkInfo = chooseSemanticColor({
    semanticKey: "info",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkDivider = chooseSemanticColor({
    semanticKey: "divider",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });

  const darkPaletteHints: DesignIrDarkPaletteHints = {
    primary: darkPrimary,
    secondary: darkSecondary,
    success: darkSuccess,
    warning: darkWarning,
    error: darkError,
    info: darkInfo,
    background: {
      default: darkBackground,
      paper: darkPaper
    },
    text: {
      primary: darkText
    },
    divider: darkDivider
  };

  return {
    darkModeDetected: true,
    signals: {
      luminance: luminanceSignal,
      naming: namingSignal,
      lightDarkPair: lightDarkPairSignal
    },
    darkPaletteHints
  };
};

export const isGenericElementName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "container" ||
    normalized === "styled(div)" ||
    normalized === "vector" ||
    normalized === "frame" ||
    normalized.startsWith("frame ")
  );
};

export const inferTypeFromSemanticHint = (
  semanticName: string | undefined,
  semanticType: string | undefined
): ScreenElementIR["type"] | undefined => {
  return classifyElementTypeFromSemanticHint({
    semanticName,
    semanticType
  });
};

export const applyMcpHintToElement = (
  element: ScreenElementIR,
  hintsById: Map<string, FigmaMcpEnrichment["nodeHints"][number]>
): ScreenElementIR => {
  const hint = hintsById.get(element.id);
  const inferredType = hint ? inferTypeFromSemanticHint(hint.semanticName, hint.semanticType) : undefined;

  const nextName =
    hint?.semanticName && (isGenericElementName(element.name) || hint.semanticName.length > element.name.length + 2)
      ? hint.semanticName
      : element.name;
  const nextChildren = (element.children ?? []).map((child) => applyMcpHintToElement(child, hintsById));
  const nextType = inferredType ?? element.type;
  const baseWithHint = {
    ...element,
    name: nextName,
    children: nextChildren
  };

  if (nextType === element.type) {
    return baseWithHint;
  }

  if (nextType === "text") {
    const fallbackText = isTextElement(element) ? element.text : element.text?.trim() ?? nextName;
    return {
      ...baseWithHint,
      type: "text",
      text: fallbackText
    };
  }

  return {
    ...baseWithHint,
    type: nextType
  };
};

export const applyMcpEnrichmentToIr = (ir: DesignIR, enrichment: FigmaMcpEnrichment): DesignIR => {
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
