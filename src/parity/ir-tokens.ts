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
  FigmaMcpDesignSystemMapping,
  DesignTokens,
  FigmaMcpCodeConnectMapping,
  FigmaMcpEnrichment,
  FigmaMcpMetadataHint,
  FigmaMcpNodeHint,
  ScreenElementIR,
  ScreenIR,
  ScreenElementSemanticSource
} from "./types.js";
import {
  classifyElementTypeFromSemanticHint,
  resolveExplicitBoardComponentFromNode
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
import type { FigmaTextStyleEntry } from "./typography-tokens.js";

interface CompositeMcpHint extends FigmaMcpNodeHint {
  priority: number;
  semanticSource: ScreenElementSemanticSource;
  codeConnect?: FigmaMcpCodeConnectMapping | FigmaMcpDesignSystemMapping;
}

const VARIABLE_SIGNAL_PATTERNS = {
  primary: [/\bprimary\b/i, /\bbrand\b/i],
  secondary: [/\bsecondary\b/i, /\baccent\b/i],
  background: [/\bbackground\b/i, /\bsurface\b/i, /\bcanvas\b/i, /\bpaper\b/i],
  text: [/\btext\b/i, /\bforeground\b/i, /\bcontent\b/i, /\bon[-\s_]?background\b/i, /\bon[-\s_]?surface\b/i],
  success: [/\bsuccess\b/i, /\bpositive\b/i, /\bvalid\b/i],
  warning: [/\bwarning\b/i, /\bcaution\b/i, /\balert\b/i],
  error: [/\berror\b/i, /\bdanger\b/i, /\bnegative\b/i],
  info: [/\binfo\b/i, /\bnotice\b/i, /\bhint\b/i],
  divider: [/\bdivider\b/i, /\bseparator\b/i, /\bborder\b/i, /\boutline\b/i]
} as const;

const DARK_TOKEN_PATTERN = /\b(dark|night|midnight|nocturne|amoled)\b/i;

const toLookupStrings = ({
  name,
  aliases,
  collectionName,
  modeName
}: {
  name: string;
  aliases?: string[];
  collectionName?: string;
  modeName?: string;
}): string[] => {
  return [name, ...(aliases ?? []), collectionName, modeName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
};

const matchesAnyPattern = (value: string, patterns: readonly RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(value));
};

const resolveAuthoritativeColorToken = ({
  enrichment,
  signalKey,
  requireDark
}: {
  enrichment: FigmaMcpEnrichment | undefined;
  signalKey: keyof typeof VARIABLE_SIGNAL_PATTERNS;
  requireDark?: boolean;
}): string | undefined => {
  const variables = enrichment?.variables ?? [];
  for (const variable of variables) {
    if (variable.kind !== "color" || typeof variable.value !== "string" || !isHexColorLiteral(variable.value)) {
      continue;
    }
    const lookupStrings = toLookupStrings(variable);
    const hasSignal = lookupStrings.some((value) => matchesAnyPattern(value, VARIABLE_SIGNAL_PATTERNS[signalKey]));
    if (!hasSignal) {
      continue;
    }
    const isDarkCandidate = lookupStrings.some((value) => DARK_TOKEN_PATTERN.test(value));
    if (requireDark === true && !isDarkCandidate) {
      continue;
    }
    if (requireDark === false && isDarkCandidate) {
      continue;
    }
    return variable.value;
  }
  return undefined;
};

const resolveAuthoritativeNumberToken = ({
  enrichment,
  patterns
}: {
  enrichment: FigmaMcpEnrichment | undefined;
  patterns: readonly RegExp[];
}): number | undefined => {
  const variables = enrichment?.variables ?? [];
  for (const variable of variables) {
    if (variable.kind !== "number" || typeof variable.value !== "number" || !Number.isFinite(variable.value)) {
      continue;
    }
    const lookupStrings = toLookupStrings(variable);
    if (lookupStrings.some((value) => matchesAnyPattern(value, patterns))) {
      return variable.value;
    }
  }
  return undefined;
};

const resolveAuthoritativeFontFamilyToken = ({
  enrichment
}: {
  enrichment: FigmaMcpEnrichment | undefined;
}): string | undefined => {
  const variables = enrichment?.variables ?? [];
  for (const variable of variables) {
    if (variable.kind !== "string" || typeof variable.value !== "string" || variable.value.trim().length === 0) {
      continue;
    }
    const lookupStrings = toLookupStrings(variable);
    if (lookupStrings.some((value) => /\bfont\b/i.test(value) && /\bfamily\b/i.test(value))) {
      return normalizeFontStack([variable.value]);
    }
  }
  return undefined;
};

const resolveAuthoritativeTextStyleEntries = ({
  enrichment
}: {
  enrichment: FigmaMcpEnrichment | undefined;
}): FigmaTextStyleEntry[] => {
  const entries = enrichment?.styleCatalog ?? [];
  return entries
    .filter((entry) => entry.styleType.toUpperCase() === "TEXT")
    .filter((entry) => typeof entry.fontSizePx === "number" && Number.isFinite(entry.fontSizePx) && entry.fontSizePx > 0)
    .map((entry) => ({
      styleName: entry.name,
      fontSizePx: entry.fontSizePx!,
      fontWeight:
        typeof entry.fontWeight === "number" && Number.isFinite(entry.fontWeight) ? entry.fontWeight : 400,
      lineHeightPx:
        typeof entry.lineHeightPx === "number" && Number.isFinite(entry.lineHeightPx)
          ? entry.lineHeightPx
          : Math.round(entry.fontSizePx! * 1.4),
      ...(entry.fontFamily?.trim() ? { fontFamily: entry.fontFamily.trim() } : {}),
      ...(typeof entry.letterSpacingPx === "number" && Number.isFinite(entry.letterSpacingPx)
        ? { letterSpacingPx: entry.letterSpacingPx }
        : {})
    }));
};

const buildMcpCoverageMetric = ({
  enrichment
}: {
  enrichment: FigmaMcpEnrichment;
}): import("./types.js").McpCoverageMetric => {
  const diagnostics = enrichment.diagnostics?.map((entry) => ({ ...entry })) ?? [];
  const pushCoverageDiagnostic = ({
    code,
    message,
    source
  }: {
    code: string;
    message: string;
    source: "variables" | "styles" | "code_connect" | "design_system" | "metadata" | "assets" | "screenshots";
  }): void => {
    if (diagnostics.some((entry) => entry.code === code)) {
      return;
    }
    diagnostics.push({
      code,
      message,
      severity: "info",
      source
    });
  };
  if ((enrichment.variables?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_VARIABLES_UNAVAILABLE",
      message: "No MCP variable definitions were available; token derivation may rely on heuristic clustering.",
      source: "variables"
    });
  }
  if ((enrichment.styleCatalog?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_STYLES_UNAVAILABLE",
      message: "No MCP style catalog entries were available; typography derivation may rely on sampled text nodes.",
      source: "styles"
    });
  }
  if ((enrichment.codeConnectMappings?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_CODE_CONNECT_UNAVAILABLE",
      message: "No MCP Code Connect mappings were available; component generation may use deterministic semantic fallbacks.",
      source: "code_connect"
    });
  }
  if ((enrichment.designSystemMappings?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_DESIGN_SYSTEM_UNAVAILABLE",
      message: "No MCP design-system suggestions were available; component generation may rely on board semantics and deterministic fallbacks.",
      source: "design_system"
    });
  }
  if ((enrichment.metadataHints?.length ?? 0) === 0 && enrichment.nodeHints.length === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_METADATA_UNAVAILABLE",
      message: "No MCP metadata or node hints were available; semantic structure derivation may rely on board names and heuristics.",
      source: "metadata"
    });
  }
  if ((enrichment.assets?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_ASSETS_UNAVAILABLE",
      message: "No MCP asset references were available; image and icon generation may use exported assets or deterministic placeholders.",
      source: "assets"
    });
  }
  if ((enrichment.screenshots?.length ?? 0) === 0) {
    pushCoverageDiagnostic({
      code: "I_MCP_SCREENSHOTS_UNAVAILABLE",
      message: "No MCP screenshots were available; visual quality gates remain optional and are currently not enriched.",
      source: "screenshots"
    });
  }
  const hasFallbackWarning = diagnostics.some((entry) => entry.severity === "warning");
  return {
    sourceMode: enrichment.sourceMode,
    toolNames: [...enrichment.toolNames],
    nodeHintCount: enrichment.nodeHints.length,
    metadataHintCount: enrichment.metadataHints?.length ?? 0,
    codeConnectMappingCount: enrichment.codeConnectMappings?.length ?? 0,
    designSystemMappingCount: enrichment.designSystemMappings?.length ?? 0,
    variableCount: enrichment.variables?.length ?? 0,
    styleEntryCount: enrichment.styleCatalog?.length ?? 0,
    assetCount: enrichment.assets?.length ?? 0,
    screenshotCount: enrichment.screenshots?.length ?? 0,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(hasFallbackWarning || enrichment.toolNames.length === 0 ? { fallbackUsed: true } : {})
  };
};

const normalizeSemanticValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
};

const inferSemanticTypeFromMetadataHint = (hint: FigmaMcpMetadataHint): string | undefined => {
  const combined = [
    hint.semanticType,
    hint.semanticName,
    hint.layerType,
    hint.layerName
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (!combined) {
    return undefined;
  }
  if (/\b(nav|navigation|navbar|sidebar|menu|drawer|tabbar)\b/.test(combined)) {
    return "navigation";
  }
  if (/\b(app\s*bar|top\s*bar|header|banner|hero)\b/.test(combined)) {
    return "header";
  }
  if (/\b(main|content|body)\b/.test(combined)) {
    return "main";
  }
  if (/\bfooter|bottom\s*bar|contentinfo\b/.test(combined)) {
    return "footer";
  }
  if (/\b(article|card)\b/.test(combined)) {
    return "article";
  }
  if (/\bsection|group\b/.test(combined)) {
    return "section";
  }
  if (/\bform\b/.test(combined)) {
    return "form";
  }
  return normalizeSemanticValue(hint.semanticType);
};

const normalizeMetadataHint = (hint: FigmaMcpMetadataHint): FigmaMcpMetadataHint => {
  const semanticName = normalizeSemanticValue(hint.semanticName) ?? normalizeSemanticValue(hint.layerName);
  const semanticType = inferSemanticTypeFromMetadataHint(hint);
  return {
    ...hint,
    ...(semanticName ? { semanticName } : {}),
    ...(semanticType ? { semanticType } : {})
  };
};

const toCompositeHintMap = (enrichment: FigmaMcpEnrichment): Map<string, CompositeMcpHint> => {
  const hintsById = new Map<string, CompositeMcpHint>();
  const registerHint = ({
    nodeId,
    semanticName,
    semanticType,
    sourceTools,
    priority,
    semanticSource,
    codeConnect
  }: {
    nodeId: string;
    semanticName?: string;
    semanticType?: string;
    sourceTools: string[];
    priority: number;
    semanticSource: ScreenElementSemanticSource;
    codeConnect?: FigmaMcpCodeConnectMapping | FigmaMcpDesignSystemMapping;
  }): void => {
    if (nodeId.trim().length === 0) {
      return;
    }
    const existing = hintsById.get(nodeId);
    if (existing && existing.priority > priority) {
      return;
    }
    hintsById.set(nodeId, {
      nodeId,
      ...(semanticName ? { semanticName } : {}),
      ...(semanticType ? { semanticType } : {}),
      sourceTools,
      priority,
      semanticSource,
      ...(codeConnect ? { codeConnect } : {})
    });
  };

  for (const hint of enrichment.metadataHints ?? []) {
    registerHint({
      ...normalizeMetadataHint(hint),
      priority: 1,
      semanticSource: "metadata"
    });
  }
  for (const hint of enrichment.nodeHints) {
    registerHint({
      ...hint,
      priority: 2,
      semanticSource: "node_hint"
    });
  }
  for (const mapping of enrichment.codeConnectMappings ?? []) {
    registerHint({
      nodeId: mapping.nodeId,
      semanticName: normalizeSemanticValue(mapping.semanticName) ?? mapping.componentName,
      semanticType: normalizeSemanticValue(mapping.semanticType) ?? mapping.componentName,
      sourceTools: [mapping.label ?? "code-connect"],
      priority: 3,
      semanticSource: "code_connect",
      codeConnect: mapping
    });
  }
  for (const mapping of enrichment.designSystemMappings ?? []) {
    registerHint({
      nodeId: mapping.nodeId,
      semanticName: normalizeSemanticValue(mapping.semanticName) ?? mapping.componentName,
      semanticType: normalizeSemanticValue(mapping.semanticType) ?? mapping.componentName,
      sourceTools: [mapping.label ?? "design-system"],
      priority: 2.5,
      semanticSource: "design_system",
      codeConnect: mapping
    });
  }

  return hintsById;
};

export const deriveTokens = (file: FigmaFile, enrichment?: FigmaMcpEnrichment): DesignTokens => {
  const nodes = file.document ? collectNodes(file.document, () => true) : [];
  const styleCatalog = resolveNodeStyleCatalog(file);
  const colorSamples = collectColorSamples({ nodes, styleCatalog });
  const clusters = clusterSamples(colorSamples);

  const derivedBackground = chooseBackgroundColor(clusters);
  const derivedText = chooseTextColor({
    clusters,
    backgroundColor: derivedBackground
  });
  const derivedPrimary = choosePrimaryColor({
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText
  });
  const derivedSecondary = chooseSecondaryColor({
    clusters,
    backgroundColor: derivedBackground,
    primaryColor: derivedPrimary
  });
  const derivedSuccess = chooseSemanticColor({
    semanticKey: "success",
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText,
    primaryColor: derivedPrimary,
    secondaryColor: derivedSecondary
  });
  const derivedWarning = chooseSemanticColor({
    semanticKey: "warning",
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText,
    primaryColor: derivedPrimary,
    secondaryColor: derivedSecondary
  });
  const derivedError = chooseSemanticColor({
    semanticKey: "error",
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText,
    primaryColor: derivedPrimary,
    secondaryColor: derivedSecondary
  });
  const derivedInfo = chooseSemanticColor({
    semanticKey: "info",
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText,
    primaryColor: derivedPrimary,
    secondaryColor: derivedSecondary
  });
  const derivedDivider = chooseSemanticColor({
    semanticKey: "divider",
    clusters,
    backgroundColor: derivedBackground,
    textColor: derivedText,
    primaryColor: derivedPrimary,
    secondaryColor: derivedSecondary
  });

  const background = resolveAuthoritativeColorToken({ enrichment, signalKey: "background", requireDark: false }) ?? derivedBackground;
  const text = resolveAuthoritativeColorToken({ enrichment, signalKey: "text", requireDark: false }) ?? derivedText;
  const primary = resolveAuthoritativeColorToken({ enrichment, signalKey: "primary", requireDark: false }) ?? derivedPrimary;
  const secondary =
    resolveAuthoritativeColorToken({ enrichment, signalKey: "secondary", requireDark: false }) ?? derivedSecondary;
  const success =
    resolveAuthoritativeColorToken({ enrichment, signalKey: "success", requireDark: false }) ?? derivedSuccess;
  const warning =
    resolveAuthoritativeColorToken({ enrichment, signalKey: "warning", requireDark: false }) ?? derivedWarning;
  const error = resolveAuthoritativeColorToken({ enrichment, signalKey: "error", requireDark: false }) ?? derivedError;
  const info = resolveAuthoritativeColorToken({ enrichment, signalKey: "info", requireDark: false }) ?? derivedInfo;
  const divider =
    resolveAuthoritativeColorToken({ enrichment, signalKey: "divider", requireDark: false }) ?? derivedDivider;

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
  const derivedFontFamily = normalizeFontStack(
    [dominantBodyFont, dominantHeadingFont].filter((value): value is string => typeof value === "string")
  );
  const resolvedFontFamily = resolveAuthoritativeFontFamilyToken({ enrichment }) ?? derivedFontFamily;
  const figmaTextStyleEntries = (() => {
    const authoritative = resolveAuthoritativeTextStyleEntries({ enrichment });
    return authoritative.length > 0 ? authoritative : collectFigmaTextStyleEntries({ nodes, styleCatalog });
  })();
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
    borderRadius: Math.max(
      1,
      Math.round(
        resolveAuthoritativeNumberToken({
          enrichment,
          patterns: [/\bradius\b/i, /\bcorner\b/i, /\brounded\b/i]
        }) ??
          median(radii) ??
          TOKEN_DERIVATION_DEFAULTS.borderRadius
      )
    ),
    spacingBase: Math.max(
      1,
      Math.round(
        resolveAuthoritativeNumberToken({
          enrichment,
          patterns: [/\bspacing\b/i, /\bspace\b/i, /\bgap\b/i, /\bgrid\b/i]
        }) ??
          median(spacings) ??
          TOKEN_DERIVATION_DEFAULTS.spacingBase
      )
    ),
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
  tokens,
  enrichment
}: {
  file: FigmaFile;
  screens: ScreenIR[];
  tokens: DesignTokens;
  enrichment?: FigmaMcpEnrichment;
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
  const authoritativeDarkPrimary = resolveAuthoritativeColorToken({ enrichment, signalKey: "primary", requireDark: true });
  const authoritativeDarkSecondary = resolveAuthoritativeColorToken({
    enrichment,
    signalKey: "secondary",
    requireDark: true
  });
  const authoritativeDarkSuccess = resolveAuthoritativeColorToken({ enrichment, signalKey: "success", requireDark: true });
  const authoritativeDarkWarning = resolveAuthoritativeColorToken({ enrichment, signalKey: "warning", requireDark: true });
  const authoritativeDarkError = resolveAuthoritativeColorToken({ enrichment, signalKey: "error", requireDark: true });
  const authoritativeDarkInfo = resolveAuthoritativeColorToken({ enrichment, signalKey: "info", requireDark: true });
  const authoritativeDarkBackground = resolveAuthoritativeColorToken({
    enrichment,
    signalKey: "background",
    requireDark: true
  });
  const authoritativeDarkText = resolveAuthoritativeColorToken({ enrichment, signalKey: "text", requireDark: true });
  const authoritativeDarkDivider = resolveAuthoritativeColorToken({ enrichment, signalKey: "divider", requireDark: true });

  const authoritativeDarkPalette: DesignIrDarkPaletteHints = {
    ...(authoritativeDarkPrimary ? { primary: authoritativeDarkPrimary } : {}),
    ...(authoritativeDarkSecondary ? { secondary: authoritativeDarkSecondary } : {}),
    ...(authoritativeDarkSuccess ? { success: authoritativeDarkSuccess } : {}),
    ...(authoritativeDarkWarning ? { warning: authoritativeDarkWarning } : {}),
    ...(authoritativeDarkError ? { error: authoritativeDarkError } : {}),
    ...(authoritativeDarkInfo ? { info: authoritativeDarkInfo } : {}),
    ...(authoritativeDarkBackground ? { background: { default: authoritativeDarkBackground } } : {}),
    ...(authoritativeDarkText ? { text: { primary: authoritativeDarkText } } : {}),
    ...(authoritativeDarkDivider ? { divider: authoritativeDarkDivider } : {})
  };
  const hasAuthoritativeDarkPalette = Object.keys(authoritativeDarkPalette).length > 0;
  const resolvedDarkModeDetected = hasAuthoritativeDarkPalette || darkModeDetected;
  if (!resolvedDarkModeDetected) {
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
    authoritativeDarkPalette.background?.default ??
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
  const darkText =
    authoritativeDarkPalette.text?.primary ??
    resolveBestContrastCandidate({
    backgroundColor: darkBackground,
    candidates: [inferredText, tokens.palette.text, DEFAULT_DARK_TEXT_COLOR, "#ffffff", "#f3f4f6"]
  });

  const darkPrimary =
    authoritativeDarkPalette.primary ??
    choosePrimaryColor({
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText
  });
  const darkSecondary =
    authoritativeDarkPalette.secondary ??
    chooseSecondaryColor({
    clusters,
    backgroundColor: darkBackground,
    primaryColor: darkPrimary
  });
  const darkSuccess =
    authoritativeDarkPalette.success ??
    chooseSemanticColor({
    semanticKey: "success",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkWarning =
    authoritativeDarkPalette.warning ??
    chooseSemanticColor({
    semanticKey: "warning",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkError =
    authoritativeDarkPalette.error ??
    chooseSemanticColor({
    semanticKey: "error",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkInfo =
    authoritativeDarkPalette.info ??
    chooseSemanticColor({
    semanticKey: "info",
    clusters,
    backgroundColor: darkBackground,
    textColor: darkText,
    primaryColor: darkPrimary,
    secondaryColor: darkSecondary
  });
  const darkDivider =
    authoritativeDarkPalette.divider ??
    chooseSemanticColor({
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
      luminance: hasAuthoritativeDarkPalette ? false : luminanceSignal,
      naming: hasAuthoritativeDarkPalette ? true : namingSignal,
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
  hintsById: Map<string, CompositeMcpHint>,
  assetsById: Map<string, NonNullable<FigmaMcpEnrichment["assets"]>[number]>
): ScreenElementIR => {
  const hint = hintsById.get(element.id);
  const asset = assetsById.get(element.id);
  const explicitBoardComponent = resolveExplicitBoardComponentFromNode({
    name: element.name,
    type: element.nodeType
  });
  const inferredType = hint ? inferTypeFromSemanticHint(hint.semanticName, hint.semanticType) : undefined;
  const preferHintType = hint?.semanticSource === "code_connect" || hint?.semanticSource === "design_system";

  const nextName =
    hint?.semanticName &&
    ((preferHintType && hint.semanticName.trim().length > 0) ||
      (!explicitBoardComponent &&
        (isGenericElementName(element.name) || hint.semanticName.length > element.name.length + 2)))
      ? hint.semanticName
      : element.name;
  const nextChildren = (element.children ?? []).map((child) => applyMcpHintToElement(child, hintsById, assetsById));
  const nextType = preferHintType
    ? inferredType ?? explicitBoardComponent?.type ?? element.type
    : explicitBoardComponent?.type ?? inferredType ?? element.type;
  const upstreamMappingOrigin: "code_connect" | "design_system" =
    hint?.semanticSource === "design_system" ? "design_system" : "code_connect";
  const baseWithHint = {
    ...element,
    name: nextName,
    children: nextChildren,
    ...(hint?.semanticName || element.semanticName ? { semanticName: hint?.semanticName ?? element.semanticName } : {}),
    ...(hint?.semanticType || explicitBoardComponent?.canonicalName || element.semanticType
      ? { semanticType: hint?.semanticType ?? explicitBoardComponent?.canonicalName ?? element.semanticType }
      : {}),
    ...(hint?.semanticSource || explicitBoardComponent?.canonicalName || element.semanticSource
      ? {
          semanticSource:
            hint?.semanticSource ?? (explicitBoardComponent?.canonicalName ? "board" : element.semanticSource)
        }
      : {}),
    ...(hint?.codeConnect
        ? {
          codeConnect: {
            origin: upstreamMappingOrigin,
            componentName: hint.codeConnect.componentName,
            source: hint.codeConnect.source,
            ...(hint.codeConnect.label ? { label: hint.codeConnect.label } : {}),
            ...(hint.codeConnect.propContract ? { propContract: hint.codeConnect.propContract } : {})
          }
        }
      : element.codeConnect
        ? { codeConnect: element.codeConnect }
        : {}),
    ...(asset
      ? {
          asset: {
            source: asset.source,
            kind: asset.kind,
            ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
            ...(asset.alt ? { alt: asset.alt } : {}),
            ...(asset.label ? { label: asset.label } : {}),
            ...(asset.purpose ? { purpose: asset.purpose } : {})
          }
        }
      : element.asset
        ? { asset: element.asset }
        : {})
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
  const hintsById = toCompositeHintMap(enrichment);
  const assetsById = new Map((enrichment.assets ?? []).map((asset) => [asset.nodeId, asset] as const));
  const nextNodeDiagnostics = [...(ir.metrics?.nodeDiagnostics ?? [])];
  const pushNodeDiagnostic = ({
    nodeId,
    category,
    reason
  }: {
    nodeId: string;
    category: import("./types.js").NodeDiagnosticCategory;
    reason: string;
  }): void => {
    if (nextNodeDiagnostics.some((entry) => entry.nodeId === nodeId && entry.category === category)) {
      return;
    }
    nextNodeDiagnostics.push({
      nodeId,
      category,
      reason
    });
  };
  if ((enrichment.variables?.length ?? 0) === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:variables",
      category: "missing-variable-enrichment",
      reason: "Hybrid mode did not provide authoritative variable definitions."
    });
  }
  if ((enrichment.styleCatalog?.length ?? 0) === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:styles",
      category: "missing-style-enrichment",
      reason: "Hybrid mode did not provide an authoritative style catalog."
    });
  }
  if ((enrichment.codeConnectMappings?.length ?? 0) === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:code-connect",
      category: "missing-code-connect-enrichment",
      reason: "Hybrid mode did not provide Code Connect mappings for this board."
    });
  }
  if ((enrichment.designSystemMappings?.length ?? 0) === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:design-system",
      category: "missing-code-connect-enrichment",
      reason: "Hybrid mode did not provide design-system suggestions for this board."
    });
  }
  if ((enrichment.metadataHints?.length ?? 0) === 0 && enrichment.nodeHints.length === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:metadata",
      category: "missing-metadata-enrichment",
      reason: "Hybrid mode did not provide metadata or semantic node hints."
    });
  }
  if ((enrichment.assets?.length ?? 0) === 0) {
    pushNodeDiagnostic({
      nodeId: "__mcp:assets",
      category: "asset-fallback",
      reason: "Hybrid mode did not provide asset references; generator will fall back to exported assets or placeholders."
    });
  }
  if ((enrichment.diagnostics ?? []).some((entry) => entry.severity === "warning")) {
    pushNodeDiagnostic({
      nodeId: "__mcp:loader",
      category: "hybrid-fallback",
      reason: "Hybrid mode fell back to REST-only or partial enrichment because MCP coverage was incomplete."
    });
  }
  const nextMetrics =
    ir.metrics === undefined
      ? undefined
      : {
          ...ir.metrics,
          mcpCoverage: buildMcpCoverageMetric({ enrichment }),
          ...(nextNodeDiagnostics.length > 0 ? { nodeDiagnostics: nextNodeDiagnostics } : {})
        };
  return {
    ...ir,
    ...(nextMetrics ? { metrics: nextMetrics } : {}),
    screens: ir.screens.map((screen) => ({
      ...screen,
      children:
        hintsById.size === 0 && assetsById.size === 0
          ? screen.children
          : screen.children.map((child) => applyMcpHintToElement(child, hintsById, assetsById))
    }))
  };
};
