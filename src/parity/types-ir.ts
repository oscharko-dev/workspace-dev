import type { GeneratedSourceValidationSkippedSummary } from "./generated-source-validation.js";

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

export type DesignTokenTypographyScale = Record<
  DesignTokenTypographyVariantName,
  DesignTokenTypographyVariant
>;

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
  color?:
    | "primary"
    | "secondary"
    | "error"
    | "info"
    | "success"
    | "warning"
    | "inherit";
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
  topLevelLayoutOverrides?: Record<
    string,
    ScreenResponsiveLayoutOverridesByBreakpoint
  >;
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
  | "navigation"
  // Design-context path types (Issue #1002) — only produced by ir-design-context.ts
  | "frame"
  | "component"
  | "instance"
  | "shape"
  | "vector"
  | "group"
  | "section"
  | "componentSet";

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

export type ScreenElementSemanticSource =
  | "board"
  | "code_connect"
  | "design_system"
  | "metadata"
  | "node_hint"
  | "heuristic";

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

export const isTextElement = (
  element: ScreenElementIR,
): element is TextElementIR => {
  return element.type === "text";
};

export const isNonTextElement = (
  element: ScreenElementIR,
): element is NonTextElementIR => {
  return element.type !== "text";
};

type AssertTrue<T extends true> = T;
export type ScreenElementIRTextRequiresText = AssertTrue<
  Extract<ScreenElementIR, { type: "text" }> extends { text: string }
    ? true
    : false
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

export type ScreenVariantFamilyAxis =
  | "pricing-mode"
  | "expansion-state"
  | "validation-state";

export interface ScreenVariantFamilyInitialStateIR {
  pricingMode?: "netto" | "brutto";
  expansionState?: "collapsed" | "expanded";
  validationState?: "default" | "error";
  accordionStateByKey?: Record<string, boolean>;
}

export interface ScreenVariantFieldErrorEvidenceIR {
  message: string;
  visualError: boolean;
  sourceNodeId?: string;
}

export interface ScreenVariantScreenLevelErrorEvidenceIR {
  message: string;
  severity: "error";
  sourceNodeId?: string;
}

export interface ScreenVariantFamilyScenarioIR {
  screenId: string;
  contentScreenId: string;
  initialState: ScreenVariantFamilyInitialStateIR;
  shellTextOverrides?: Record<string, string>;
  fieldErrorEvidenceByFieldKey?: Record<
    string,
    ScreenVariantFieldErrorEvidenceIR
  >;
  screenLevelErrorEvidence?: ScreenVariantScreenLevelErrorEvidenceIR[];
}

export interface ScreenVariantFamilyIR {
  familyId: string;
  canonicalScreenId: string;
  memberScreenIds: string[];
  axes: ScreenVariantFamilyAxis[];
  scenarios: ScreenVariantFamilyScenarioIR[];
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
  | "asset-fallback"
  | "sparkasse-theme-load-failure"
  | "sparkasse-theme-parse-failure";

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
    source:
      | "loader"
      | "variables"
      | "styles"
      | "code_connect"
      | "design_system"
      | "metadata"
      | "screenshots"
      | "assets";
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
  generatedSourceValidation?: GeneratedSourceValidationSkippedSummary;
}

export interface DesignIR {
  sourceName: string;
  screens: ScreenIR[];
  tokens: DesignTokens;
  metrics?: GenerationMetrics;
  themeAnalysis?: DesignIrThemeAnalysis;
  appShells?: AppShellIR[];
  screenVariantFamilies?: ScreenVariantFamilyIR[];
}

export interface AppShellIR {
  id: string;
  sourceScreenId: string;
  screenIds: string[];
  shellNodeIds: string[];
  slotIndex: number;
  /** Diagnostic traceability — references FigmaAnalysisAppShellSignal ids that produced this shell. Not consumed by the generator. */
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
  readonly screenVariantFamilies?: readonly ScreenVariantFamilyIR[];
}

export interface IRValidationError {
  readonly code:
    | "IR_EMPTY_SCREENS"
    | "IR_INVALID_SCREEN"
    | "IR_MISSING_TOKENS"
    | "IR_MISSING_SOURCE_NAME"
    | "IR_INVALID_APP_SHELL"
    | "IR_INVALID_SCREEN_APP_SHELL"
    | "IR_APP_SHELL_DUPLICATE_ID"
    | "IR_APP_SHELL_MISSING_SOURCE_SCREEN"
    | "IR_APP_SHELL_MISSING_SCREEN"
    | "IR_APP_SHELL_EMPTY_SCREEN_IDS"
    | "IR_APP_SHELL_EMPTY_SHELL_NODES"
    | "IR_APP_SHELL_EMPTY_SIGNAL_IDS"
    | "IR_APP_SHELL_DUPLICATE_SIGNAL_IDS"
    | "IR_APP_SHELL_INVALID_SHELL_NODE"
    | "IR_APP_SHELL_SLOT_INDEX_MISMATCH"
    | "IR_APP_SHELL_NON_CONTIGUOUS_SHELL_NODES"
    | "IR_APP_SHELL_SCREEN_NOT_ATTACHED"
    | "IR_SCREEN_APP_SHELL_MISSING_DEFINITION"
    | "IR_SCREEN_APP_SHELL_SCREEN_MISMATCH"
    | "IR_SCREEN_APP_SHELL_EMPTY_CONTENT"
    | "IR_SCREEN_APP_SHELL_INVALID_CONTENT_NODE"
    | "IR_SCREEN_APP_SHELL_NON_CONTIGUOUS_CONTENT_NODES"
    | "IR_INVALID_SCREEN_VARIANT_FAMILY"
    | "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_ID"
    | "IR_SCREEN_VARIANT_FAMILY_MISSING_CANONICAL_SCREEN"
    | "IR_SCREEN_VARIANT_FAMILY_MISSING_MEMBER_SCREEN"
    | "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_MEMBER"
    | "IR_SCREEN_VARIANT_FAMILY_CANONICAL_NOT_MEMBER"
    | "IR_SCREEN_VARIANT_FAMILY_CANONICAL_COLLISION"
    | "IR_SCREEN_VARIANT_FAMILY_MEMBER_COLLISION"
    | "IR_SCREEN_VARIANT_FAMILY_EMPTY_AXES"
    | "IR_SCREEN_VARIANT_FAMILY_CANONICAL_NOT_IN_SCENARIOS"
    | "IR_SCREEN_VARIANT_FAMILY_MEMBER_NOT_IN_SCENARIOS"
    | "IR_INVALID_SCREEN_VARIANT_SCENARIO"
    | "IR_SCREEN_VARIANT_SCENARIO_MISSING_SCREEN"
    | "IR_SCREEN_VARIANT_SCENARIO_MISSING_CONTENT_SCREEN"
    | "IR_SCREEN_VARIANT_SCENARIO_DUPLICATE"
    | "IR_SCREEN_VARIANT_SCENARIO_ERROR_STATE_MISSING_EVIDENCE";
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
 * - optional app-shell declarations and screen references are internally consistent
 */
export const validateDesignIR = (raw: DesignIR): IRValidationResult => {
  const errors: IRValidationError[] = [];

  if (
    !raw.sourceName ||
    typeof raw.sourceName !== "string" ||
    !raw.sourceName.trim()
  ) {
    errors.push({
      code: "IR_MISSING_SOURCE_NAME",
      message: "DesignIR.sourceName must be a non-empty string.",
    });
  }

  if (!Array.isArray(raw.screens) || raw.screens.length === 0) {
    errors.push({
      code: "IR_EMPTY_SCREENS",
      message: "DesignIR.screens must be a non-empty array.",
    });
  } else {
    for (let i = 0; i < raw.screens.length; i++) {
      const screen = raw.screens[i];
      if (
        !screen ||
        !screen.id ||
        !screen.name ||
        !Array.isArray(screen.children)
      ) {
        errors.push({
          code: "IR_INVALID_SCREEN",
          message: `DesignIR.screens[${i}] must have id, name, and children array.`,
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
      message:
        "DesignIR.tokens must include palette (with primary and background) and a non-empty typography scale.",
    });
  }

  const screenById = new Map<string, ScreenIR>();
  if (Array.isArray(raw.screens)) {
    for (const screen of raw.screens) {
      if (!screen.id || !Array.isArray(screen.children)) {
        continue;
      }
      screenById.set(screen.id, screen);
    }
  }
  const screenIdSet = new Set(screenById.keys());
  const appShellById = new Map<string, AppShellIR>();

  if (Array.isArray(raw.appShells)) {
    const seenAppShellIds = new Set<string>();
    for (let i = 0; i < raw.appShells.length; i++) {
      const appShell = raw.appShells[i];
      if (
        !appShell ||
        !appShell.id ||
        !appShell.sourceScreenId ||
        !Array.isArray(appShell.screenIds) ||
        !Array.isArray(appShell.shellNodeIds) ||
        !Array.isArray(appShell.signalIds) ||
        typeof appShell.slotIndex !== "number"
      ) {
        errors.push({
          code: "IR_INVALID_APP_SHELL",
          message:
            `DesignIR.appShells[${i}] must have id, sourceScreenId, screenIds array, shellNodeIds array, ` +
            "signalIds array, and numeric slotIndex.",
        });
        continue;
      }

      if (seenAppShellIds.has(appShell.id)) {
        errors.push({
          code: "IR_APP_SHELL_DUPLICATE_ID",
          message: `DesignIR.appShells[${i}].id '${appShell.id}' is duplicated across multiple appShell declarations.`,
        });
      } else {
        seenAppShellIds.add(appShell.id);
        appShellById.set(appShell.id, appShell);
      }

      if (!screenIdSet.has(appShell.sourceScreenId)) {
        errors.push({
          code: "IR_APP_SHELL_MISSING_SOURCE_SCREEN",
          message: `DesignIR.appShells[${i}].sourceScreenId '${appShell.sourceScreenId}' does not reference an existing screen.`,
        });
      }

      if (appShell.screenIds.length === 0) {
        errors.push({
          code: "IR_APP_SHELL_EMPTY_SCREEN_IDS",
          message: `DesignIR.appShells[${i}].screenIds must include at least one screen id.`,
        });
      }

      for (const screenId of appShell.screenIds) {
        if (!screenIdSet.has(screenId)) {
          errors.push({
            code: "IR_APP_SHELL_MISSING_SCREEN",
            message: `DesignIR.appShells[${i}].screenIds references '${screenId}' which does not exist in screens.`,
          });
        }
      }

      if (appShell.signalIds.length === 0) {
        errors.push({
          code: "IR_APP_SHELL_EMPTY_SIGNAL_IDS",
          message: `DesignIR.appShells[${i}].signalIds must include at least one signal id.`,
        });
      } else if (
        new Set(appShell.signalIds).size !== appShell.signalIds.length
      ) {
        errors.push({
          code: "IR_APP_SHELL_DUPLICATE_SIGNAL_IDS",
          message: `DesignIR.appShells[${i}].signalIds must not contain duplicate signal ids.`,
        });
      }

      let shellNodesValid = true;
      if (appShell.shellNodeIds.length === 0) {
        errors.push({
          code: "IR_APP_SHELL_EMPTY_SHELL_NODES",
          message: `DesignIR.appShells[${i}].shellNodeIds must include at least one top-level source screen node id.`,
        });
        shellNodesValid = false;
      } else {
        const sourceScreen = screenById.get(appShell.sourceScreenId);
        if (sourceScreen) {
          const sourceTopLevelNodeIds = new Set(
            sourceScreen.children.map((child) => child.id),
          );
          for (const shellNodeId of appShell.shellNodeIds) {
            if (!sourceTopLevelNodeIds.has(shellNodeId)) {
              errors.push({
                code: "IR_APP_SHELL_INVALID_SHELL_NODE",
                message:
                  `DesignIR.appShells[${i}].shellNodeIds references '${shellNodeId}' ` +
                  `which is not a top-level node of source screen '${appShell.sourceScreenId}'.`,
              });
              shellNodesValid = false;
            }
          }

          // Contiguity: shellNodeIds must match the leading `slotIndex` top-level
          // children of the source screen in order. Only check when the per-node
          // membership check above passed, to avoid duplicate errors.
          if (shellNodesValid) {
            const leadingIds = sourceScreen.children
              .slice(0, appShell.slotIndex)
              .map((child) => child.id);
            const contiguous =
              leadingIds.length === appShell.shellNodeIds.length &&
              leadingIds.every(
                (id, index) => id === appShell.shellNodeIds[index],
              );
            if (!contiguous) {
              errors.push({
                code: "IR_APP_SHELL_NON_CONTIGUOUS_SHELL_NODES",
                message:
                  `DesignIR.appShells[${i}].shellNodeIds must equal the first ${appShell.slotIndex} top-level ` +
                  `children of source screen '${appShell.sourceScreenId}' in order.`,
              });
            }
          }
        }
      }

      if (appShell.slotIndex !== appShell.shellNodeIds.length) {
        errors.push({
          code: "IR_APP_SHELL_SLOT_INDEX_MISMATCH",
          message:
            `DesignIR.appShells[${i}].slotIndex (${appShell.slotIndex}) must equal shellNodeIds.length ` +
            `(${appShell.shellNodeIds.length}).`,
        });
      }
    }
  }

  if (Array.isArray(raw.screens)) {
    for (let i = 0; i < raw.screens.length; i++) {
      const screen = raw.screens[i];
      if (
        !screen ||
        !screen.id ||
        !Array.isArray(screen.children) ||
        !screen.appShell
      ) {
        continue;
      }

      const { appShell } = screen;
      if (!appShell.id || !Array.isArray(appShell.contentNodeIds)) {
        errors.push({
          code: "IR_INVALID_SCREEN_APP_SHELL",
          message: `DesignIR.screens[${i}].appShell must have id and contentNodeIds array.`,
        });
        continue;
      }

      const declaredAppShell = appShellById.get(appShell.id);
      if (!declaredAppShell) {
        errors.push({
          code: "IR_SCREEN_APP_SHELL_MISSING_DEFINITION",
          message: `DesignIR.screens[${i}].appShell.id '${appShell.id}' does not reference a declared appShell.`,
        });
      } else if (!declaredAppShell.screenIds.includes(screen.id)) {
        errors.push({
          code: "IR_SCREEN_APP_SHELL_SCREEN_MISMATCH",
          message:
            `DesignIR.screens[${i}].appShell.id '${appShell.id}' does not include screen '${screen.id}' ` +
            "in its screenIds.",
        });
      }

      if (appShell.contentNodeIds.length === 0) {
        errors.push({
          code: "IR_SCREEN_APP_SHELL_EMPTY_CONTENT",
          message: `DesignIR.screens[${i}].appShell.contentNodeIds must include at least one top-level content node id.`,
        });
        continue;
      }

      const topLevelNodeIds = new Set(screen.children.map((child) => child.id));
      let contentNodesValid = true;
      for (const contentNodeId of appShell.contentNodeIds) {
        if (!topLevelNodeIds.has(contentNodeId)) {
          errors.push({
            code: "IR_SCREEN_APP_SHELL_INVALID_CONTENT_NODE",
            message:
              `DesignIR.screens[${i}].appShell.contentNodeIds references '${contentNodeId}' ` +
              `which is not a top-level node of screen '${screen.id}'.`,
          });
          contentNodesValid = false;
        }
      }

      if (declaredAppShell && contentNodesValid) {
        const trailingContentNodeIds = screen.children
          .slice(declaredAppShell.slotIndex)
          .map((child) => child.id);
        const isTrailingContentSegment =
          trailingContentNodeIds.length === appShell.contentNodeIds.length &&
          trailingContentNodeIds.every(
            (id, index) => id === appShell.contentNodeIds[index],
          );

        if (!isTrailingContentSegment) {
          errors.push({
            code: "IR_SCREEN_APP_SHELL_NON_CONTIGUOUS_CONTENT_NODES",
            message:
              `DesignIR.screens[${i}].appShell.contentNodeIds must equal all top-level children ` +
              `after slotIndex ${declaredAppShell.slotIndex} for screen '${screen.id}' in order.`,
          });
        }
      }
    }
  }

  // Bidirectional integrity: every screen referenced by an appShell must
  // carry a matching `appShell` attachment on its ScreenIR. This catches
  // shells whose `screenIds` drifted out of sync with the per-screen refs.
  if (Array.isArray(raw.appShells)) {
    for (let i = 0; i < raw.appShells.length; i++) {
      const appShell = raw.appShells[i];
      if (!appShell || !appShell.id || !Array.isArray(appShell.screenIds)) {
        continue;
      }
      for (const screenId of appShell.screenIds) {
        const screen = screenById.get(screenId);
        if (!screen) {
          continue;
        }
        if (!screen.appShell || screen.appShell.id !== appShell.id) {
          errors.push({
            code: "IR_APP_SHELL_SCREEN_NOT_ATTACHED",
            message:
              `DesignIR.appShells[${i}].screenIds references '${screenId}' but that screen is not attached ` +
              `to appShell '${appShell.id}'.`,
          });
        }
      }
    }
  }

  if (Array.isArray(raw.screenVariantFamilies)) {
    for (let i = 0; i < raw.screenVariantFamilies.length; i++) {
      const family = raw.screenVariantFamilies[i];
      if (
        !family ||
        !family.familyId ||
        !family.canonicalScreenId ||
        !Array.isArray(family.memberScreenIds) ||
        !Array.isArray(family.axes) ||
        !Array.isArray(family.scenarios)
      ) {
        errors.push({
          code: "IR_INVALID_SCREEN_VARIANT_FAMILY",
          message:
            `DesignIR.screenVariantFamilies[${i}] must have familyId, canonicalScreenId, memberScreenIds array, axes array, ` +
            "and scenarios array.",
        });
        continue;
      }

      if (family.axes.length === 0) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_EMPTY_AXES",
          message: `DesignIR.screenVariantFamilies[${i}].axes must contain at least one axis.`,
        });
      }

      if (!screenIdSet.has(family.canonicalScreenId)) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_MISSING_CANONICAL_SCREEN",
          message: `DesignIR.screenVariantFamilies[${i}].canonicalScreenId '${family.canonicalScreenId}' does not reference an existing screen.`,
        });
      }

      const memberScreenIdSet = new Set<string>();
      for (const memberScreenId of family.memberScreenIds) {
        if (memberScreenIdSet.has(memberScreenId)) {
          errors.push({
            code: "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_MEMBER",
            message:
              `DesignIR.screenVariantFamilies[${i}].memberScreenIds references '${memberScreenId}' ` +
              "more than once within the same family.",
          });
        }
        memberScreenIdSet.add(memberScreenId);
        if (!screenIdSet.has(memberScreenId)) {
          errors.push({
            code: "IR_SCREEN_VARIANT_FAMILY_MISSING_MEMBER_SCREEN",
            message:
              `DesignIR.screenVariantFamilies[${i}].memberScreenIds references '${memberScreenId}' ` +
              "which does not exist in screens.",
          });
        }
      }

      if (!memberScreenIdSet.has(family.canonicalScreenId)) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_CANONICAL_NOT_MEMBER",
          message:
            `DesignIR.screenVariantFamilies[${i}].canonicalScreenId '${family.canonicalScreenId}' ` +
            "must also be present in memberScreenIds.",
        });
      }

      const seenScenarioScreenIds = new Set<string>();
      for (
        let scenarioIndex = 0;
        scenarioIndex < family.scenarios.length;
        scenarioIndex++
      ) {
        const scenario = family.scenarios[scenarioIndex];
        if (
          !scenario ||
          !scenario.screenId ||
          !scenario.contentScreenId ||
          typeof scenario.initialState !== "object" ||
          (scenario.initialState as unknown) === null
        ) {
          errors.push({
            code: "IR_INVALID_SCREEN_VARIANT_SCENARIO",
            message:
              `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}] must have screenId, contentScreenId, ` +
              "and initialState.",
          });
          continue;
        }

        if (seenScenarioScreenIds.has(scenario.screenId)) {
          errors.push({
            code: "IR_SCREEN_VARIANT_SCENARIO_DUPLICATE",
            message:
              `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].screenId '${scenario.screenId}' ` +
              "is duplicated within the family.",
          });
        }
        seenScenarioScreenIds.add(scenario.screenId);

        if (
          !memberScreenIdSet.has(scenario.screenId) ||
          !screenIdSet.has(scenario.screenId)
        ) {
          errors.push({
            code: "IR_SCREEN_VARIANT_SCENARIO_MISSING_SCREEN",
            message:
              `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].screenId '${scenario.screenId}' ` +
              "must reference an existing family member screen.",
          });
        }

        if (
          !memberScreenIdSet.has(scenario.contentScreenId) ||
          !screenIdSet.has(scenario.contentScreenId)
        ) {
          errors.push({
            code: "IR_SCREEN_VARIANT_SCENARIO_MISSING_CONTENT_SCREEN",
            message:
              `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].contentScreenId '${scenario.contentScreenId}' ` +
              "must reference an existing family member screen.",
          });
        }

        if (scenario.fieldErrorEvidenceByFieldKey !== undefined) {
          const rawFieldEvidence: unknown =
            scenario.fieldErrorEvidenceByFieldKey;
          if (
            typeof rawFieldEvidence !== "object" ||
            rawFieldEvidence === null ||
            Array.isArray(rawFieldEvidence)
          ) {
            errors.push({
              code: "IR_INVALID_SCREEN_VARIANT_SCENARIO",
              message:
                `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].fieldErrorEvidenceByFieldKey ` +
                "must be an object when present.",
            });
          } else {
            for (const [fieldKey, evidence] of Object.entries(
              rawFieldEvidence as Record<string, unknown>,
            )) {
              const entry = evidence as Record<string, unknown> | null;
              if (
                !fieldKey ||
                typeof entry !== "object" ||
                entry === null ||
                Array.isArray(entry) ||
                typeof entry.message !== "string" ||
                typeof entry.visualError !== "boolean" ||
                (entry.sourceNodeId !== undefined &&
                  (typeof entry.sourceNodeId !== "string" ||
                    entry.sourceNodeId.trim().length === 0))
              ) {
                errors.push({
                  code: "IR_INVALID_SCREEN_VARIANT_SCENARIO",
                  message:
                    `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].fieldErrorEvidenceByFieldKey['${fieldKey}'] ` +
                    "must contain a string message, boolean visualError, and optional non-empty string sourceNodeId.",
                });
              }
            }
          }
        }

        if (scenario.screenLevelErrorEvidence !== undefined) {
          if (!Array.isArray(scenario.screenLevelErrorEvidence)) {
            errors.push({
              code: "IR_INVALID_SCREEN_VARIANT_SCENARIO",
              message:
                `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].screenLevelErrorEvidence ` +
                "must be an array when present.",
            });
          } else {
            for (const [
              errorIndex,
              rawEvidence,
            ] of scenario.screenLevelErrorEvidence.entries()) {
              const evidence = rawEvidence as unknown as Record<
                string,
                unknown
              > | null;
              if (
                typeof evidence !== "object" ||
                evidence === null ||
                Array.isArray(evidence) ||
                typeof evidence.message !== "string" ||
                evidence.severity !== "error" ||
                (evidence.sourceNodeId !== undefined &&
                  (typeof evidence.sourceNodeId !== "string" ||
                    evidence.sourceNodeId.trim().length === 0))
              ) {
                errors.push({
                  code: "IR_INVALID_SCREEN_VARIANT_SCENARIO",
                  message:
                    `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}].screenLevelErrorEvidence[${errorIndex}] ` +
                    "must contain a string message, severity='error', and optional non-empty string sourceNodeId.",
                });
              }
            }
          }
        }

        if (scenario.initialState.validationState === "error") {
          const hasFieldEvidence =
            scenario.fieldErrorEvidenceByFieldKey !== undefined &&
            Object.keys(scenario.fieldErrorEvidenceByFieldKey).length > 0;
          const hasScreenEvidence =
            Array.isArray(scenario.screenLevelErrorEvidence) &&
            scenario.screenLevelErrorEvidence.length > 0;
          if (!hasFieldEvidence && !hasScreenEvidence) {
            errors.push({
              code: "IR_SCREEN_VARIANT_SCENARIO_ERROR_STATE_MISSING_EVIDENCE",
              message:
                `DesignIR.screenVariantFamilies[${i}].scenarios[${scenarioIndex}] has validationState='error' ` +
                "but provides neither fieldErrorEvidenceByFieldKey nor screenLevelErrorEvidence.",
            });
          }
        }
      }

      const hasCanonicalScenario = family.scenarios.some(
        (candidate) => candidate.screenId === family.canonicalScreenId,
      );
      if (!hasCanonicalScenario) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_CANONICAL_NOT_IN_SCENARIOS",
          message:
            `DesignIR.screenVariantFamilies[${i}].canonicalScreenId '${family.canonicalScreenId}' ` +
            "must have a corresponding entry in scenarios.",
        });
      }

      for (const memberScreenId of family.memberScreenIds) {
        if (!seenScenarioScreenIds.has(memberScreenId)) {
          errors.push({
            code: "IR_SCREEN_VARIANT_FAMILY_MEMBER_NOT_IN_SCENARIOS",
            message:
              `DesignIR.screenVariantFamilies[${i}].memberScreenIds references '${memberScreenId}' ` +
              "which must have a corresponding scenario entry.",
          });
        }
      }
    }

    const familyIdToIndex = new Map<string, number>();
    const canonicalToFamilyIndex = new Map<string, number>();
    const memberToFamilyIndex = new Map<string, number>();
    for (let i = 0; i < raw.screenVariantFamilies.length; i++) {
      const family = raw.screenVariantFamilies[i];
      if (
        !family ||
        !family.familyId ||
        !family.canonicalScreenId ||
        !Array.isArray(family.memberScreenIds)
      ) {
        continue;
      }
      const previousFamilyId = familyIdToIndex.get(family.familyId);
      if (previousFamilyId !== undefined) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_ID",
          message:
            `DesignIR.screenVariantFamilies[${i}].familyId '${family.familyId}' ` +
            `is already used by family index ${previousFamilyId}.`,
        });
      } else {
        familyIdToIndex.set(family.familyId, i);
      }
      const previousCanonical = canonicalToFamilyIndex.get(
        family.canonicalScreenId,
      );
      if (previousCanonical !== undefined) {
        errors.push({
          code: "IR_SCREEN_VARIANT_FAMILY_CANONICAL_COLLISION",
          message:
            `DesignIR.screenVariantFamilies[${i}].canonicalScreenId '${family.canonicalScreenId}' ` +
            `is already the canonical screen of family index ${previousCanonical}.`,
        });
      } else {
        canonicalToFamilyIndex.set(family.canonicalScreenId, i);
      }
      for (const memberScreenId of family.memberScreenIds) {
        const previousMember = memberToFamilyIndex.get(memberScreenId);
        if (previousMember !== undefined && previousMember !== i) {
          errors.push({
            code: "IR_SCREEN_VARIANT_FAMILY_MEMBER_COLLISION",
            message:
              `DesignIR.screenVariantFamilies[${i}].memberScreenIds references '${memberScreenId}' ` +
              `which already belongs to family index ${previousMember}.`,
          });
        } else {
          memberToFamilyIndex.set(memberScreenId, i);
        }
      }
    }
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
    ...(raw.metrics?.classificationFallbacks
      ? { classificationFallbacks: [...raw.metrics.classificationFallbacks] }
      : {}),
    prototypeNavigationDetected: raw.metrics?.prototypeNavigationDetected ?? 0,
    prototypeNavigationResolved: raw.metrics?.prototypeNavigationResolved ?? 0,
    prototypeNavigationUnresolved:
      raw.metrics?.prototypeNavigationUnresolved ?? 0,
    prototypeNavigationRendered: 0,
    ...(raw.metrics?.nodeDiagnostics
      ? { nodeDiagnostics: [...raw.metrics.nodeDiagnostics] }
      : {}),
    ...(raw.metrics?.mcpCoverage
      ? { mcpCoverage: { ...raw.metrics.mcpCoverage } }
      : {}),
  };

  return {
    valid: true,
    ir: {
      sourceName: raw.sourceName,
      screens: raw.screens,
      tokens: raw.tokens,
      metrics,
      ...(raw.themeAnalysis ? { themeAnalysis: raw.themeAnalysis } : {}),
      ...(raw.appShells ? { appShells: raw.appShells } : {}),
      ...(raw.screenVariantFamilies
        ? { screenVariantFamilies: raw.screenVariantFamilies }
        : {}),
    },
  };
};
