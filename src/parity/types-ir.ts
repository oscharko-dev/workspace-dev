export interface DesignTokenPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  divider: string;
  action: DesignTokenActionPalette;
}

export interface DesignTokenActionPalette {
  active: string;
  hover: string;
  selected: string;
  disabled: string;
  disabledBackground: string;
  focus: string;
}

export type DesignTokenTypographyVariantName =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "subtitle1"
  | "subtitle2"
  | "body1"
  | "body2"
  | "button"
  | "caption"
  | "overline";

export interface DesignTokenTypographyVariant {
  fontSizePx: number;
  fontWeight: number;
  lineHeightPx: number;
  fontFamily?: string;
  letterSpacingEm?: number;
  textTransform?: "none" | "capitalize" | "uppercase" | "lowercase";
}

export type DesignTokenTypographyScale = Record<DesignTokenTypographyVariantName, DesignTokenTypographyVariant>;

export type DesignTokenSource = "variables" | "styles" | "clustering";

export interface DesignTokenSourceMetric {
  palette: DesignTokenSource;
  typography: DesignTokenSource;
  spacing: DesignTokenSource;
  borderRadius: DesignTokenSource;
  fontFamily: DesignTokenSource;
}

export interface DesignTokens {
  palette: DesignTokenPalette;
  borderRadius: number;
  spacingBase: number;
  fontFamily: string;
  headingSize: number;
  bodySize: number;
  typography: DesignTokenTypographyScale;
  tokenSource?: DesignTokenSourceMetric;
}

export interface DesignIrDarkPaletteHints {
  primary?: string;
  secondary?: string;
  success?: string;
  warning?: string;
  error?: string;
  info?: string;
  background?: {
    default?: string;
    paper?: string;
  };
  text?: {
    primary?: string;
  };
  divider?: string;
}

export interface DesignIrThemeAnalysis {
  darkModeDetected: boolean;
  signals: {
    luminance: boolean;
    naming: boolean;
    lightDarkPair: boolean;
  };
  darkPaletteHints?: DesignIrDarkPaletteHints;
}

export type PrimaryAxisAlignItems = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type CounterAxisAlignItems = "MIN" | "CENTER" | "MAX" | "BASELINE";

export type VariantElementState = "default" | "hover" | "active" | "disabled";
export type ResponsiveBreakpoint = "xs" | "sm" | "md" | "lg" | "xl";

export interface VariantMuiProps {
  variant?: "contained" | "outlined" | "text";
  size?: "small" | "medium" | "large";
  color?: "primary" | "secondary" | "error" | "info" | "success" | "warning" | "inherit";
  disabled?: boolean;
}

export interface VariantStateStyle {
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
}

export interface VariantStateSnapshot {
  nodeId: string;
  state?: VariantElementState;
  properties: Record<string, string>;
  muiProps: VariantMuiProps;
  style: VariantStateStyle;
  isDefault: boolean;
}

export interface VariantMappingIR {
  properties: Record<string, string>;
  muiProps: VariantMuiProps;
  state?: VariantElementState;
  defaultVariantNodeId?: string;
  stateOverrides?: {
    hover?: VariantStateStyle;
    active?: VariantStateStyle;
    disabled?: VariantStateStyle;
  };
  states?: VariantStateSnapshot[];
}

export interface ScreenResponsiveLayoutOverride {
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap?: number;
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  widthRatio?: number;
  minHeight?: number;
}

export type ScreenResponsiveLayoutOverridesByBreakpoint = Partial<
  Record<ResponsiveBreakpoint, ScreenResponsiveLayoutOverride>
>;

export interface ScreenResponsiveVariantIR {
  breakpoint: ResponsiveBreakpoint;
  nodeId: string;
  name: string;
  width?: number;
  height?: number;
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  gap: number;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  isBase: boolean;
}

export interface ScreenResponsiveIR {
  groupKey: string;
  baseBreakpoint: ResponsiveBreakpoint;
  variants: ScreenResponsiveVariantIR[];
  rootLayoutOverrides?: ScreenResponsiveLayoutOverridesByBreakpoint;
  topLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}

export type ScreenElementType =
  | "text"
  | "container"
  | "button"
  | "alert"
  | "accordion"
  | "input"
  | "image"
  | "grid"
  | "stack"
  | "paper"
  | "card"
  | "chip"
  | "switch"
  | "checkbox"
  | "radio"
  | "select"
  | "slider"
  | "rating"
  | "list"
  | "table"
  | "tooltip"
  | "appbar"
  | "drawer"
  | "breadcrumbs"
  | "tab"
  | "dialog"
  | "snackbar"
  | "stepper"
  | "progress"
  | "skeleton"
  | "avatar"
  | "badge"
  | "divider"
  | "navigation";

export interface ElementSpacingIR {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementPrototypeNavigationIR {
  targetScreenId: string;
  mode: "push" | "replace" | "overlay";
}

export type ScreenElementSemanticSource = "board" | "code_connect" | "design_system" | "metadata" | "node_hint" | "heuristic";

export interface ElementCodeConnectMappingIR {
  origin?: "code_connect" | "design_system";
  componentName: string;
  source: string;
  label?: string;
  propContract?: Record<string, unknown>;
}

export interface ElementAssetReferenceIR {
  source: string;
  kind: "image" | "svg" | "icon";
  mimeType?: string;
  alt?: string;
  label?: string;
  purpose?: "render" | "quality-gate" | "context";
}

export interface BaseElementIR {
  id: string;
  name: string;
  nodeType: string;
  semanticName?: string;
  semanticType?: string;
  semanticSource?: ScreenElementSemanticSource;
  codeConnect?: ElementCodeConnectMappingIR;
  asset?: ElementAssetReferenceIR;
  textRole?: "placeholder";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fillColor?: string;
  fillGradient?: string;
  opacity?: number;
  elevation?: number;
  insetShadow?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "LEFT" | "CENTER" | "RIGHT";
  vectorPaths?: string[];
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  gap?: number;
  padding?: ElementSpacingIR;
  margin?: ElementSpacingIR;
  cornerRadius?: number;
  required?: boolean;
  validationType?: string;
  validationMessage?: string;
  validationMin?: number;
  validationMax?: number;
  validationMinLength?: number;
  validationMaxLength?: number;
  validationPattern?: string;
  prototypeNavigation?: ElementPrototypeNavigationIR;
  variantMapping?: VariantMappingIR;
  cssGridHints?: CssGridChildHints;
  children?: ScreenElementIR[];
}

export interface TextElementIR extends BaseElementIR {
  type: "text";
  text: string;
}

export type NonTextElementType = Exclude<ScreenElementType, "text">;

export interface NonTextElementIR extends BaseElementIR {
  type: NonTextElementType;
  text?: string;
}

export type ScreenElementIR = TextElementIR | NonTextElementIR;

export const isTextElement = (element: ScreenElementIR): element is TextElementIR => {
  return element.type === "text";
};

export const isNonTextElement = (element: ScreenElementIR): element is NonTextElementIR => {
  return element.type !== "text";
};

type AssertTrue<T extends true> = T;
export type ScreenElementIRTextRequiresText = AssertTrue<
  Extract<ScreenElementIR, { type: "text" }> extends { text: string } ? true : false
>;

/**
 * CSS Grid placement hints for a child element within a grid container.
 * Populated during IR derivation when spanning or named-area patterns are detected.
 */
export interface CssGridChildHints {
  /** Number of columns this child spans (default 1). */
  gridColumnSpan?: number;
  /** Number of rows this child spans (default 1). */
  gridRowSpan?: number;
  /** Named grid area derived from Figma auto-layout naming. */
  gridArea?: string;
}

export interface ScreenIR {
  id: string;
  name: string;
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  gap: number;
  width?: number;
  height?: number;
  fillColor?: string;
  fillGradient?: string;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  responsive?: ScreenResponsiveIR;
  appShell?: ScreenAppShellIR;
  children: ScreenElementIR[];
}

export interface ScreenAppShellIR {
  id: string;
  contentNodeIds: string[];
}

export interface ScreenElementCountMetric {
  screenId: string;
  screenName: string;
  elements: number;
}

export interface TruncatedScreenMetric {
  screenId: string;
  screenName: string;
  originalElements: number;
  retainedElements: number;
  budget: number;
  droppedTypeCounts?: Record<string, number>;
}

export interface DepthTruncatedScreenMetric {
  screenId: string;
  screenName: string;
  maxDepth: number;
  firstTruncatedDepth: number;
  truncatedBranchCount: number;
}

export interface ClassificationFallbackMetric {
  screenId: string;
  screenName: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  depth: number;
  matchedRulePriority?: number;
  layoutMode?: string;
  semanticType?: string;
}

export type NodeDiagnosticCategory =
  | "hidden"
  | "placeholder"
  | "truncated"
  | "depth-truncated"
  | "classification-fallback"
  | "unsupported-board-component"
  | "degraded-geometry"
  | "hybrid-fallback"
  | "missing-variable-enrichment"
  | "missing-style-enrichment"
  | "missing-code-connect-enrichment"
  | "missing-metadata-enrichment"
  | "asset-fallback";

export interface NodeDiagnosticEntry {
  nodeId: string;
  category: NodeDiagnosticCategory;
  reason: string;
  screenId?: string;
}

export interface SimplificationMetrics {
  removedEmptyNodes: number;
  promotedSingleChild: number;
  promotedGroupMultiChild: number;
  spacingMerges: number;
  guardedSkips: number;
}

export interface McpCoverageMetric {
  sourceMode: "mcp" | "hybrid";
  toolNames: string[];
  nodeHintCount: number;
  metadataHintCount: number;
  codeConnectMappingCount: number;
  designSystemMappingCount: number;
  variableCount: number;
  styleEntryCount: number;
  assetCount: number;
  screenshotCount: number;
  fallbackUsed?: boolean;
  diagnostics?: Array<{
    code: string;
    message: string;
    severity: "info" | "warning";
    source: "loader" | "variables" | "styles" | "code_connect" | "design_system" | "metadata" | "screenshots" | "assets";
  }>;
}

export interface ScreenSimplificationMetric extends SimplificationMetrics {
  screenId: string;
  screenName: string;
}

export interface GenerationMetrics {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  screenElementCounts: ScreenElementCountMetric[];
  truncatedScreens: TruncatedScreenMetric[];
  depthTruncatedScreens?: DepthTruncatedScreenMetric[];
  classificationFallbacks?: ClassificationFallbackMetric[];
  degradedGeometryNodes: string[];
  simplification?: {
    aggregate: SimplificationMetrics;
    screens: ScreenSimplificationMetric[];
  };
  prototypeNavigationDetected?: number;
  prototypeNavigationResolved?: number;
  prototypeNavigationUnresolved?: number;
  prototypeNavigationRendered?: number;
  nodeDiagnostics?: NodeDiagnosticEntry[];
  mcpCoverage?: McpCoverageMetric;
}

export interface DesignIR {
  sourceName: string;
  screens: ScreenIR[];
  tokens: DesignTokens;
  metrics?: GenerationMetrics;
  themeAnalysis?: DesignIrThemeAnalysis;
  appShells?: AppShellIR[];
}

export interface AppShellIR {
  id: string;
  sourceScreenId: string;
  screenIds: string[];
  shellNodeIds: string[];
  slotIndex: number;
  signalIds: string[];
}

export interface DesignNodeFingerprint {
  nodeId: string;
  name: string;
  type: ScreenElementIR["type"];
  nodeType: string;
  boundVariables?: string[];
  semanticName?: string;
  semanticType?: string;
  semanticSource?: ScreenElementSemanticSource;
  codeConnectComponentName?: string;
  codeConnectSource?: string;
  assetSource?: string;
  text?: string;
  fillColor?: string;
  strokeColor?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
}

export interface DesignScreenFingerprint {
  screenId: string;
  name: string;
  filePath: string;
  nodes: DesignNodeFingerprint[];
}

export interface DesignManifest {
  boardKey: string;
  figmaFileKey: string;
  generatedAt: string;
  tokens: DesignTokens;
  screens: DesignScreenFingerprint[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ValidationFailure {
  command: string;
  output: string;
}

// ---------------------------------------------------------------------------
// ValidatedDesignIR — typed wrapper guaranteeing IR completeness for generation
// ---------------------------------------------------------------------------

/**
 * A validated Design IR that guarantees structural completeness for code generation.
 * Use {@link validateDesignIR} to convert a raw `DesignIR` into this type.
 *
 * Invariants:
 * - At least one screen with a non-empty `id` and `name`
 * - All screens have a `children` array (may be empty)
 * - Tokens contain a valid palette, typography scale, and spacing
 * - `sourceName` is a non-empty string
 */
export interface ValidatedDesignIR {
  readonly sourceName: string;
  readonly screens: readonly ScreenIR[];
  readonly tokens: DesignTokens;
  readonly metrics: GenerationMetrics;
  readonly themeAnalysis?: DesignIrThemeAnalysis;
  readonly appShells?: readonly AppShellIR[];
}

export interface IRValidationError {
  readonly code: "IR_EMPTY_SCREENS" | "IR_INVALID_SCREEN" | "IR_MISSING_TOKENS" | "IR_MISSING_SOURCE_NAME";
  readonly message: string;
}

export type IRValidationResult =
  | { readonly valid: true; readonly ir: ValidatedDesignIR }
  | { readonly valid: false; readonly errors: readonly IRValidationError[] };

/**
 * Validates a raw `DesignIR` and returns a `ValidatedDesignIR` on success.
 * Checks:
 * - `sourceName` is a non-empty string
 * - `screens` is a non-empty array where every screen has `id`, `name`, and `children`
 * - `tokens` has a valid palette with `primary` and `background` colours
 * - `tokens.typography` is present and non-empty
 */
export const validateDesignIR = (raw: DesignIR): IRValidationResult => {
  const errors: IRValidationError[] = [];

  if (!raw.sourceName || typeof raw.sourceName !== "string" || !raw.sourceName.trim()) {
    errors.push({
      code: "IR_MISSING_SOURCE_NAME",
      message: "DesignIR.sourceName must be a non-empty string."
    });
  }

  if (!Array.isArray(raw.screens) || raw.screens.length === 0) {
    errors.push({
      code: "IR_EMPTY_SCREENS",
      message: "DesignIR.screens must be a non-empty array."
    });
  } else {
    for (let i = 0; i < raw.screens.length; i++) {
      const screen = raw.screens[i];
      if (!screen || !screen.id || !screen.name || !Array.isArray(screen.children)) {
        errors.push({
          code: "IR_INVALID_SCREEN",
          message: `DesignIR.screens[${i}] must have id, name, and children array.`
        });
      }
    }
  }

  const tokensCandidate = raw.tokens as Partial<DesignTokens> | undefined;
  if (
    !tokensCandidate?.palette?.primary ||
    !tokensCandidate.palette.background ||
    !tokensCandidate.typography ||
    Object.keys(tokensCandidate.typography).length === 0
  ) {
    errors.push({
      code: "IR_MISSING_TOKENS",
      message: "DesignIR.tokens must include palette (with primary and background) and a non-empty typography scale."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const metrics: GenerationMetrics = {
    fetchedNodes: raw.metrics?.fetchedNodes ?? 0,
    skippedHidden: raw.metrics?.skippedHidden ?? 0,
    skippedPlaceholders: raw.metrics?.skippedPlaceholders ?? 0,
    screenElementCounts: [...(raw.metrics?.screenElementCounts ?? [])],
    truncatedScreens: [...(raw.metrics?.truncatedScreens ?? [])],
    degradedGeometryNodes: [...(raw.metrics?.degradedGeometryNodes ?? [])],
    ...(raw.metrics?.classificationFallbacks ? { classificationFallbacks: [...raw.metrics.classificationFallbacks] } : {}),
    prototypeNavigationDetected: raw.metrics?.prototypeNavigationDetected ?? 0,
    prototypeNavigationResolved: raw.metrics?.prototypeNavigationResolved ?? 0,
    prototypeNavigationUnresolved: raw.metrics?.prototypeNavigationUnresolved ?? 0,
    prototypeNavigationRendered: 0,
    ...(raw.metrics?.nodeDiagnostics ? { nodeDiagnostics: [...raw.metrics.nodeDiagnostics] } : {}),
    ...(raw.metrics?.mcpCoverage ? { mcpCoverage: { ...raw.metrics.mcpCoverage } } : {})
  };

  return {
    valid: true,
    ir: {
      sourceName: raw.sourceName,
      screens: raw.screens,
      tokens: raw.tokens,
      metrics,
      ...(raw.themeAnalysis ? { themeAnalysis: raw.themeAnalysis } : {}),
      ...(raw.appShells ? { appShells: raw.appShells } : {})
    }
  };
};
