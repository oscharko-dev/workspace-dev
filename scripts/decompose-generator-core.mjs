#!/usr/bin/env node
/**
 * Decompose generator-core.ts into focused sub-modules.
 * Issue #297: Split 195KB monolith into 6 sub-modules + slim orchestrator.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve("src/parity");
const sourceFile = path.join(SRC, "generator-core.ts");
const lines = readFileSync(sourceFile, "utf-8").split("\n");

/** Extract lines [start, end] (1-indexed, inclusive) */
function extractLines(ranges) {
  const result = [];
  for (const [start, end] of ranges) {
    for (let i = start - 1; i < end && i < lines.length; i++) {
      result.push(lines[i]);
    }
    result.push(""); // blank separator between ranges
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ═══════════════════════════════════════════════════════════════════
// 1. generator-sx.ts — sx prop computation and shared constant extraction
// ═══════════════════════════════════════════════════════════════════
const generatorSx = `// ---------------------------------------------------------------------------
// generator-sx.ts — sx prop computation and shared constant extraction
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------

${extractLines([[683, 911]])}
`;
writeFileSync(path.join(SRC, "generator-sx.ts"), generatorSx);
console.log("✓ generator-sx.ts");

// ═══════════════════════════════════════════════════════════════════
// 2. generator-navigation.ts — Prototype navigation → router binding
// ═══════════════════════════════════════════════════════════════════
const generatorNavigation = `// ---------------------------------------------------------------------------
// generator-navigation.ts — Prototype navigation → router binding
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import type { RenderContext } from "./generator-render.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";

${extractLines([[4078, 4142]])}
`;
writeFileSync(path.join(SRC, "generator-navigation.ts"), generatorNavigation);
console.log("✓ generator-navigation.ts");

// ═══════════════════════════════════════════════════════════════════
// 3. generator-render.ts — Core element rendering utilities
// ═══════════════════════════════════════════════════════════════════
const generatorRender = `// ---------------------------------------------------------------------------
// generator-render.ts — Core element → JSX rendering utilities
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignTokenTypographyVariantName,
  GeneratedFile,
  SimplificationMetrics,
  ScreenElementIR,
  ScreenIR,
  ScreenResponsiveLayoutOverridesByBreakpoint
} from "./types.js";
import { BUILTIN_ICON_FALLBACK_CATALOG, ICON_FALLBACK_MAP_VERSION } from "./icon-fallback-catalog.js";
import { ensureTsxName } from "./path-utils.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";
import {
  HEADING_FONT_SIZE_MIN,
  HEADING_FONT_WEIGHT_MIN,
  LARGE_HEADING_FONT_SIZE_MIN,
  LARGE_HEADING_FONT_WEIGHT_MIN
} from "./constants.js";
import {
  normalizeOpacityForSx,
  normalizeHexColor,
  toRgbaColor,
  firstText,
  firstTextColor,
  firstVectorColor,
  collectTextNodes,
  collectVectorPaths,
  renderElement,
  fallbackScreenFile,
  makeAppFile,
  renderFallbackIconExpression,
  DEFAULT_SPACING_BASE,
  literal,
  escapeXmlText,
  indentBlock,
  collectRenderedItems
} from "./generator-templates.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import { buildScreenArtifactIdentities, toComponentName } from "./generator-artifacts.js";
import type { ScreenArtifactIdentity } from "./generator-artifacts.js";
import {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";
import type { AccessibilityWarning } from "./generator-a11y.js";
import {
  A11Y_NAVIGATION_HINTS,
  A11Y_IMAGE_DECORATIVE_HINTS,
  HEADING_NAME_HINTS
} from "./generator-a11y.js";
import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";

export type { ScreenArtifactIdentity } from "./generator-artifacts.js";

${extractLines([
  [177, 681],       // VirtualParent → sortChildren
  [2001, 2227],     // approximatelyEqualNumber → SemanticIconModel
  [2277, 2316],     // IconImportSpec → ExtractedComponentImportSpec
  [2394, 2651],     // RenderedButtonModel, RenderContext → toStateKey
  [3152, 3817],     // Icon resolution
  [5359, 5497],     // Grid detection (clusterAxisValues, toNearestClusterIndex, detectGridLikeContainerLayout)
  [5500, 5544],     // createDeterministicScreenFile, createDeterministicAppFile
  [5631, 5650],     // flattenElements
])}

// Re-export normalizeInputSemanticText since generator-a11y.ts imports it from generator-core.ts
// It was moved to generator-forms.ts but we re-export here for backward compat
export { normalizeInputSemanticText } from "./generator-forms.js";
`;
writeFileSync(path.join(SRC, "generator-render.ts"), generatorRender);
console.log("✓ generator-render.ts");

// ═══════════════════════════════════════════════════════════════════
// 4. generator-patterns.ts — Pattern extraction and component deduplication
// ═══════════════════════════════════════════════════════════════════
const generatorPatterns = `// ---------------------------------------------------------------------------
// generator-patterns.ts — Pattern extraction and component deduplication
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  GeneratedFile,
  ScreenElementIR,
  ScreenIR,
  ScreenResponsiveLayoutOverridesByBreakpoint
} from "./types.js";
import { ensureTsxName } from "./path-utils.js";
import {
  PATTERN_SIMILARITY_THRESHOLD,
  PATTERN_MIN_OCCURRENCES,
  PATTERN_MIN_SUBTREE_NODE_COUNT
} from "./constants.js";
import {
  literal,
  indentBlock,
  renderElement,
  collectRenderedItems
} from "./generator-templates.js";
import {
  sortChildren,
  resolveElementA11yLabel,
  resolveTypographyVariantByNodeId,
  normalizeIconImports,
  registerIconImport,
  toDeterministicImagePlaceholderSrc,
  isPlainRecord
} from "./generator-render.js";
import {
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";
import type {
  VirtualParent,
  RenderContext,
  IconFallbackResolver,
  PatternExtractionInvocation,
  ExtractedComponentImportSpec,
  MappedImportSpec,
  IconImportSpec
} from "./generator-render.js";
import type { ThemeComponentDefaults } from "./generator-design-system.js";
import { extractSharedSxConstantsFromScreenContent } from "./generator-sx.js";

${extractLines([
  [2318, 2392],     // Pattern types
  [912, 2000],      // Pattern extraction code
])}
`;
writeFileSync(path.join(SRC, "generator-patterns.ts"), generatorPatterns);
console.log("✓ generator-patterns.ts");

// ═══════════════════════════════════════════════════════════════════
// 5. generator-forms.ts — Form detection, validation, state management
// ═══════════════════════════════════════════════════════════════════
const generatorForms = `// ---------------------------------------------------------------------------
// generator-forms.ts — Form detection, validation, and state management
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import {
  firstText,
  firstTextColor,
  firstVectorColor,
  normalizeHexColor,
  toRgbaColor,
  isLikelyErrorRedColor,
  normalizeFontFamily,
  collectTextNodes,
  collectVectorPaths
} from "./generator-templates.js";
import {
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toStateKey,
  findFirstByName
} from "./generator-render.js";
import type {
  RenderContext,
  VirtualParent,
  SemanticIconModel
} from "./generator-render.js";

${extractLines([
  [2229, 2260],     // TextFieldInputType, SemanticInputModel, InteractiveFieldModel
  [2696, 3143],     // Forms: escapeRegExpToken → isLikelyInputContainer
  [1355, 1361],     // toFormContextProviderName, toFormContextHookName
  [3819, 3879],     // registerInteractiveField, subtreeContainsType
  [3881, 4076],     // FormGroupAssignment, detectFormGroups, buildSemanticInputModel
])}
`;
writeFileSync(path.join(SRC, "generator-forms.ts"), generatorForms);
console.log("✓ generator-forms.ts");

// ═══════════════════════════════════════════════════════════════════
// 6. generator-interactive.ts — Tabs, dialogs, accordions, navigation bars
// ═══════════════════════════════════════════════════════════════════
const generatorInteractive = `// ---------------------------------------------------------------------------
// generator-interactive.ts — Tabs, dialogs, accordions, navigation bars
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import {
  firstText,
  normalizeHexColor,
  collectTextNodes,
  toRgbaColor
} from "./generator-templates.js";
import {
  hasSubtreeName,
  hasVisualStyle,
  isIconLikeNode,
  toStateKey,
  findFirstByName,
  approximatelyEqualNumber,
  sortChildren,
  collectSubtreeNames,
  clusterAxisValues,
  toNearestClusterIndex,
  resolveIconColor,
  hasMeaningfulTextDescendants
} from "./generator-render.js";
import type {
  RenderContext,
  VirtualParent,
  SemanticIconModel
} from "./generator-render.js";
import {
  resolveElementA11yLabel,
  hasInteractiveDescendants
} from "./generator-a11y.js";
import { normalizeInputSemanticText } from "./generator-forms.js";
import type { DetectedTabInterfacePattern, DetectedDialogOverlayPattern, DialogActionModel, RenderedItem } from "./generator-templates.js";

${extractLines([
  [2262, 2275],     // InteractiveAccordionModel, InteractiveTabsModel, InteractiveDialogModel
  [2652, 2695],     // ensureTabsStateModel, ensureDialogStateModel
  [3145, 3151],     // isLikelyAccordionContainer
  [3959, 3980],     // registerInteractiveAccordion
  [4144, 5358],     // Interactive pattern detection
])}
`;
writeFileSync(path.join(SRC, "generator-interactive.ts"), generatorInteractive);
console.log("✓ generator-interactive.ts");

// ═══════════════════════════════════════════════════════════════════
// 7. Rewrite generator-core.ts as slim orchestrator with re-exports
// ═══════════════════════════════════════════════════════════════════
const orchestrator = `// ---------------------------------------------------------------------------
// generator-core.ts — Slim orchestrator for artifact generation
// Sub-modules: render, patterns, forms, interactive, sx, navigation
// See issue #297 for the decomposition rationale.
// ---------------------------------------------------------------------------
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignIR,
  DesignTokenTypographyVariantName,
  GenerationMetrics,
  GeneratedFile,
  LlmCodegenMode,
  ScreenSimplificationMetric,
  SimplificationMetrics,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { validateDesignIR } from "./types.js";
import { WorkflowError } from "./workflow-error.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import {
  applyDesignSystemMappingsToGeneratedTsx,
  getDefaultDesignSystemConfigPath,
  loadDesignSystemConfigFile
} from "../design-system.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import {
  buildScreenArtifactIdentities,
  toComponentName,
  toDeterministicScreenPath
} from "./generator-artifacts.js";
import type { ScreenArtifactIdentity } from "./generator-artifacts.js";
import { deriveThemeComponentDefaultsFromIr } from "./generator-design-system.js";
import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";
import type { GeneratorContext } from "./generator-context.js";
import type { AccessibilityWarning } from "./generator-a11y.js";
import {
  resolveFormHandlingMode,
  fallbackThemeFile,
  fallbackScreenFile,
  makeErrorBoundaryFile,
  makeScreenSkeletonFile,
  makeAppFile
} from "./generator-templates.js";

// ── Re-exports from sub-modules (backward compatibility) ──────────────────

// generator-render.ts
export {
  hasVisualStyle,
  createEmptySimplificationStats,
  isIconLikeNode,
  isSemanticIconWrapper,
  simplifyElements,
  sortChildren,
  approximatelyEqualNumber,
  resolveTypographyVariantByNodeId,
  hasMeaningfulTextDescendants,
  resolveImageSource,
  pickBestIconNode,
  findFirstByName,
  registerMuiImports,
  renderMappedElement,
  toStateKey,
  normalizeIconImports,
  isDeepIconImport,
  registerIconImport,
  resolveIconColor,
  ICON_FALLBACK_FILE_NAME,
  ICON_FALLBACK_BUILTIN_RESOLVER,
  loadIconFallbackResolver,
  resolveFallbackIconComponent,
  detectGridLikeContainerLayout,
  createDeterministicScreenFile,
  createDeterministicAppFile,
  flattenElements,
  normalizeInputSemanticText,
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toDeterministicImagePlaceholderSrc,
  isPlainRecord,
  clusterAxisValues,
  toNearestClusterIndex
} from "./generator-render.js";
export type {
  VirtualParent,
  ButtonVariant,
  ButtonSize,
  HeadingComponent,
  LandmarkRole,
  RgbaColor,
  SemanticIconModel,
  IconImportSpec,
  IconFallbackResolver,
  MappedImportSpec,
  ExtractedComponentImportSpec,
  RenderContext,
  RenderedButtonModel
} from "./generator-render.js";

// generator-sx.ts
export { extractSharedSxConstantsFromScreenContent } from "./generator-sx.js";

// generator-patterns.ts
export {
  buildPatternExtractionPlan,
  toPatternContextProviderName,
  toPatternContextHookName
} from "./generator-patterns.js";
export type {
  PatternExtractionInvocation,
  PatternContextFileSpec,
  PatternExtractionPlan
} from "./generator-patterns.js";

// generator-forms.ts
export {
  deriveSelectOptions,
  inferRequiredFromLabel,
  sanitizeRequiredLabel,
  inferVisualErrorFromOutline,
  isLikelyInputContainer,
  registerInteractiveField,
  detectFormGroups,
  buildSemanticInputModel,
  toFormContextProviderName,
  toFormContextHookName
} from "./generator-forms.js";
export type {
  ValidationFieldType,
  ResolvedFormHandlingMode,
  InteractiveFieldModel,
  FormGroupAssignment,
  FormContextFileSpec
} from "./generator-forms.js";

// generator-interactive.ts
export {
  ensureTabsStateModel,
  ensureDialogStateModel,
  isLikelyAccordionContainer,
  registerInteractiveAccordion,
  detectTabInterfacePattern,
  detectDialogOverlayPattern,
  detectNavigationBarPattern,
  NAVIGATION_BAR_TOP_LEVEL_DEPTH,
  analyzeListRow,
  collectListRows,
  detectRepeatedListPattern,
  isRenderableTabAction,
  toListSecondaryActionExpression
} from "./generator-interactive.js";
export type {
  ListRowAnalysis
} from "./generator-interactive.js";

// generator-navigation.ts
export {
  resolvePrototypeNavigationBinding,
  toRouterLinkProps,
  toNavigateHandlerProps
} from "./generator-navigation.js";

// Re-exports from other existing modules (preserving backward compat)
export { buildScreenArtifactIdentities, toComponentName, toDeterministicScreenPath } from "./generator-artifacts.js";
export type { ScreenArtifactIdentity } from "./generator-artifacts.js";
export {
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey,
  collectThemeSxSampleFromEntries,
  collectThemeDefaultMatchedSxKeys,
  createDeterministicThemeFile,
  deriveThemeComponentDefaultsFromIr
} from "./generator-design-system.js";
export type {
  ThemeComponentDefaults,
  ThemeSxStyleValue,
  ThemeSxComponentStyleOverrides,
  ThemeSxSample,
  ThemeSxSampleCollector
} from "./generator-design-system.js";
export { createGeneratorContext } from "./generator-context.js";
export type {
  GeneratorContext,
  GeneratorConfig,
  GenerateArtifactsRuntimeAdapters as GeneratorRuntimeAdapters,
  MetricsAccumulator,
  WarningCollector,
  CreateGeneratorContextInput
} from "./generator-context.js";
export {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferLandmarkRole,
  isDecorativeImageElement,
  isDecorativeElement,
  inferHeadingComponentByNodeId,
  resolveBackgroundHexForText,
  pushLowContrastWarning
} from "./generator-a11y.js";
export type { AccessibilityWarning } from "./generator-a11y.js";

// ── Internal imports from sub-modules used by the orchestrator ────────────
import {
  createEmptySimplificationStats,
  flattenElements,
  ICON_FALLBACK_FILE_NAME,
  loadIconFallbackResolver,
  isPlainRecord
} from "./generator-render.js";
import type { IconFallbackResolver, RenderContext, ResolvedFormHandlingMode as ResolvedFormHandlingModeType } from "./generator-render.js";

// ── Orchestrator code ─────────────────────────────────────────────────────

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

${extractLines([
  [128, 175],       // GenerateArtifactsInput, RejectedScreenEnhancement, GenerateArtifactsResult
  [188, 190],       // getErrorMessage (already defined above, skip)
])}

const accumulateSimplificationStats = ({
  target,
  source
}: {
  target: SimplificationMetrics;
  source: SimplificationMetrics;
}): void => {
  target.removedEmptyNodes += source.removedEmptyNodes;
  target.promotedSingleChild += source.promotedSingleChild;
  target.promotedGroupMultiChild += source.promotedGroupMultiChild;
  target.spacingMerges += source.spacingMerges;
  target.guardedSkips += source.guardedSkips;
};

const dedupeMappingWarnings = (
  warnings: Array<{
    code:
      | "W_COMPONENT_MAPPING_MISSING"
      | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH"
      | "W_COMPONENT_MAPPING_DISABLED"
      | "W_COMPONENT_MAPPING_BROAD_PATTERN";
    message: string;
  }>
): Array<{
  code:
    | "W_COMPONENT_MAPPING_MISSING"
    | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH"
    | "W_COMPONENT_MAPPING_DISABLED"
    | "W_COMPONENT_MAPPING_BROAD_PATTERN";
  message: string;
}> => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = \`\${warning.code}:\${warning.message}\`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

${extractLines([
  [5546, 5553],     // writeGeneratedFile
  [5555, 5629],     // Runtime adapters
  [5652, 6232],     // Pipeline phases + generateArtifacts
])}
`;
writeFileSync(sourceFile, orchestrator);
console.log("✓ generator-core.ts (orchestrator)");

console.log("\n✅ Decomposition complete!");
console.log("Next steps:");
console.log("  1. Fix import issues (circular deps, missing exports)");
console.log("  2. Run pnpm run typecheck");
console.log("  3. Run pnpm run test");
