// ---------------------------------------------------------------------------
// ir.ts — Slim orchestrator for IR derivation
// Sub-modules: ir-helpers, ir-navigation, ir-elements, ir-screens,
//              ir-palette, ir-typography, ir-tokens
// See issue #299 for the decomposition rationale.
// ---------------------------------------------------------------------------
import type { WorkspaceBrandTheme } from "../contracts/index.js";
import { safeParseFigmaPayload, summarizeFigmaPayloadValidationError } from "../figma-payload-validation.js";
import type {
  DesignIR,
  DesignTokens
} from "./types.js";
import { applySparkasseThemeDefaults } from "./sparkasse-theme.js";
import {
  DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH
} from "./ir-tree.js";
import {
  resolvePlaceholderMatcherConfig
} from "./ir-variants.js";
import type {
  FigmaFile,
  FigmaToIrOptions,
  MetricsAccumulator
} from "./ir-helpers.js";
import {
  extractScreens
} from "./ir-screens.js";
import {
  deriveTokens,
  deriveThemeAnalysis,
  applyMcpEnrichmentToIr
} from "./ir-tokens.js";

// ── Re-exports from ir-variants.ts (unchanged) ──────────────────────────
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
  inferVariantSignalsFromNamePath,
  GENERIC_PLACEHOLDER_TEXT_PATTERNS
} from "./ir-variants.js";
export type {
  ComponentSetVariantCandidate,
  NormalizedVariantData,
  PlaceholderMatcherConfig
} from "./ir-variants.js";

// ── Re-exports from ir-tree.ts (unchanged) ──────────────────────────────
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
    classificationFallbacks: [],
    degradedGeometryNodes: [...(options?.sourceMetrics?.degradedGeometryNodes ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort((left, right) => left.localeCompare(right)),
    nodeDiagnostics: []
  };

  for (const degradedNodeId of metrics.degradedGeometryNodes) {
    metrics.nodeDiagnostics.push({
      nodeId: degradedNodeId,
      category: "degraded-geometry",
      reason: "Node geometry was degraded during staged fetch."
    });
  }

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
  const resolvedTokens = resolvedBrandTheme === "sparkasse" ? applySparkasseThemeDefaults(derivedTokens) : derivedTokens;
  const themeAnalysis = deriveThemeAnalysis({
    file: parsed,
    screens,
    tokens: resolvedTokens
  });
  const metricsOutput = {
    ...metrics,
    ...(metrics.classificationFallbacks.length > 0
      ? { classificationFallbacks: [...metrics.classificationFallbacks] }
      : {}),
    ...(metrics.nodeDiagnostics.length > 0
      ? { nodeDiagnostics: [...metrics.nodeDiagnostics] }
      : {})
  };

  const baseIr: DesignIR = {
    sourceName: parsed.name ?? "Figma File",
    screens,
    tokens: resolvedTokens,
    metrics: metricsOutput,
    themeAnalysis
  };

  if (!options?.mcpEnrichment) {
    return baseIr;
  }
  return applyMcpEnrichmentToIr(baseIr, options.mcpEnrichment);
};
