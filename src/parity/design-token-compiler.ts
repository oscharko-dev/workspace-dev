import type {
  DesignIR,
  DesignTokenSource,
  ScreenElementIR,
} from "./types.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";

export const DESIGN_TOKEN_CSS_PATH = "src/theme/tokens.css";
export const DESIGN_TOKEN_REPORT_PATH = "src/theme/token-report.json";
export const DESIGN_TOKENS_JSON_PATH = "src/theme/tokens.json";

const TOKEN_REPORT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_PIPELINE_ID = "default";

type TokenCategory =
  | "colors"
  | "typography"
  | "fontWeights"
  | "spacing"
  | "radius"
  | "borders"
  | "shadows"
  | "opacity"
  | "zIndex"
  | "darkMode";

type TokenCategorySource = DesignTokenSource | "derived" | "figma" | "mixed";

interface TokenCategoryReport {
  mapped: number;
  total: number;
  source: TokenCategorySource;
  fallbacks: number;
}

export interface TokenReportFallback {
  kind: TokenCategory | "fontFamily";
  nodeId?: string;
  reason: string;
  fallback: string;
}

export interface DesignTokenReport {
  schemaVersion: typeof TOKEN_REPORT_SCHEMA_VERSION;
  pipelineId: typeof DEFAULT_PIPELINE_ID;
  artifacts: {
    cssCustomProperties: typeof DESIGN_TOKEN_CSS_PATH;
    designTokens: typeof DESIGN_TOKENS_JSON_PATH;
    tokenReport: typeof DESIGN_TOKEN_REPORT_PATH;
  };
  tokenCoverage: number;
  categories: Record<TokenCategory, TokenCategoryReport>;
  cssCustomProperties: {
    path: typeof DESIGN_TOKEN_CSS_PATH;
    count: number;
  };
  darkMode: {
    detected: boolean;
    selector?: "[data-theme=\"dark\"]";
  };
  conflicts: Array<Record<string, unknown>>;
  fallbacks: TokenReportFallback[];
  unmappedVariables: string[];
  libraryKeys: string[];
  modeAlternatives?: Record<string, Record<string, string | number | boolean>>;
}

export interface CompiledDesignTokenArtifacts {
  cssCustomProperties: string;
  tokenReport: DesignTokenReport;
}

type CssTokenDeclaration = {
  category: TokenCategory;
  name: string;
  value: string;
};

const round = (value: number, precision = 3): number => {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
};

const toPx = (value: number): string => `${String(round(Math.max(0, value)))}px`;

const toCssString = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

const normalizeTokenName = (value: string): string =>
  value
    .replace(/\s+/g, "-")
    .replace(/[/_]/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const alphaFromHex = (value: string | undefined): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace("#", "");
  if (normalized.length !== 8) {
    return undefined;
  }
  const alpha = Number.parseInt(normalized.slice(6, 8), 16);
  return Number.isFinite(alpha) ? round(alpha / 255, 3) : undefined;
};

const collectElements = (elements: readonly ScreenElementIR[]): ScreenElementIR[] => {
  const collected: ScreenElementIR[] = [];
  const visit = (element: ScreenElementIR): void => {
    collected.push(element);
    for (const child of element.children ?? []) {
      visit(child);
    }
  };
  for (const element of elements) {
    visit(element);
  }
  return collected;
};

const collectAllElements = (ir: DesignIR): ScreenElementIR[] => ir.screens.flatMap((screen) => collectElements(screen.children));

const pushDeclaration = (lines: string[], name: string, value: string | number): void => {
  const normalizedName = normalizeTokenName(name);
  if (normalizedName.length === 0) {
    return;
  }
  lines.push(`  --${normalizedName}: ${String(value)};`);
};

const pushUniqueDeclaration = (lines: string[], names: Set<string>, name: string, value: string | number): void => {
  const normalizedName = normalizeTokenName(name);
  if (normalizedName.length === 0 || names.has(normalizedName)) {
    return;
  }
  names.add(normalizedName);
  lines.push(`  --${normalizedName}: ${String(value)};`);
};

const sourceFor = (source: DesignTokenSource | undefined, fallback: TokenCategorySource = "derived"): TokenCategorySource =>
  source ?? fallback;

const sourceForWithFigmaBackedTokens = ({
  source,
  figmaBackedCount,
  fallback = "derived",
}: {
  source: DesignTokenSource | undefined;
  figmaBackedCount: number;
  fallback?: TokenCategorySource;
}): TokenCategorySource => {
  if (figmaBackedCount === 0) {
    return sourceFor(source, fallback);
  }
  if (source === "variables") {
    return "variables";
  }
  if (source && source !== "clustering") {
    return "mixed";
  }
  return "figma";
};

const categorizeCssTokenDeclaration = (name: string): TokenCategory | undefined => {
  const normalized = normalizeTokenName(name);
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.startsWith("border-radius") || normalized.startsWith("radius")) {
    return "radius";
  }
  if (normalized.startsWith("border")) {
    return "borders";
  }
  if (normalized.startsWith("shadow") || normalized.startsWith("box-shadow")) {
    return "shadows";
  }
  if (normalized.startsWith("z-index") || normalized.startsWith("zindex")) {
    return "zIndex";
  }
  if (normalized.startsWith("opacity") || normalized.includes("-opacity")) {
    return "opacity";
  }
  if (normalized.startsWith("spacing") || normalized.startsWith("space") || normalized.startsWith("gap")) {
    return "spacing";
  }
  if (normalized.startsWith("font-weight")) {
    return "fontWeights";
  }
  if (
    normalized.startsWith("typography") ||
    normalized.startsWith("font") ||
    normalized.startsWith("line-height") ||
    normalized.startsWith("letter-spacing")
  ) {
    return "typography";
  }
  if (normalized.startsWith("color") || normalized.includes("-color") || normalized.startsWith("surface")) {
    return "colors";
  }
  return undefined;
};

const parseCssTokenDeclarations = (cssCustomProperties: string | undefined): CssTokenDeclaration[] => {
  if (!cssCustomProperties) {
    return [];
  }

  const declarations = new Map<string, CssTokenDeclaration>();
  const declarationPattern = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/gu;
  for (const match of cssCustomProperties.matchAll(declarationPattern)) {
    const rawName = match[1];
    const rawValue = match[2];
    if (!rawName || !rawValue) {
      continue;
    }
    const name = normalizeTokenName(rawName);
    const category = categorizeCssTokenDeclaration(name);
    const value = rawValue.trim();
    if (!category || name.length === 0 || value.length === 0) {
      continue;
    }
    declarations.set(name, {
      category,
      name,
      value,
    });
  }

  return [...declarations.values()].sort((left, right) => left.name.localeCompare(right.name));
};

const countCssTokenDeclarationsByCategory = (
  declarations: readonly CssTokenDeclaration[],
): Record<TokenCategory, number> => {
  const counts = {
    colors: 0,
    typography: 0,
    fontWeights: 0,
    spacing: 0,
    radius: 0,
    borders: 0,
    shadows: 0,
    opacity: 0,
    zIndex: 0,
    darkMode: 0,
  } satisfies Record<TokenCategory, number>;

  for (const declaration of declarations) {
    counts[declaration.category] += 1;
  }

  return counts;
};

const canonicalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeJsonValue(nested)]),
    );
  }
  return value;
};

const canonicalizeModeAlternatives = (
  modeAlternatives: Record<string, Record<string, string | number | boolean>> | undefined,
): Record<string, Record<string, string | number | boolean>> | undefined => {
  if (!modeAlternatives) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(modeAlternatives)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tokenName, modes]) => [
        tokenName,
        Object.fromEntries(Object.entries(modes).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
};

const buildFallbacks = ({
  ir,
  elements,
  figmaBacked,
}: {
  ir: DesignIR;
  elements: readonly ScreenElementIR[];
  figmaBacked: Record<TokenCategory, number>;
}): TokenReportFallback[] => {
  const fallbacks: TokenReportFallback[] = [];
  const tokenSource = ir.tokens.tokenSource;
  const maybePushTokenSourceFallback = ({
    kind,
    source,
    fallback,
  }: {
    kind: TokenReportFallback["kind"];
    source: DesignTokenSource | undefined;
    fallback: string;
  }): void => {
    const tokenCategory = kind === "fontFamily" ? "typography" : kind;
    if (figmaBacked[tokenCategory] > 0) {
      return;
    }
    if (source === "clustering") {
      fallbacks.push({
        kind,
        reason: "missing_authoritative_figma_token",
        fallback,
      });
    }
  };

  maybePushTokenSourceFallback({
    kind: "colors",
    source: tokenSource?.palette,
    fallback: "semantic color clustering",
  });
  maybePushTokenSourceFallback({
    kind: "typography",
    source: tokenSource?.typography,
    fallback: "sampled text scale",
  });
  maybePushTokenSourceFallback({
    kind: "spacing",
    source: tokenSource?.spacing,
    fallback: `${String(ir.tokens.spacingBase)}px`,
  });
  maybePushTokenSourceFallback({
    kind: "radius",
    source: tokenSource?.borderRadius,
    fallback: `${String(ir.tokens.borderRadius)}px`,
  });
  maybePushTokenSourceFallback({
    kind: "fontFamily",
    source: tokenSource?.fontFamily,
    fallback: ir.tokens.fontFamily,
  });

  if (
    figmaBacked.shadows === 0 &&
    !elements.some((element) => typeof element.elevation === "number" || typeof element.insetShadow === "string")
  ) {
    fallbacks.push({
      kind: "shadows",
      reason: "missing_figma_effect_style",
      fallback: "none",
    });
  }
  if (figmaBacked.opacity === 0 && !elements.some((element) => typeof element.opacity === "number")) {
    fallbacks.push({
      kind: "opacity",
      reason: "missing_explicit_opacity_token",
      fallback: "material action opacity defaults",
    });
  }
  if (
    figmaBacked.zIndex === 0 &&
    !elements.some((element) => /\b(dialog|modal|drawer|popover|tooltip|snackbar|toast)\b/i.test(element.name))
  ) {
    fallbacks.push({
      kind: "zIndex",
      reason: "missing_layering_hint",
      fallback: "material layering defaults",
    });
  }

  return fallbacks.sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    return left.reason.localeCompare(right.reason);
  });
};

const buildShadowDeclarations = ({
  lines,
  elements,
}: {
  lines: string[];
  elements: readonly ScreenElementIR[];
}): number => {
  const insetShadows = [...new Set(elements.map((element) => element.insetShadow).filter((value): value is string => Boolean(value)))].sort(
    (left, right) => left.localeCompare(right),
  );
  const elevations = [
    ...new Set(
      elements
        .map((element) => element.elevation)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value)),
    ),
  ].sort((left, right) => left - right);

  let count = 0;
  for (const [index, shadow] of insetShadows.entries()) {
    pushDeclaration(lines, `shadow-inset-${String(index + 1)}`, shadow);
    count += 1;
  }
  for (const elevation of elevations) {
    const y = Math.max(1, Math.ceil(elevation / 2));
    const blur = Math.max(2, elevation * 2 + 2);
    pushDeclaration(lines, `shadow-elevation-${String(elevation)}`, `0 ${String(y)}px ${String(blur)}px rgba(15, 23, 42, 0.18)`);
    count += 1;
  }
  if (count === 0) {
    pushDeclaration(lines, "shadow-none", "none");
    return 0;
  }
  return count;
};

const buildOpacityDeclarations = ({
  lines,
  elements,
  ir,
}: {
  lines: string[];
  elements: readonly ScreenElementIR[];
  ir: DesignIR;
}): number => {
  const explicitOpacity = [
    ...new Set(
      elements
        .map((element) => element.opacity)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
        .map((value) => round(value, 3)),
    ),
  ].sort((left, right) => left - right);

  for (const value of explicitOpacity) {
    pushDeclaration(lines, `opacity-${String(Math.round(value * 100))}`, value);
  }

  const disabled = alphaFromHex(ir.tokens.palette.action.disabled);
  const hover = alphaFromHex(ir.tokens.palette.action.hover);
  const focus = alphaFromHex(ir.tokens.palette.action.focus);
  if (disabled !== undefined) {
    pushDeclaration(lines, "opacity-disabled", disabled);
  }
  if (hover !== undefined) {
    pushDeclaration(lines, "opacity-hover", hover);
  }
  if (focus !== undefined) {
    pushDeclaration(lines, "opacity-focus", focus);
  }

  return explicitOpacity.length;
};

const buildZIndexDeclarations = ({
  lines,
  elements,
}: {
  lines: string[];
  elements: readonly ScreenElementIR[];
}): number => {
  const zIndexTokens: Array<readonly [string, number]> = [
    ["z-index-app-bar", 1100],
    ["z-index-drawer", 1200],
    ["z-index-modal", 1300],
    ["z-index-snackbar", 1400],
    ["z-index-tooltip", 1500],
  ];
  for (const [name, value] of zIndexTokens) {
    pushDeclaration(lines, name, value);
  }
  return elements.filter((element) => /\b(dialog|modal|drawer|popover|tooltip|snackbar|toast)\b/i.test(element.name)).length;
};

const buildCssCustomProperties = ({
  ir,
  elements,
}: {
  ir: DesignIR;
  elements: readonly ScreenElementIR[];
}): {
  content: string;
  count: number;
  figmaBacked: Record<TokenCategory, number>;
  mapped: Record<TokenCategory, number>;
} => {
  const lines: string[] = [];
  const rootNames = new Set<string>();
  const tokens = ir.tokens;
  const pushRootDeclaration = (name: string, value: string | number): void => pushUniqueDeclaration(lines, rootNames, name, value);
  const pushPaletteDeclaration = (name: string, value: string): void => pushRootDeclaration(`color-${name}`, value);
  const figmaDeclarations = parseCssTokenDeclarations(ir.tokenArtifacts?.cssCustomProperties);
  const figmaBacked = countCssTokenDeclarationsByCategory(figmaDeclarations);

  for (const declaration of figmaDeclarations) {
    pushRootDeclaration(declaration.name, declaration.value);
  }

  pushPaletteDeclaration("primary", tokens.palette.primary);
  pushPaletteDeclaration("secondary", tokens.palette.secondary);
  pushPaletteDeclaration("success", tokens.palette.success);
  pushPaletteDeclaration("warning", tokens.palette.warning);
  pushPaletteDeclaration("error", tokens.palette.error);
  pushPaletteDeclaration("info", tokens.palette.info);
  pushPaletteDeclaration("background", tokens.palette.background);
  pushPaletteDeclaration("text", tokens.palette.text);
  pushPaletteDeclaration("divider", tokens.palette.divider);
  pushPaletteDeclaration("action-active", tokens.palette.action.active);
  pushPaletteDeclaration("action-hover", tokens.palette.action.hover);
  pushPaletteDeclaration("action-selected", tokens.palette.action.selected);
  pushPaletteDeclaration("action-disabled", tokens.palette.action.disabled);
  pushPaletteDeclaration("action-disabled-background", tokens.palette.action.disabledBackground);
  pushPaletteDeclaration("action-focus", tokens.palette.action.focus);

  pushRootDeclaration("font-family-base", `"${toCssString(tokens.fontFamily)}"`);
  for (const variantName of DESIGN_TYPOGRAPHY_VARIANTS) {
    const variant = tokens.typography[variantName];
    pushRootDeclaration(`typography-${variantName}-font-size`, toPx(variant.fontSizePx));
    pushRootDeclaration(`typography-${variantName}-line-height`, toPx(variant.lineHeightPx));
    pushRootDeclaration(`font-weight-${variantName}`, Math.round(variant.fontWeight));
    if (typeof variant.letterSpacingEm === "number") {
      pushRootDeclaration(`typography-${variantName}-letter-spacing`, `${String(round(variant.letterSpacingEm, 4))}em`);
    }
    if (variant.textTransform) {
      pushRootDeclaration(`typography-${variantName}-text-transform`, variant.textTransform);
    }
  }

  const spacingBase = Math.max(1, tokens.spacingBase);
  pushRootDeclaration("spacing-base", toPx(spacingBase));
  pushRootDeclaration("spacing-xs", toPx(spacingBase / 2));
  pushRootDeclaration("spacing-sm", toPx(spacingBase));
  pushRootDeclaration("spacing-md", toPx(spacingBase * 2));
  pushRootDeclaration("spacing-lg", toPx(spacingBase * 4));
  pushRootDeclaration("spacing-xl", toPx(spacingBase * 8));

  const radiusBase = Math.max(0, tokens.borderRadius);
  pushRootDeclaration("radius-sm", toPx(radiusBase / 2));
  pushRootDeclaration("radius-md", toPx(radiusBase));
  pushRootDeclaration("radius-lg", toPx(radiusBase * 1.5));
  pushRootDeclaration("radius-pill", "9999px");

  pushRootDeclaration("border-color-default", tokens.palette.divider);
  pushRootDeclaration("border-color-focus", tokens.palette.primary);
  pushRootDeclaration("border-width-default", "1px");

  const shadowCount = buildShadowDeclarations({ lines, elements });
  const explicitOpacityCount = buildOpacityDeclarations({ lines, elements, ir });
  const explicitZIndexCount = buildZIndexDeclarations({ lines, elements });

  const darkLines: string[] = [];
  const darkNames = new Set<string>();
  const pushDarkDeclaration = (name: string, value: string | number | boolean): void => {
    pushUniqueDeclaration(darkLines, darkNames, name, String(value));
  };
  const darkHints = ir.themeAnalysis?.darkPaletteHints;
  if (ir.themeAnalysis?.darkModeDetected) {
    if (darkHints?.primary) pushDarkDeclaration("color-primary", darkHints.primary);
    if (darkHints?.secondary) pushDarkDeclaration("color-secondary", darkHints.secondary);
    if (darkHints?.success) pushDarkDeclaration("color-success", darkHints.success);
    if (darkHints?.warning) pushDarkDeclaration("color-warning", darkHints.warning);
    if (darkHints?.error) pushDarkDeclaration("color-error", darkHints.error);
    if (darkHints?.info) pushDarkDeclaration("color-info", darkHints.info);
    if (darkHints?.background?.default) pushDarkDeclaration("color-background", darkHints.background.default);
    if (darkHints?.background?.paper) pushDarkDeclaration("color-surface", darkHints.background.paper);
    if (darkHints?.text?.primary) pushDarkDeclaration("color-text", darkHints.text.primary);
    if (darkHints?.divider) pushDarkDeclaration("color-divider", darkHints.divider);
    for (const [name, modeValues] of Object.entries(ir.tokenArtifacts?.modeAlternatives ?? {}).sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      const darkEntry = Object.entries(modeValues)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .find(([modeName]) => /\b(dark|night|midnight|nocturne|amoled)\b/i.test(modeName));
      if (darkEntry) {
        pushDarkDeclaration(name, darkEntry[1]);
      }
    }
  }

  const blocks = [`:root {\n${lines.join("\n")}\n}`];
  if (darkLines.length > 0) {
    blocks.push(`[data-theme="dark"] {\n${darkLines.join("\n")}\n}`);
  }

  return {
    content: `${blocks.join("\n\n")}\n`,
    count: lines.length + darkLines.length,
    mapped: {
      colors: 15,
      typography: Math.max(DESIGN_TYPOGRAPHY_VARIANTS.length, figmaBacked.typography),
      fontWeights: Math.max(DESIGN_TYPOGRAPHY_VARIANTS.length, figmaBacked.fontWeights),
      spacing: Math.max(6, figmaBacked.spacing),
      radius: Math.max(4, figmaBacked.radius),
      borders: Math.max(3, figmaBacked.borders),
      shadows: Math.max(shadowCount, figmaBacked.shadows),
      opacity: Math.max(explicitOpacityCount, figmaBacked.opacity),
      zIndex: Math.max(explicitZIndexCount, figmaBacked.zIndex),
      darkMode: darkLines.length > 0 ? 1 : 0,
    },
    figmaBacked,
  };
};

const buildCategoryReport = ({
  ir,
  figmaBacked,
  mapped,
  fallbacks,
}: {
  ir: DesignIR;
  figmaBacked: Record<TokenCategory, number>;
  mapped: Record<TokenCategory, number>;
  fallbacks: readonly TokenReportFallback[];
}): Record<TokenCategory, TokenCategoryReport> => {
  const fallbackCount = (kind: TokenCategory): number => fallbacks.filter((fallback) => fallback.kind === kind).length;
  return {
    colors: {
      mapped: mapped.colors,
      total: 15,
      source: sourceForWithFigmaBackedTokens({
        source: ir.tokens.tokenSource?.palette,
        figmaBackedCount: figmaBacked.colors,
      }),
      fallbacks: fallbackCount("colors"),
    },
    typography: {
      mapped: mapped.typography,
      total: DESIGN_TYPOGRAPHY_VARIANTS.length,
      source: sourceForWithFigmaBackedTokens({
        source: ir.tokens.tokenSource?.typography,
        figmaBackedCount: figmaBacked.typography,
      }),
      fallbacks: fallbackCount("typography"),
    },
    fontWeights: {
      mapped: mapped.fontWeights,
      total: DESIGN_TYPOGRAPHY_VARIANTS.length,
      source: sourceForWithFigmaBackedTokens({
        source: ir.tokens.tokenSource?.typography,
        figmaBackedCount: figmaBacked.fontWeights,
      }),
      fallbacks: 0,
    },
    spacing: {
      mapped: mapped.spacing,
      total: 6,
      source: sourceForWithFigmaBackedTokens({
        source: ir.tokens.tokenSource?.spacing,
        figmaBackedCount: figmaBacked.spacing,
      }),
      fallbacks: fallbackCount("spacing"),
    },
    radius: {
      mapped: mapped.radius,
      total: 4,
      source: sourceForWithFigmaBackedTokens({
        source: ir.tokens.tokenSource?.borderRadius,
        figmaBackedCount: figmaBacked.radius,
      }),
      fallbacks: fallbackCount("radius"),
    },
    borders: {
      mapped: mapped.borders,
      total: 3,
      source: figmaBacked.borders > 0 ? "figma" : "derived",
      fallbacks: fallbackCount("borders"),
    },
    shadows: {
      mapped: mapped.shadows,
      total: Math.max(1, mapped.shadows),
      source: figmaBacked.shadows > 0 || mapped.shadows > 0 ? "figma" : "derived",
      fallbacks: fallbackCount("shadows"),
    },
    opacity: {
      mapped: mapped.opacity,
      total: Math.max(1, mapped.opacity),
      source: figmaBacked.opacity > 0 || mapped.opacity > 0 ? "figma" : "derived",
      fallbacks: fallbackCount("opacity"),
    },
    zIndex: {
      mapped: mapped.zIndex,
      total: Math.max(1, mapped.zIndex),
      source: figmaBacked.zIndex > 0 || mapped.zIndex > 0 ? "figma" : "derived",
      fallbacks: fallbackCount("zIndex"),
    },
    darkMode: {
      mapped: mapped.darkMode,
      total: ir.themeAnalysis?.darkModeDetected ? 1 : 0,
      source: ir.themeAnalysis?.darkModeDetected ? "derived" : "derived",
      fallbacks: fallbackCount("darkMode"),
    },
  };
};

const countCoverage = (categories: Record<TokenCategory, TokenCategoryReport>): number => {
  const totals = Object.values(categories).filter((category) => category.total > 0);
  const mapped = totals.reduce((sum, category) => sum + Math.min(category.mapped, category.total), 0);
  const total = totals.reduce((sum, category) => sum + category.total, 0);
  return total > 0 ? round(mapped / total, 4) : 1;
};

export const compileDesignTokenArtifacts = (ir: DesignIR): CompiledDesignTokenArtifacts => {
  const elements = collectAllElements(ir);
  const compiledCss = buildCssCustomProperties({ ir, elements });
  const fallbacks = buildFallbacks({ ir, elements, figmaBacked: compiledCss.figmaBacked });
  const categories = buildCategoryReport({
    ir,
    figmaBacked: compiledCss.figmaBacked,
    mapped: compiledCss.mapped,
    fallbacks,
  });
  const modeAlternatives = canonicalizeModeAlternatives(ir.tokenArtifacts?.modeAlternatives);
  const tokenReport: DesignTokenReport = {
    schemaVersion: TOKEN_REPORT_SCHEMA_VERSION,
    pipelineId: DEFAULT_PIPELINE_ID,
    artifacts: {
      cssCustomProperties: DESIGN_TOKEN_CSS_PATH,
      designTokens: DESIGN_TOKENS_JSON_PATH,
      tokenReport: DESIGN_TOKEN_REPORT_PATH,
    },
    tokenCoverage: countCoverage(categories),
    categories,
    cssCustomProperties: {
      path: DESIGN_TOKEN_CSS_PATH,
      count: compiledCss.count,
    },
    darkMode: {
      detected: ir.themeAnalysis?.darkModeDetected ?? false,
      ...(ir.themeAnalysis?.darkModeDetected ? { selector: "[data-theme=\"dark\"]" as const } : {}),
    },
    conflicts: [...(ir.tokenArtifacts?.conflicts ?? [])].sort((left, right) =>
      JSON.stringify(canonicalizeJsonValue(left)).localeCompare(JSON.stringify(canonicalizeJsonValue(right))),
    ),
    fallbacks,
    unmappedVariables: [...(ir.tokenArtifacts?.unmappedVariables ?? [])].sort((left, right) => left.localeCompare(right)),
    libraryKeys: [...(ir.tokenArtifacts?.libraryKeys ?? [])].sort((left, right) => left.localeCompare(right)),
    ...(modeAlternatives ? { modeAlternatives } : {}),
  };

  return {
    cssCustomProperties: compiledCss.content,
    tokenReport,
  };
};

export const createDesignTokenReportFile = (ir: DesignIR): { path: string; content: string } => {
  const { tokenReport } = compileDesignTokenArtifacts(ir);
  return {
    path: DESIGN_TOKEN_REPORT_PATH,
    content: `${JSON.stringify(tokenReport, null, 2)}\n`,
  };
};

export const createDesignTokenCssFile = (ir: DesignIR): { path: string; content: string } => {
  const { cssCustomProperties } = compileDesignTokenArtifacts(ir);
  return {
    path: DESIGN_TOKEN_CSS_PATH,
    content: cssCustomProperties,
  };
};
